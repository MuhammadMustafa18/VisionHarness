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
    ) -> Dict[str, Any]:
        """Runs the complete vision pipeline, annotates frames, and tallies events."""
        source.open()
        info = source.get_info()
        w, h, fps = info.get("width", 640), info.get("height", 480), info.get("fps", 30.0)

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

        try:
            for frame in source.frames():
                frame_count += 1
                if max_frames and frame_count > max_frames:
                    break

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

                for pz in self.polygon_zones:
                    is_in_zone = pz.trigger(detections=detections)
                    occ = int(np.sum(is_in_zone)) if is_in_zone is not None else 0
                    if occ > max_zone_occupancy:
                        max_zone_occupancy = occ

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

        return {
            "workflow_id": self.spec.id,
            "processed_frames": frame_count,
            "elapsed_seconds": round(elapsed, 2),
            "processed_fps": processed_fps,
            "in_count": total_in,
            "out_count": total_out,
            "unique_tracks": len(unique_track_ids),
            "max_zone_occupancy": max_zone_occupancy,
            "has_polygon_zones": len(self.polygon_zones) > 0,
            "output_video": output_video_path,
        }
