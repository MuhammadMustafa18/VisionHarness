"""Scene Grounding & Understanding Agent using VLM (MiMo / Anthropic Vision).

Samples representative footage frames and conducts pure visual understanding:
- Explains the physical scene in conversational natural language
- Details observed people, objects, coordinates, weather, and actions
- Recommends spatial geometry (polygon zones or crossing lines) with technical reasoning
- Emits normalized coordinates for verification before running heavy CV annotation.
"""

import os
import json
import base64
import socket
import cv2
import numpy as np
import requests
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


def sample_representative_frame(video_path: str, max_dimension: int = 640) -> str:
    """Extracts a representative, non-black frame from video and encodes as JPEG base64."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video for frame extraction: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1

    best_frame = None
    best_score = -1.0

    # Test key frames across the video duration to skip any black fade-in intros
    test_points = [0.20, 0.35, 0.50, 0.65, 0.10, 0.05]
    for pct in test_points:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total_frames * pct))
        ret, frame = cap.read()
        if ret and frame is not None:
            mean_b = float(np.mean(frame))
            var_b = float(np.var(frame))
            # Require minimum lighting; pick highest visual variance
            if mean_b > 15.0 and var_b > best_score:
                best_score = var_b
                best_frame = frame

    if best_frame is None:
        # Fallback to frame 0
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ret, best_frame = cap.read()

    cap.release()

    if best_frame is None:
        raise RuntimeError("Failed to capture a valid frame from the video source.")

    # Resize preserving aspect ratio
    h, w = best_frame.shape[:2]
    if max(h, w) > max_dimension:
        scale = max_dimension / float(max(h, w))
        best_frame = cv2.resize(best_frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    _, buffer = cv2.imencode(".jpg", best_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return base64.b64encode(buffer).decode("utf-8")


VLM_GROUNDING_PROMPT = (
    "You are VisionHarness Visual Grounding Architect.\n"
    "Look at this real camera footage frame. User vision goal: '{user_intent}'.\n\n"
    "Please analyze and return structured text with these exact sections:\n\n"
    "### SCENE OVERVIEW\n"
    "(1 concise paragraph explaining camera angle, wet pavement/lighting, weather, and general environment)\n\n"
    "### OBJECTS OBSERVED\n"
    "(Bulleted list of detected people, their positions, vehicles, umbrellas, or landmarks of interest)\n\n"
    "### PROPOSED TRACKING PLAN\n"
    "(Concise step-by-step strategy for detecting, tracking, and answering the user's question)\n\n"
    "### SPATIAL BOUNDARY LOGIC\n"
    "(Explain why polygon zone or directional line is chosen and how it isolates the area)\n\n"
    "### GEOMETRY\n"
    "```json\n"
    "{\n"
    '  "geometry_type": "polygon",\n'
    '  "zones": [\n'
    '    {"name": "active_zone", "polygon": [{"x": 0.1, "y": 0.25}, {"x": 0.95, "y": 0.25}, {"x": 0.95, "y": 0.98}, {"x": 0.1, "y": 0.98}]}\n'
    "  ],\n"
    '  "lines": []\n'
    "}\n"
    "```\n\n"
    "### CONFIRMATION\n"
    "Does this plan and zone setup look good to proceed with pipeline execution?"
)


def stream_ground_scene_with_vlm(video_path: str, user_intent: str):
    """Streams token-by-token visual scene grounding and yields thoughts, text, and final geometry."""
    frame_b64 = sample_representative_frame(video_path)

    base_url = os.getenv("ANTHROPIC_BASE_URL", "").rstrip("/")
    auth_token = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
    model = os.getenv("ANTHROPIC_MODEL", "mimo-v2.6-flash")

    if not base_url or not auth_token:
        fallback = ground_scene_with_vlm(video_path, user_intent)
        yield {"type": "text", "delta": fallback.get("formatted_text", "")}
        yield {"type": "done", "geometry_type": fallback.get("geometry_type", "line"), "zones": fallback.get("zones", []), "lines": fallback.get("lines", [])}
        return

    url = f"{base_url}/v1/messages"
    payload = {
        "model": model,
        "max_tokens": 3500,
        "stream": True,
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
                        "text": VLM_GROUNDING_PROMPT.format(user_intent=user_intent)
                    }
                ]
            }
        ]
    }

    try:
        res = requests.post(
            url,
            headers={
                "x-api-key": auth_token,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            },
            json=payload,
            stream=True,
            timeout=60
        )

        full_text = ""
        full_thinking = ""

        for line in res.iter_lines():
            if not line:
                continue
            decoded = line.decode("utf-8")
            if not decoded.startswith("data: "):
                continue
            data_str = decoded[6:]
            if data_str == "[DONE]":
                break

            try:
                event = json.loads(data_str)
                delta = event.get("delta", {})

                if "thinking" in delta:
                    th = delta["thinking"]
                    full_thinking += th
                    yield {"type": "thinking", "delta": th}

                if "text" in delta:
                    tx = delta["text"]
                    full_text += tx
                    yield {"type": "text", "delta": tx}

            except Exception:
                continue

        # Extract Geometry JSON
        geometry_type = "line"
        zones = []
        lines = []

        if "```json" in full_text:
            geom_str = full_text.split("```json")[1].split("```")[0].strip()
            try:
                geom = json.loads(geom_str)
                geometry_type = geom.get("geometry_type", "polygon")
                zones = geom.get("zones", [])
                lines = geom.get("lines", [])
            except Exception:
                pass

        yield {
            "type": "done",
            "full_text": full_text,
            "full_thinking": full_thinking,
            "geometry_type": geometry_type,
            "zones": zones,
            "lines": lines
        }

    except Exception as e:
        print(f"[Grounding Stream Error] {e}")
        fallback = ground_scene_with_vlm(video_path, user_intent)
        yield {"type": "text", "delta": fallback.get("formatted_text", "")}
        yield {"type": "done", "geometry_type": fallback.get("geometry_type", "line"), "zones": fallback.get("zones", []), "lines": fallback.get("lines", [])}
def ground_scene_with_vlm(video_path: str, user_intent: str) -> Dict[str, Any]:
    """Inspects video frame with VLM and returns completed payload."""
    last_event = {}
    accumulated_text = ""
    for ev in stream_ground_scene_with_vlm(video_path, user_intent):
        if ev.get("type") == "text":
            accumulated_text += ev.get("delta", "")
        elif ev.get("type") == "done":
            last_event = ev

    clean_text = accumulated_text or last_event.get("full_text", "")
    if "### GEOMETRY" in clean_text:
        parts = clean_text.split("### GEOMETRY")
        before_geom = parts[0].strip()
        after_geom = ""
        if "### CONFIRMATION" in parts[1]:
            after_geom = "\n\n### CONFIRMATION\n" + parts[1].split("### CONFIRMATION")[1].strip()
        clean_text = f"{before_geom}{after_geom}"

    return {
        "formatted_text": clean_text.strip(),
        "geometry_type": last_event.get("geometry_type", "line"),
        "zones": last_event.get("zones", []),
        "lines": last_event.get("lines", []),
        "full_thinking": last_event.get("full_thinking", "")
    }
