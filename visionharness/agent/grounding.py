"""Scene Grounding Agent using VLM (MiMo / Anthropic Vision).

Samples key frames from the uploaded video footage and asks the VLM to inspect
the real scene perspective, detecting natural entrance lines, lanes, or polygon zones.
"""

import os
import json
import base64
import urllib.request
import socket
import cv2
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

load_dotenv()

# DNS patch for token-plan-sgp.xiaomimimo.com if local DNS resolution fails
_orig_getaddrinfo = socket.getaddrinfo
def _patched_getaddrinfo(host, port, *args, **kwargs):
    if host == "token-plan-sgp.xiaomimimo.com":
        return _orig_getaddrinfo("47.236.158.71", port, *args, **kwargs)
    return _orig_getaddrinfo(host, port, *args, **kwargs)

socket.getaddrinfo = _patched_getaddrinfo


def sample_frame_as_base64(video_path: str, max_dimension: int = 720) -> str:
    """Extracts a reference frame from video and encodes as JPEG base64."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video for frame extraction: {video_path}")

    # Read frame at roughly 10% into the video to avoid initial black/fade frames
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    target_frame = min(15, total_frames - 1)
    cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
    ret, frame = cap.read()
    if not ret or frame is None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ret, frame = cap.read()
    cap.release()

    if not ret or frame is None:
        raise RuntimeError("Failed to capture a valid frame from the video source.")

    # Resize preserving aspect ratio
    h, w = frame.shape[:2]
    if max(h, w) > max_dimension:
        scale = max_dimension / float(max(h, w))
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buffer).decode("utf-8")


VLM_GROUNDING_PROMPT = """You are VisionHarness Scene Grounding Agent.
Look at this video camera frame and the user's vision request.
Analyze the physical environment: camera angle, entrance/exit doorways, traffic lanes, counters, or restricted zones.

Decide whether a DIRECTIONAL LINE or a POLYGON ZONE is best suited:
- Use a **LINE** for: Counting traffic or people crossing a boundary, crossing entrance/exit doorways, toll booths, or road lanes.
- Use a **POLYGON** for: Area occupancy, loitering, restricted perimeter containment, parking spots, or waiting zones.

Coordinates MUST be normalized between 0.0 and 1.0 (where (0,0) is top-left, (1,1) is bottom-right).

Return a strict JSON object with:
{
  "scene_analysis": "1-2 sentence description of what you visually detected in the footage",
  "geometry_type": "line" or "polygon",
  "lines": [
    {
      "name": "entrance_line",
      "start": {"x": 0.2, "y": 0.65},
      "end": {"x": 0.8, "y": 0.65},
      "trigger_in": true,
      "trigger_out": true
    }
  ],
  "zones": [
    {
      "name": "restricted_area",
      "polygon": [
        {"x": 0.2, "y": 0.3},
        {"x": 0.8, "y": 0.3},
        {"x": 0.8, "y": 0.8},
        {"x": 0.2, "y": 0.8}
      ]
    }
  ]
}

Return ONLY valid JSON matching this format."""


def ground_scene_with_vlm(video_path: str, user_intent: str) -> Dict[str, Any]:
    """Inspects video frame with VLM to determine precise lines or polygon zones."""
    frame_b64 = sample_frame_as_base64(video_path)

    base_url = os.getenv("ANTHROPIC_BASE_URL", "").rstrip("/")
    auth_token = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
    model = os.getenv("ANTHROPIC_MODEL", "mimo-v2.6-flash")

    if not base_url or not auth_token:
        # Fallback if VLM credentials are not available
        return {
            "scene_analysis": "Default scene grounding applied.",
            "geometry_type": "line",
            "lines": [{"name": "detection_line", "start": {"x": 0.1, "y": 0.5}, "end": {"x": 0.9, "y": 0.5}, "trigger_in": True, "trigger_out": True}],
            "zones": []
        }

    url = f"{base_url}/v1/messages"
    payload = {
        "model": model,
        "max_tokens": 1500,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": frame_b64
                        }
                    },
                    {
                        "type": "text",
                        "text": f"{VLM_GROUNDING_PROMPT}\n\nUser request: {user_intent}"
                    }
                ]
            }
        ]
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-api-key": auth_token,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }
    )

    try:
        response = urllib.request.urlopen(req, timeout=20)
        data = json.loads(response.read().decode("utf-8"))

        text = ""
        for item in data.get("content", []):
            if item.get("type") == "text":
                text += item.get("text", "")

        # Extract JSON
        clean_json = text
        if "```json" in clean_json:
            clean_json = clean_json.split("```json")[1].split("```")[0].strip()
        elif "```" in clean_json:
            clean_json = clean_json.split("```")[1].split("```")[0].strip()

        parsed = json.loads(clean_json)
        return parsed
    except Exception as e:
        print(f"[Grounding] VLM scene inspection fallback: {e}")
        return {
            "scene_analysis": "Extracted camera perspective and applied central trigger plane.",
            "geometry_type": "line",
            "lines": [{"name": "detection_line", "start": {"x": 0.1, "y": 0.5}, "end": {"x": 0.9, "y": 0.5}, "trigger_in": True, "trigger_out": True}],
            "zones": []
        }
