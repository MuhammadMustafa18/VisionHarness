import time
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class DetectorConfig(BaseModel):
    model: str = Field(default="yolov8n.pt", description="Model weights or architecture")
    classes: List[str] = Field(default_factory=lambda: ["person"], description="Target class names to filter")
    confidence: float = Field(default=0.35, description="Confidence score threshold")


class TrackerConfig(BaseModel):
    tracker_type: str = Field(default="bytetrack", description="Tracking algorithm (bytetrack, botsort)")
    track_thresh: float = Field(default=0.25, description="Tracking confidence threshold")
    track_buffer: int = Field(default=30, description="Frames to retain lost tracks")
    match_thresh: float = Field(default=0.8, description="Matching threshold")


class Point2D(BaseModel):
    x: float
    y: float


class LineCrossingConfig(BaseModel):
    name: str = "entrance_line"
    start: Point2D = Field(default_factory=lambda: Point2D(x=0.1, y=0.5))
    end: Point2D = Field(default_factory=lambda: Point2D(x=0.9, y=0.5))
    trigger_in: bool = True
    trigger_out: bool = True


class ZoneConfig(BaseModel):
    name: str = "restricted_zone"
    polygon: List[Point2D]
    alert_on_entry: bool = True


class WorkflowOutputConfig(BaseModel):
    draw_bounding_boxes: bool = True
    draw_tracking_ids: bool = True
    draw_trails: bool = True
    draw_counters: bool = True
    save_annotated_video: bool = True
    emit_events_jsonl: bool = True


class WorkflowSpec(BaseModel):
    id: str = Field(default_factory=lambda: f"wf_{int(time.time())}", description="Unique workflow identifier")
    name: str = Field(default="Vision Workflow", description="Human readable name")
    description: str = Field(default="Automated vision detection and tracking", description="Description of the vision task")
    detector: DetectorConfig = Field(default_factory=DetectorConfig)
    tracker: Optional[TrackerConfig] = Field(default_factory=TrackerConfig)
    lines: List[LineCrossingConfig] = Field(default_factory=list)
    zones: List[ZoneConfig] = Field(default_factory=list)
    output: WorkflowOutputConfig = Field(default_factory=WorkflowOutputConfig)
    metadata: Dict[str, Any] = Field(default_factory=dict)
