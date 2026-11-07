"""Component Registry for Computer Vision Models, Trackers, and Event Detectors."""

from typing import Dict, List, Any
from pydantic import BaseModel, Field


class CVComponent(BaseModel):
    id: str
    name: str
    category: str  # detector, tracker, event_detector, segmenter
    supported_classes: List[str] = Field(default_factory=list)
    description: str
    strengths: List[str] = Field(default_factory=list)
    default_parameters: Dict[str, Any] = Field(default_factory=dict)


REGISTRY: Dict[str, CVComponent] = {
    # Detectors
    "yolov8n": CVComponent(
        id="yolov8n",
        name="YOLOv8 Nano (Ultralytics)",
        category="detector",
        supported_classes=["person", "bicycle", "car", "motorcycle", "bus", "truck", "backpack", "bottle", "chair"],
        description="Fast, lightweight object detector optimized for real-time edge or CPU/GPU processing.",
        strengths=["Real-time FPS", "Low latency", "Detects 80 COCO classes"],
        default_parameters={"confidence": 0.35, "iou": 0.45, "imgsz": 640}
    ),
    "yolo11n": CVComponent(
        id="yolo11n",
        name="YOLO11 Nano (Ultralytics)",
        category="detector",
        supported_classes=["person", "bicycle", "car", "motorcycle", "bus", "truck"],
        description="State of the art lightweight detector with improved feature extraction and low false positives.",
        strengths=["Latest architecture", "High accuracy on small objects", "Real-time"],
        default_parameters={"confidence": 0.40, "iou": 0.45, "imgsz": 640}
    ),
    "yolov8x": CVComponent(
        id="yolov8x",
        name="YOLOv8 Extra Large",
        category="detector",
        supported_classes=["person", "car", "truck"],
        description="High precision detector for dense or complex crowds where accuracy matters more than latency.",
        strengths=["Maximum precision", "Good with heavy occlusion"],
        default_parameters={"confidence": 0.50, "iou": 0.50, "imgsz": 1280}
    ),

    # Trackers
    "bytetrack": CVComponent(
        id="bytetrack",
        name="ByteTrack",
        category="tracker",
        description="Multi-object tracker associating every detection box including low-confidence detections.",
        strengths=["Handles occlusion well", "Low identity switching", "Very fast CPU/GPU association"],
        default_parameters={"track_thresh": 0.25, "track_buffer": 30, "match_thresh": 0.8}
    ),
    "botsort": CVComponent(
        id="botsort",
        name="BoT-SORT",
        category="tracker",
        description="Robust tracker with camera motion compensation and appearance features.",
        strengths=["Ideal for moving/panning cameras (PTZ/drones)", "High accuracy trajectory tracking"],
        default_parameters={"track_thresh": 0.3, "track_buffer": 30, "match_thresh": 0.7}
    ),

    # Event Detectors
    "line_crossing": CVComponent(
        id="line_crossing",
        name="Line Zone Crossing Counter",
        category="event_detector",
        description="Detects when tracked objects cross a virtual 2D line (inwards/outwards).",
        strengths=["Directional counting", "Entry/Exit audits", "Traffic count"],
        default_parameters={"trigger_in": True, "trigger_out": True}
    ),
    "polygon_zone": CVComponent(
        id="polygon_zone",
        name="Polygon Zone Occupancy / Dwell",
        category="event_detector",
        description="Monitors presence, occupancy, or dwell time inside arbitrary polygon zones.",
        strengths=["Restricted area monitoring", "Queue length tracking", "Loitering alert"],
        default_parameters={"alert_on_entry": True}
    )
}


def search_components(query: str = "", category: str = "") -> List[Dict[str, Any]]:
    """Search available CV components by query string and/or category."""
    results = []
    q = query.lower()
    cat = category.lower()
    for comp in REGISTRY.values():
        if cat and comp.category != cat:
            continue
        if q:
            match = (
                q in comp.id.lower()
                or q in comp.name.lower()
                or q in comp.description.lower()
                or any(q in c.lower() for c in comp.supported_classes)
            )
            if not match:
                continue
        results.append(comp.model_dump())
    return results


def get_component(component_id: str) -> Dict[str, Any]:
    """Retrieve details and default configurations for a component."""
    if component_id in REGISTRY:
        return REGISTRY[component_id].model_dump()
    return {"error": f"Component '{component_id}' not found."}
