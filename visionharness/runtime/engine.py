"""Vision Runtime Engine.

Interprets declarative WorkflowSpec and executes inference on any video source:
- Uploaded MP4 / AVI video files
- RTSP / CCTV network streams
- Webcam feeds
"""

import os
import json
import time
from typing import Optional, Generator, Dict, Any, Tuple
import cv2
import numpy as np

# We import supervision and ultralytics
import supervision as sv
from ultralytics import YOLO

from visionharness.core.spec import WorkflowSpec, Point2D


class VideoSource:
    """Abstract video source adapter."""
    def __init__(self, source_path_or_index: str | int):
        self.source = source_path_or_index
        self.cap: Optional[cv2.VideoCapture] = None

    def open(self):
        self.cap = cv2.VideoCapture(self.source)
        if not self.cap.isOpened():
            raise RuntimeError(f"Unable to open video source: {self.source}")
        return self

    def get_info(self) -> Dict[str, Any]:
        if not self.cap:
            return {}
        return {
            "width": int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "fps": float(self.cap.get(cv2.CAP_PROP_FPS)) or 30.0,
            "total_frames": int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        }

    def frames(self) -> Generator[np.ndarray, None, None]:
        if not self.cap:
            self.open()
        while self.cap.isOpened():
            ret, frame = self.cap.read()
            if not ret:
                break
            yield frame

    def close(self):
        if self.cap:
            self.cap.release()
            self.cap = None


class VisionRuntime:
    """Executes a WorkflowSpec against a video source."""

    def __init__(self, spec: WorkflowSpec):
        self.spec = spec
        # Setup detector model
        model_name = spec.detector.model
        if not model_name.endswith(".pt"):
            model_name = f"{model_name}.pt"
        self.model = YOLO(model_name)

        # Annotators via supervision
        self.box_annotator = sv.BoxAnnotator(thickness=2)
        self.label_annotator = sv.LabelAnnotator(text_scale=0.5, text_thickness=1)
        self.trace_annotator = sv.TraceAnnotator(thickness=2, trace_length=50)

        # Line zones for in/out counting
        self.line_zones = []
        self.line_zone_annotators = []

        # Polygon zones for area containment / occupancy
        self.polygon_zones = []
        self.polygon_zone_annotators = []

    def _setup_spatial_geometry(self, frame_width: int, frame_height: int):
        self.line_zones = []
        self.line_zone_annotators = []
        self.polygon_zones = []
        self.polygon_zone_annotators = []

        # 1. Setup Polygon Zones if requested
        if self.spec.zones:
            for zone_spec in self.spec.zones:
                pts = []
                for pt in zone_spec.polygon:
                    px = int(pt.x * frame_width) if pt.x <= 1.0 else int(pt.x)
                    py = int(pt.y * frame_height) if pt.y <= 1.0 else int(pt.y)
                    pts.append([px, py])
                if len(pts) >= 3:
                    polygon_np = np.array(pts, dtype=np.int32)
                    pz = sv.PolygonZone(polygon=polygon_np)
                    pza = sv.PolygonZoneAnnotator(zone=pz, color=sv.Color.RED, thickness=2, text_scale=0.6)
                    self.polygon_zones.append(pz)
                    self.polygon_zone_annotators.append(pza)

        # 2. Setup Line Zones if spec has lines or if no zones were defined
        if self.spec.lines or not self.polygon_zones:
            if not self.spec.lines:
                # Default line crossing horizontally across the middle if none specified
                mid_y = int(frame_height * 0.5)
                start = sv.Point(int(frame_width * 0.1), mid_y)
                end = sv.Point(int(frame_width * 0.9), mid_y)
                lz = sv.LineZone(start=start, end=end)
                self.line_zones.append(lz)
                self.line_zone_annotators.append(sv.LineZoneAnnotator(thickness=2, text_scale=0.6))
            else:
                for l in self.spec.lines:
                    # Handle relative (0.0 - 1.0) or absolute coords
                    sx = int(l.start.x * frame_width) if l.start.x <= 1.0 else int(l.start.x)
                    sy = int(l.start.y * frame_height) if l.start.y <= 1.0 else int(l.start.y)
                    ex = int(l.end.x * frame_width) if l.end.x <= 1.0 else int(l.end.x)
                    ey = int(l.end.y * frame_height) if l.end.y <= 1.0 else int(l.end.y)
                    lz = sv.LineZone(start=sv.Point(sx, sy), end=sv.Point(ex, ey))
                    self.line_zones.append(lz)
                    self.line_zone_annotators.append(sv.LineZoneAnnotator(thickness=2, text_scale=0.6))

    def process_video(
        self,
        source: VideoSource,
        output_video_path: Optional[str] = None,
        max_frames: Optional[int] = None,
        progress_callback: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Runs the complete vision pipeline, annotates frames, and tallies events."""
        source.open()
        info = source.get_info()
        w, h, fps = info.get("width", 640), info.get("height", 480), info.get("fps", 30.0)
        total_frames = info.get("total_frames", 0)

        self._setup_spatial_geometry(w, h)

        writer = None
        if output_video_path:
            os.makedirs(os.path.dirname(os.path.abspath(output_video_path)), exist_ok=True)
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(output_video_path, fourcc, fps, (w, h))

        frame_count = 0
        start_time = time.time()
        max_zone_occupancy = 0
        unique_track_ids = set()

        # Modular zone analytics per polygon (footfall, dwell, peak)
        zone_analytics: Dict[str, Dict[str, Any]] = {}
        for z in (self.spec.zones or []):
            zone_analytics[z.name] = {
                "unique_visitors": set(),
                "id_frames": {},      # track_id -> count of frames inside polygon
                "dwell_times": {},    # track_id -> float seconds spent inside
                "peak_occupancy": 0
            }

        try:
            for frame in source.frames():
                frame_count += 1
                if max_frames and frame_count > max_frames:
                    break

                # Progress feedback emission every 25 frames
                if progress_callback and (frame_count % 25 == 0 or frame_count == total_frames):
                    now_elapsed = time.time() - start_time
                    cur_fps = round(frame_count / now_elapsed, 1) if now_elapsed > 0 else 0
                    pct = round((frame_count / total_frames) * 100, 1) if total_frames > 0 else 0
                    progress_callback({
                        "frame": frame_count,
                        "total_frames": total_frames,
                        "progress_pct": pct,
                        "fps": cur_fps,
                        "unique_tracks": len(unique_track_ids)
                    })

                # 1. Inference and Tracking (ByteTrack)
                tracker_cfg = "bytetrack.yaml"
                if self.spec.tracker and self.spec.tracker.tracker_type == "botsort":
                    tracker_cfg = "botsort.yaml"

                results = self.model.track(
                    frame,
                    persist=True,
                    tracker=tracker_cfg,
                    conf=self.spec.detector.confidence,
                    classes=[0] if "person" in self.spec.detector.classes else None,
                    verbose=False,
                )[0]

                # Convert to Supervision Detections
                detections = sv.Detections.from_ultralytics(results)
                if detections.tracker_id is not None:
                    for tid in detections.tracker_id:
                        unique_track_ids.add(int(tid))

                # 2. Trigger spatial geometry (lines & polygon zones)
                for lz in self.line_zones:
                    lz.trigger(detections=detections)

                for i, (pz, z_spec) in enumerate(zip(self.polygon_zones, self.spec.zones or [])):
                    is_in_zone = pz.trigger(detections=detections)
                    occ = int(np.sum(is_in_zone)) if is_in_zone is not None else 0
                    if occ > max_zone_occupancy:
                        max_zone_occupancy = occ

                    # Modular Layer 3: Zone Footfall & Dwell Tracking per ID
                    z_data = zone_analytics.get(z_spec.name)
                    if z_data is not None:
                        if occ > z_data["peak_occupancy"]:
                            z_data["peak_occupancy"] = occ

                        if detections.tracker_id is not None and is_in_zone is not None:
                            for inside, tid_val in zip(is_in_zone, detections.tracker_id):
                                if inside:
                                    tid = int(tid_val)
                                    cur_f = z_data["id_frames"].get(tid, 0) + 1
                                    z_data["id_frames"][tid] = cur_f
                                    # Calculate dwell time in seconds (fps-based)
                                    z_data["dwell_times"][tid] = round(cur_f / (fps or 30.0), 2)
                                    # Noise filter: confirmed visitor after >= 5 frames in polygon (~0.2s)
                                    if cur_f >= 5:
                                        z_data["unique_visitors"].add(tid)

                # 3. Rendering & Annotations
                annotated_frame = frame.copy()

                if self.spec.output.draw_trails and detections.tracker_id is not None:
                    annotated_frame = self.trace_annotator.annotate(
                        scene=annotated_frame, detections=detections
                    )

                if self.spec.output.draw_bounding_boxes:
                    annotated_frame = self.box_annotator.annotate(
                        scene=annotated_frame, detections=detections
                    )

                if self.spec.output.draw_tracking_ids and detections.tracker_id is not None:
                    labels = [f"#{tid}" for tid in detections.tracker_id]
                    annotated_frame = self.label_annotator.annotate(
                        scene=annotated_frame, detections=detections, labels=labels
                    )

                if self.spec.output.draw_counters:
                    for lz, lz_annotator in zip(self.line_zones, self.line_zone_annotators):
                        annotated_frame = lz_annotator.annotate(
                            frame=annotated_frame, line_counter=lz
                        )
                    for pz, pz_annotator in zip(self.polygon_zones, self.polygon_zone_annotators):
                        annotated_frame = pz_annotator.annotate(
                            scene=annotated_frame
                        )

                # 4. Live Top-Left On-Screen HUD Overlay
                if getattr(self.spec.output, "draw_hud", True):
                    hud_lines = []

                    # Zone visitor / footfall metrics
                    if zone_analytics:
                        primary_z_name = list(zone_analytics.keys())[0]
                        primary_z = zone_analytics[primary_z_name]
                        zone_visitors = len(primary_z["unique_visitors"])
                        # Current instantaneous occupancy inside primary zone
                        cur_in_zone = 0
                        if self.polygon_zones:
                            cur_p_check = self.polygon_zones[0].trigger(detections=detections)
                            cur_in_zone = int(np.sum(cur_p_check)) if cur_p_check is not None else 0

                        hud_lines.append((f"{primary_z_name.replace('_', ' ').title()} Entered", str(zone_visitors), (46, 213, 115)))
                        hud_lines.append(("Current Inside", str(cur_in_zone), (56, 189, 248)))
                        hud_lines.append(("Peak Inside", str(primary_z["peak_occupancy"]), (255, 177, 66)))

                        # Average dwell time if visitors exist
                        if primary_z["dwell_times"]:
                            avg_dwell = round(sum(primary_z["dwell_times"].values()) / len(primary_z["dwell_times"]), 1)
                            hud_lines.append(("Avg Dwell", f"{avg_dwell}s", (220, 220, 220)))

                    # Line crossing metrics
                    if self.line_zones:
                        total_in = sum(lz.in_count for lz in self.line_zones)
                        total_out = sum(lz.out_count for lz in self.line_zones)
                        hud_lines.append(("Line Cross IN", str(total_in), (56, 189, 248)))
                        hud_lines.append(("Line Cross OUT", str(total_out), (255, 107, 129)))

                    # Global tracker tracks
                    hud_lines.append(("Active Tracks", str(len(detections.tracker_id) if detections.tracker_id is not None else 0), (164, 176, 190)))

                    if hud_lines:
                        pad_x, pad_y = 14, 10
                        line_h = 22
                        num_lines = len(hud_lines)
                        box_w = 260
                        box_h = pad_y * 2 + num_lines * line_h

                        x1, y1 = 18, 18
                        x2, y2 = x1 + box_w, y1 + box_h

                        # Draw semi-transparent dark HUD card
                        overlay = annotated_frame.copy()
                        cv2.rectangle(overlay, (x1, y1), (x2, y2), (20, 22, 26), -1)
                        cv2.rectangle(overlay, (x1, y1), (x2, y2), (65, 72, 85), 1)
                        alpha = 0.78
                        cv2.addWeighted(overlay, alpha, annotated_frame, 1 - alpha, 0, annotated_frame)

                        # Render stat lines
                        cur_y = y1 + pad_y + 15
                        for label, val_text, color in hud_lines:
                            cv2.putText(
                                annotated_frame,
                                label,
                                (x1 + pad_x, cur_y),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.44,
                                (200, 205, 215),
                                1,
                                cv2.LINE_AA,
                            )
                            (vw, _), _ = cv2.getTextSize(val_text, cv2.FONT_HERSHEY_SIMPLEX, 0.52, 2)
                            cv2.putText(
                                annotated_frame,
                                val_text,
                                (x2 - pad_x - vw, cur_y),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.52,
                                color,
                                2,
                                cv2.LINE_AA,
                            )
                            cur_y += line_h

                if writer:
                    writer.write(annotated_frame)

        finally:
            if writer:
                writer.release()
            source.close()

        # Re-encode to H.264 via ffmpeg for universal web browser playback
        if output_video_path and os.path.exists(output_video_path):
            temp_raw = f"{output_video_path}.raw.mp4"
            try:
                os.rename(output_video_path, temp_raw)
                import subprocess
                cmd = [
                    "ffmpeg", "-y", "-i", temp_raw,
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-preset", "ultrafast", "-crf", "23",
                    output_video_path
                ]
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                if os.path.exists(temp_raw):
                    os.remove(temp_raw)
            except Exception:
                # If ffmpeg conversion fails for any reason, restore raw video
                if os.path.exists(temp_raw) and not os.path.exists(output_video_path):
                    os.rename(temp_raw, output_video_path)

        elapsed = time.time() - start_time
        processed_fps = round(frame_count / elapsed, 2) if elapsed > 0 else 0

        # Collect aggregate metrics
        total_in = sum(lz.in_count for lz in self.line_zones)
        total_out = sum(lz.out_count for lz in self.line_zones)

        # Format modular zone analytics summary
        formatted_zone_analytics: Dict[str, Dict[str, Any]] = {}
        for z_name, z_d in zone_analytics.items():
            dwell_vals = list(z_d["dwell_times"].values())
            avg_dwell = round(sum(dwell_vals) / len(dwell_vals), 2) if dwell_vals else 0.0
            max_dwell = round(max(dwell_vals), 2) if dwell_vals else 0.0
            formatted_zone_analytics[z_name] = {
                "total_entered": len(z_d["unique_visitors"]),
                "peak_occupancy": z_d["peak_occupancy"],
                "avg_dwell_seconds": avg_dwell,
                "max_dwell_seconds": max_dwell
            }

        # If a single polygon zone was used, expose total_zone_entered at top level for easy retrieval
        primary_zone_entered = next(iter(formatted_zone_analytics.values()))["total_entered"] if formatted_zone_analytics else 0

        return {
            "workflow_id": self.spec.id,
            "processed_frames": frame_count,
            "elapsed_seconds": round(elapsed, 2),
            "processed_fps": processed_fps,
            "in_count": total_in,
            "out_count": total_out,
            "unique_tracks": len(unique_track_ids),
            "total_zone_entered": primary_zone_entered,
            "max_zone_occupancy": max_zone_occupancy,
            "zone_analytics": formatted_zone_analytics,
            "has_polygon_zones": len(self.polygon_zones) > 0,
            "output_video": output_video_path,
        }
