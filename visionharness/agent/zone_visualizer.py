"""Standalone Zone Overlay Visualizer for VisionHarness.

Renders the VLM's proposed polygon or line geometry directly onto the actual
representative video frame from the footage, saving an annotated preview image.

DOES NOT modify or integrate into the main loop yet. Can be used standalone or tested directly.
"""

import os
import cv2
import numpy as np
from typing import Dict, Any, List, Optional, Tuple


def extract_base_frame(video_path: str, max_dimension: int = 1280) -> np.ndarray:
    """Extracts a sharp, representative frame directly as an OpenCV BGR numpy array."""
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    best_frame = None
    best_score = -1.0

    # Test key frames to avoid black intro frames
    test_points = [0.20, 0.35, 0.50, 0.65, 0.10, 0.05]
    for pct in test_points:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total_frames * pct))
        ret, frame = cap.read()
        if ret and frame is not None:
            mean_b = float(np.mean(frame))
            var_b = float(np.var(frame))
            if mean_b > 15.0 and var_b > best_score:
                best_score = var_b
                best_frame = frame

    if best_frame is None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ret, best_frame = cap.read()

    cap.release()

    if best_frame is None:
        raise RuntimeError(f"Could not read any valid frame from {video_path}")

    # Resize while preserving aspect ratio if larger than max_dimension
    h, w = best_frame.shape[:2]
    if max(h, w) > max_dimension:
        scale = max_dimension / float(max(h, w))
        best_frame = cv2.resize(best_frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    return best_frame


def draw_polygon_overlay(
    image: np.ndarray,
    polygon_points: List[Dict[str, float]],
    color: Tuple[int, int, int] = (0, 230, 118),  # Vibrant Emerald green (BGR)
    alpha: float = 0.28,
    border_thickness: int = 3,
    label: Optional[str] = None
) -> np.ndarray:
    """Renders a semi-transparent polygon with a crisp border onto the image.

    Args:
        image: Original BGR frame
        polygon_points: List of normalized coordinate dicts [{'x': 0.1, 'y': 0.25}, ...]
        color: (B, G, R) tuple for polygon color
        alpha: Transparency factor (0.0 = invisible, 1.0 = solid)
        border_thickness: Thickness of polygon border in pixels
        label: Optional text badge to display on the polygon
    """
    if not polygon_points or len(polygon_points) < 3:
        return image

    h, w = image.shape[:2]
    pts = np.array([[int(p["x"] * w), int(p["y"] * h)] for p in polygon_points], np.int32)
    pts = pts.reshape((-1, 1, 2))

    overlay = image.copy()
    # 1. Fill polygon with semi-transparent tint
    cv2.fillPoly(overlay, [pts], color)
    annotated = cv2.addWeighted(overlay, alpha, image, 1.0 - alpha, 0)

    # 2. Draw solid border
    cv2.polylines(annotated, [pts], isClosed=True, color=color, thickness=border_thickness, lineType=cv2.LINE_AA)

    # 3. Draw subtle vertex markers
    for pt in pts:
        x, y = pt[0]
        cv2.circle(annotated, (x, y), 5, (255, 255, 255), -1, lineType=cv2.LINE_AA)
        cv2.circle(annotated, (x, y), 5, color, 1, lineType=cv2.LINE_AA)

    # 4. Optional label badge
    if label:
        min_x = int(np.min(pts[:, 0, 0]))
        min_y = int(np.min(pts[:, 0, 1]))
        badge_y = max(25, min_y - 8)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        cv2.rectangle(
            annotated,
            (min_x, badge_y - th - 6),
            (min_x + tw + 14, badge_y + 4),
            (15, 17, 23),
            -1
        )
        cv2.rectangle(
            annotated,
            (min_x, badge_y - th - 6),
            (min_x + tw + 14, badge_y + 4),
            color,
            1
        )
        cv2.putText(
            annotated,
            label,
            (min_x + 7, badge_y - 2),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 255, 255),
            1,
            cv2.LINE_AA
        )

    return annotated


def render_vlm_zones_on_frame(
    video_path: str,
    zones: List[Dict[str, Any]],
    output_path: Optional[str] = None
) -> str:
    """Extracts a frame from video_path, draws all VLM suggested zones on it, and saves the image.

    Args:
        video_path: Path to the input video file
        zones: List of zone dicts from VLM, e.g. [{'name': 'active_zone', 'polygon': [{'x': 0.1, 'y': 0.25}, ...]}]
        output_path: Optional path to save the resulting JPEG/PNG. Defaults to ./output/zone_preview_<name>.jpg

    Returns:
        The absolute path to the generated preview image.
    """
    frame = extract_base_frame(video_path)

    # Color palette for multiple zones
    palette = [
        (0, 230, 118),   # Emerald green
        (255, 170, 0),   # Amber
        (238, 76, 44),   # Coral / Crimson
        (0, 168, 255),   # Sky blue
    ]

    annotated = frame
    for idx, zone in enumerate(zones):
        poly = zone.get("polygon") or []
        name = zone.get("name") or f"Zone {idx + 1}"
        color = palette[idx % len(palette)]
        annotated = draw_polygon_overlay(annotated, poly, color=color, label=name)

    if not output_path:
        os.makedirs("./output", exist_ok=True)
        base_name = os.path.splitext(os.path.basename(video_path))[0]
        output_path = os.path.join("./output", f"vlm_polygon_{base_name}.jpg")

    cv2.imwrite(output_path, annotated, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return os.path.abspath(output_path)


if __name__ == "__main__":
    import sys
    # Quick standalone test if run directly
    sample_video = "./uploads/upload_1794164485_The_CCTV_People_Demo_2.mp4"
    if not os.path.exists(sample_video):
        sample_video = [os.path.join("./uploads", f) for f in os.listdir("./uploads") if f.endswith(".mp4")][0]

    test_zones = [
        {
            "name": "vlm_suggested_zone",
            "polygon": [
                {"x": 0.10, "y": 0.25},
                {"x": 0.95, "y": 0.25},
                {"x": 0.95, "y": 0.98},
                {"x": 0.10, "y": 0.98}
            ]
        }
    ]

    saved_path = render_vlm_zones_on_frame(sample_video, test_zones)
    print(f"Generated standalone zone overlay preview at:\n{saved_path}")
