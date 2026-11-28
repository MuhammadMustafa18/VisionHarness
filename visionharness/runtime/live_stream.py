"""Live Stream Manager for VisionOps.

Handles continuous non-blocking frame ingestion from:
- Phone IP Camera apps (HTTP MJPEG e.g. http://192.168.1.X:8080/video)
- RTSP / ONVIF CCTV cameras (rtsp://...)
- Video files looped as synthetic live streams for testing
- Webcam devices (0, 1)

Runs background frame grabber threads to eliminate buffer lag,
manages live YOLOv8 + ByteTrack inference, and provides MJPEG video streaming
and telemetry feeds.
"""

import os
import time
import threading
from typing import Optional, Dict, Any, Generator
import cv2
import numpy as np
import supervision as sv
from ultralytics import YOLO

from visionharness.core.spec import WorkflowSpec, Point2D
from visionharness.core.alert_store import add_alert, ALERTS_DIR
from visionharness.agent.grounding import ground_scene_with_vlm


class LiveCameraWorker:
    """Worker handling single live camera stream ingestion and real-time vision processing."""

    def __init__(self, session_id: str, stream_url: str, spec: Optional[WorkflowSpec] = None):
        self.session_id = session_id
        self.stream_url = stream_url
        self.spec = spec or WorkflowSpec(id=f"live_{session_id}")
        
        self.is_running = False
        self.is_connected = False
        self.last_raw_frame: Optional[np.ndarray] = None
        self.last_annotated_frame: Optional[np.ndarray] = None
        self.last_jpeg_bytes: Optional[bytes] = None
        
        # Telemetry metrics
        self.fps = 0.0
        self.total_frames = 0
        self.active_tracks = 0
        self.total_entered = 0
        self.current_inside = 0
        self.peak_occupancy = 0
        self.unique_track_ids = set()
        
        # Thread control
        self.lock = threading.Lock()
        self.grabber_thread: Optional[threading.Thread] = None
        self.inference_thread: Optional[threading.Thread] = None

        # Tracking state
        self.model: Optional[YOLO] = None
        self.tracker = None
        self.polygon_zones = []
        self.polygon_annotators = []
        self.line_zones = []
        self.line_annotators = []
        self.box_annotator = None
        self.label_annotator = None
        self.trace_annotator = None
        self.zone_visitor_frames = {}
        self.last_wa_alert_time = 0.0

        # Real-time object alert rule (armed via chat / set_alert_rule)
        self.alert_rule: Optional[Dict[str, Any]] = None
        self.last_rule_alert_time = 0.0
        self.rule_consecutive_hits = 0

    def set_alert_rule(
        self,
        classes: list,
        cooldown_sec: float = 15.0,
        label: str = "",
        min_confidence: float = 0.55,
        min_consecutive_frames: int = 3,
    ) -> Dict[str, Any]:
        """Arm a real-time object detection alert rule on this live stream."""
        norm_classes = [str(c).strip().lower() for c in classes if str(c).strip()]
        with self.lock:
            self.alert_rule = {
                "classes": norm_classes,
                "cooldown_sec": max(2.0, float(cooldown_sec)),
                "label": label or f"Alert on {', '.join(norm_classes)}",
                "min_confidence": max(0.1, min(0.99, float(min_confidence))),
                "min_consecutive_frames": max(1, int(min_consecutive_frames)),
            }
            self.last_rule_alert_time = 0.0
            self.rule_consecutive_hits = 0
            # Ensure YOLO detector actually detects the alerted classes
            if self.spec and self.spec.detector:
                existing = [c.lower() for c in (self.spec.detector.classes or [])]
                for c in norm_classes:
                    if c not in existing:
                        existing.append(c)
                self.spec.detector.classes = existing
        return self.alert_rule

    def clear_alert_rule(self) -> None:
        with self.lock:
            self.alert_rule = None
            self.rule_consecutive_hits = 0

    def connect_and_capture_snapshot(self) -> Optional[np.ndarray]:
        """Attempts connection and captures a single sharp snapshot frame."""
        # Check if stream_url is integer index (webcam)
        source = int(self.stream_url) if str(self.stream_url).isdigit() else self.stream_url
        cap = cv2.VideoCapture(source)
        if not cap.isOpened():
            return None

        snapshot = None
        # Read a couple frames to let exposure / auto-gain settle
        for _ in range(5):
            ret, frame = cap.read()
            if ret and frame is not None:
                snapshot = frame
                break

        cap.release()
        if snapshot is not None:
            self.last_raw_frame = snapshot
            self.is_connected = True
        return snapshot

    def start(self):
        """Starts live frame grabber and inference loops."""
        if self.is_running:
            return
        self.is_running = True

        # Initialize detector & annotators
        model_name = self.spec.detector.model or "yolov8n.pt"
        self.model = YOLO(model_name)
        
        self.box_annotator = sv.BoxAnnotator(thickness=2)
        self.label_annotator = sv.LabelAnnotator(text_scale=0.45, text_padding=4)
        self.trace_annotator = sv.TraceAnnotator(trace_length=30, thickness=2)

        self._setup_geometry()

        # Start continuous frame grabber thread (unless frames are pushed via HTTP/tab share)
        if self.stream_url != "push":
            self.grabber_thread = threading.Thread(target=self._frame_grabber_loop, daemon=True)
            self.grabber_thread.start()

        # Start inference processing thread
        self.inference_thread = threading.Thread(target=self._inference_loop, daemon=True)
        self.inference_thread.start()

    def push_frame_bytes(self, jpeg_bytes: bytes) -> bool:
        """Accept a JPEG-encoded frame pushed from the browser (e.g. Share Tab)."""
        arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return False
        with self.lock:
            self.last_raw_frame = frame
            self.is_connected = True
        return True

    def update_spec(self, new_spec: WorkflowSpec):
        """Updates active tracking geometry and parameters on the fly."""
        with self.lock:
            self.spec = new_spec
            self._setup_geometry()

    def _setup_geometry(self):
        """Builds spatial zones/lines with current frame dimensions."""
        if self.last_raw_frame is None:
            w, h = 1280, 720
        else:
            h, w = self.last_raw_frame.shape[:2]

        self.polygon_zones = []
        self.polygon_annotators = []
        self.line_zones = []
        self.line_annotators = []

        # Polygon zones
        if self.spec.zones:
            for z in self.spec.zones:
                pts = np.array(
                    [[int(pt.x * w) if pt.x <= 1.0 else int(pt.x),
                      int(pt.y * h) if pt.y <= 1.0 else int(pt.y)] for pt in z.polygon],
                    dtype=np.int32
                )
                pz = sv.PolygonZone(polygon=pts, frame_resolution_wh=(w, h))
                pza = sv.PolygonZoneAnnotator(zone=pz, color=sv.Color.from_hex("#10b981"), thickness=2)
                self.polygon_zones.append(pz)
                self.polygon_annotators.append(pza)

        # Line crossing counters
        if self.spec.lines:
            for l in self.spec.lines:
                sx = int(l.start.x * w) if l.start.x <= 1.0 else int(l.start.x)
                sy = int(l.start.y * h) if l.start.y <= 1.0 else int(l.start.y)
                ex = int(l.end.x * w) if l.end.x <= 1.0 else int(l.end.x)
                ey = int(l.end.y * h) if l.end.y <= 1.0 else int(l.end.y)
                lz = sv.LineZone(start=sv.Point(sx, sy), end=sv.Point(ex, ey))
                lza = sv.LineZoneAnnotator(thickness=2, text_scale=0.5)
                self.line_zones.append(lz)
                self.line_annotators.append(lza)

    def _frame_grabber_loop(self):
        """Continuous grabber loop to keep only the freshest frame (0 lag)."""
        source = int(self.stream_url) if str(self.stream_url).isdigit() else self.stream_url
        cap = cv2.VideoCapture(source)

        # Optional buffer size optimization for OpenCV network streams
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        while self.is_running:
            if not cap.isOpened():
                time.sleep(1.0)
                cap = cv2.VideoCapture(source)
                continue

            ret, frame = cap.read()
            if not ret or frame is None:
                # If reading from a looped video file, loop back to start
                if isinstance(source, str) and os.path.exists(source):
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    time.sleep(0.03)
                    continue
                time.sleep(0.1)
                continue

            with self.lock:
                self.last_raw_frame = frame
                self.is_connected = True

        cap.release()

    def _inference_loop(self):
        """Runs YOLO detection + ByteTrack on the latest available frame."""
        last_t = time.time()
        fps_smoothing = 0.9

        while self.is_running:
            raw = None
            with self.lock:
                if self.last_raw_frame is not None:
                    raw = self.last_raw_frame.copy()

            if raw is None:
                time.sleep(0.04)
                continue

            # Class mapping
            class_ids = None
            if self.spec.detector.classes and self.model:
                name_to_id = {v.lower(): k for k, v in self.model.names.items()}
                c_ids = [name_to_id[c.lower()] for c in self.spec.detector.classes if c.lower() in name_to_id]
                if c_ids:
                    class_ids = c_ids

            # YOLO inference + ByteTrack
            results = self.model.track(
                raw,
                persist=True,
                tracker="bytetrack.yaml",
                conf=self.spec.detector.confidence,
                classes=class_ids,
                verbose=False
            )[0]

            detections = sv.Detections.from_ultralytics(results)
            active_tids = []
            if detections.tracker_id is not None:
                for tid in detections.tracker_id:
                    tid_int = int(tid)
                    active_tids.append(tid_int)
                    self.unique_track_ids.add(tid_int)

            # Spatial trigger checks
            cur_inside_count = 0
            if self.polygon_zones:
                for pz in self.polygon_zones:
                    is_in = pz.trigger(detections=detections)
                    if is_in is not None:
                        cur_inside_count += int(np.sum(is_in))
                        if detections.tracker_id is not None:
                            for inside, tid_val in zip(is_in, detections.tracker_id):
                                if inside:
                                    tid = int(tid_val)
                                    cur_f = self.zone_visitor_frames.get(tid, 0) + 1
                                    self.zone_visitor_frames[tid] = cur_f
                                    if cur_f >= 5:
                                        self.total_entered = len([k for k, v in self.zone_visitor_frames.items() if v >= 5])

            if cur_inside_count > self.peak_occupancy:
                self.peak_occupancy = cur_inside_count
            self.current_inside = cur_inside_count
            self.active_tracks = len(active_tids)

            # WhatsApp Alert Trigger Hook (Throttle: at most 1 alert every 45 seconds)
            if cur_inside_count > 0 and (time.time() - self.last_wa_alert_time) > 45:
                self.last_wa_alert_time = time.time()
                self._dispatch_whatsapp_alert(cur_inside_count, raw)

            for lz in self.line_zones:
                lz.trigger(detections=detections)

            # Annotate Frame
            annotated = raw.copy()

            if self.trace_annotator and detections.tracker_id is not None:
                annotated = self.trace_annotator.annotate(scene=annotated, detections=detections)
            if self.box_annotator:
                annotated = self.box_annotator.annotate(scene=annotated, detections=detections)
            if self.label_annotator and detections.tracker_id is not None:
                labels = [f"#{tid}" for tid in detections.tracker_id]
                annotated = self.label_annotator.annotate(scene=annotated, detections=detections, labels=labels)

            # Polygon / Line overlays
            for pz, pza in zip(self.polygon_zones, self.polygon_annotators):
                annotated = pza.annotate(scene=annotated)
            for lz, lza in zip(self.line_zones, self.line_annotators):
                annotated = lza.annotate(frame=annotated, line_counter=lz)

            # Render In-Video Telemetry HUD (Top-Left)
            self._render_hud(annotated)

            # Real-time Object Alert Rule check (confidence + multi-frame persistence)
            rule = self.alert_rule
            if rule and rule.get("classes") and detections.class_id is not None and self.model:
                target_set = set(rule["classes"])
                min_conf = float(rule.get("min_confidence", 0.55))
                min_frames = int(rule.get("min_consecutive_frames", 3))
                confs = detections.confidence if detections.confidence is not None else [1.0] * len(detections.class_id)
                matched = []
                for cid, conf in zip(detections.class_id, confs):
                    cname = str(self.model.names.get(int(cid), "")).lower()
                    if cname in target_set and float(conf) >= min_conf:
                        matched.append(cname)

                if matched:
                    self.rule_consecutive_hits += 1
                else:
                    self.rule_consecutive_hits = 0

                now_ts = time.time()
                if (
                    matched
                    and self.rule_consecutive_hits >= min_frames
                    and (now_ts - self.last_rule_alert_time) >= rule.get("cooldown_sec", 15.0)
                ):
                    self.last_rule_alert_time = now_ts
                    self.rule_consecutive_hits = 0
                    os.makedirs(ALERTS_DIR, exist_ok=True)
                    snap_name = f"alert_{self.session_id}_{int(now_ts * 1000)}.jpg"
                    snap_path = os.path.join(ALERTS_DIR, snap_name)
                    cv2.imwrite(snap_path, annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    add_alert(
                        session_id=self.session_id,
                        camera_label=self.spec.name or self.stream_url,
                        detected_classes=sorted(set(matched)),
                        count=len(matched),
                        rule_label=rule.get("label", ""),
                        screenshot_url=f"/output/alerts/{snap_name}",
                        screenshot_path=snap_path,
                    )

            # Calculate FPS
            now = time.time()
            instant_fps = 1.0 / (now - last_t) if (now - last_t) > 0 else 30.0
            last_t = now
            self.fps = round(self.fps * fps_smoothing + instant_fps * (1.0 - fps_smoothing), 1)
            self.total_frames += 1

            # Encode to JPEG for MJPEG stream
            _, jpeg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
            with self.lock:
                self.last_annotated_frame = annotated
                self.last_jpeg_bytes = jpeg.tobytes()

            time.sleep(0.01)

    def _render_hud(self, frame: np.ndarray):
        """Draws top-left telemetry HUD card."""
        hud_lines = [
            ("Live Footfall", str(self.total_entered), (46, 213, 115)),
            ("Current In Zone", str(self.current_inside), (56, 189, 248)),
            ("Peak Occupancy", str(self.peak_occupancy), (255, 177, 66)),
            ("Active Tracks", str(self.active_tracks), (200, 205, 215)),
            ("Live FPS", f"{self.fps}", (160, 170, 185)),
        ]

        pad_x, pad_y = 12, 10
        line_h = 20
        box_w = 210
        box_h = pad_y * 2 + len(hud_lines) * line_h
        x1, y1 = 16, 16
        x2, y2 = x1 + box_w, y1 + box_h

        overlay = frame.copy()
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (18, 20, 24), -1)
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (55, 60, 70), 1)
        cv2.addWeighted(overlay, 0.78, frame, 0.22, 0, frame)

        cur_y = y1 + pad_y + 14
        for label, val_text, color in hud_lines:
            cv2.putText(frame, label, (x1 + pad_x, cur_y), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (190, 195, 205), 1, cv2.LINE_AA)
            (vw, _), _ = cv2.getTextSize(val_text, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 2)
            cv2.putText(frame, val_text, (x2 - pad_x - vw, cur_y), cv2.FONT_HERSHEY_SIMPLEX, 0.48, color, 2, cv2.LINE_AA)
            cur_y += line_h

    def get_latest_jpeg(self) -> Optional[bytes]:
        with self.lock:
            return self.last_jpeg_bytes

    def get_telemetry(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "session_id": self.session_id,
                "is_connected": self.is_connected,
                "is_running": self.is_running,
                "fps": self.fps,
                "total_frames": self.total_frames,
                "active_tracks": self.active_tracks,
                "total_entered": self.total_entered,
                "current_inside": self.current_inside,
                "peak_occupancy": self.peak_occupancy,
            }

    def _dispatch_whatsapp_alert(self, count: int, frame: np.ndarray):
        """Dispatches an asynchronous WhatsApp alert to the local Baileys bridge."""
        def _send():
            try:
                import urllib.request
                import json
                import os
                
                os.makedirs("output/alerts", exist_ok=True)
                snapshot_file = f"output/alerts/alert_{self.session_id}_{int(time.time())}.jpg"
                cv2.imwrite(snapshot_file, frame)

                payload = {
                    "recipient": "923178761858",
                    "text": f"🚨 *VisionOps CCTV Alert: Intrusion Detected*\n\nTarget breach detected: {count} active object(s) inside monitored zone.\nTimestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}\nCamera: CAM-01 (Live Stream)",
                    "image_path": os.path.abspath(snapshot_file)
                }
                
                req = urllib.request.Request(
                    "http://localhost:3005/api/whatsapp/send-alert",
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    pass
            except Exception as e:
                pass  # Silently skip if WhatsApp bridge is offline or unlinked

        t = threading.Thread(target=_send, daemon=True)
        t.start()

    def stop(self):
        self.is_running = False
        if self.grabber_thread and self.grabber_thread.is_alive():
            self.grabber_thread.join(timeout=1.0)
        if self.inference_thread and self.inference_thread.is_alive():
            self.inference_thread.join(timeout=1.0)


class LiveStreamRegistry:
    """Registry managing active camera streams across the server."""
    _streams: Dict[str, LiveCameraWorker] = {}

    @classmethod
    def get_or_create(cls, session_id: str, stream_url: str, spec: Optional[WorkflowSpec] = None) -> LiveCameraWorker:
        if session_id in cls._streams:
            worker = cls._streams[session_id]
            if worker.stream_url != stream_url:
                worker.stop()
                worker = LiveCameraWorker(session_id, stream_url, spec)
                cls._streams[session_id] = worker
            return worker
        worker = LiveCameraWorker(session_id, stream_url, spec)
        cls._streams[session_id] = worker
        return worker

    @classmethod
    def get(cls, session_id: str) -> Optional[LiveCameraWorker]:
        return cls._streams.get(session_id)

    @classmethod
    def stop(cls, session_id: str):
        if session_id in cls._streams:
            cls._streams[session_id].stop()
            del cls._streams[session_id]
