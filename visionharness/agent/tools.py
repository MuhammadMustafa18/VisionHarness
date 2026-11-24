"""Unified VisionOps Tool Executor for Pi Agent Harness.

Wraps the existing core CV tools from `react_agent.execute_tool` and adds
high-value domain tools for video inspection, frame extraction, live CCTV
management, WhatsApp alert dispatch, and reusable workflow management.
"""

import os
import json
import time
import urllib.request
from typing import Any, Dict

from visionharness.agent.react_agent import execute_tool as execute_legacy_tool
from visionharness.core.spec import WorkflowSpec
from visionharness.runtime.live_stream import LiveStreamRegistry
from visionharness.runtime.camera_discovery import (
    discover_lan_cameras,
    build_candidate_urls,
    probe_camera_url,
)

DATA_DIR = os.getenv("VISIONHARNESS_DATA_DIR", ".")
WORKFLOWS_DIR = os.getenv("VISIONHARNESS_WORKFLOWS_DIR", os.path.join(DATA_DIR, "workflows"))
UPLOADS_DIR = os.getenv("VISIONHARNESS_UPLOADS_DIR", os.path.join(DATA_DIR, "uploads"))
WHATSAPP_BRIDGE_URL = os.getenv("WHATSAPP_BRIDGE_URL", "http://127.0.0.1:3001")

LEGACY_TOOLS = {
    "vlm_ground_scene",
    "get_scene_grounding",
    "query_inference_results",
    "search_components",
    "open_geometry_editor",
    "get_geometry_history",
    "run_pipeline",
}


def _inspect_video_metadata(tool_input: Dict[str, Any], workspace: Dict[str, Any]) -> Dict[str, Any]:
    import cv2

    video_path = tool_input.get("video_path") or workspace.get("video_path")
    if not video_path or not os.path.exists(video_path):
        return {"error": f"Video path '{video_path}' not found on server."}

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"error": f"Unable to open video file '{video_path}'."}

    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fourcc_int = int(cap.get(cv2.CAP_PROP_FOURCC) or 0)
        codec = "".join([chr((fourcc_int >> 8 * i) & 0xFF) for i in range(4)]).strip()
        duration_sec = round(frame_count / fps, 2) if fps > 0 and frame_count > 0 else 0.0
        size_mb = round(os.path.getsize(video_path) / (1024 * 1024), 2)
    finally:
        cap.release()

    return {
        "status": "success",
        "video_path": video_path,
        "video_name": os.path.basename(video_path),
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "frame_count": frame_count,
        "duration_sec": duration_sec,
        "codec": codec or "unknown",
        "file_size_mb": size_mb,
    }


def _extract_frame(tool_input: Dict[str, Any], workspace: Dict[str, Any]) -> Dict[str, Any]:
    import cv2

    video_path = tool_input.get("video_path") or workspace.get("video_path")
    if not video_path or not os.path.exists(video_path):
        return {"error": f"Video path '{video_path}' not found on server."}

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"error": f"Unable to open video file '{video_path}'."}

    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        frame_index = tool_input.get("frame_index")
        timestamp_sec = tool_input.get("timestamp_sec")

        if frame_index is not None:
            target_idx = max(0, min(int(frame_index), max(0, total_frames - 1)))
        elif timestamp_sec is not None:
            target_idx = max(0, min(int(float(timestamp_sec) * fps), max(0, total_frames - 1)))
        else:
            target_idx = total_frames // 2 if total_frames > 0 else 0

        cap.set(cv2.CAP_PROP_POS_FRAMES, target_idx)
        ok, frame = cap.read()
        if not ok or frame is None:
            return {"error": f"Failed to read frame at index {target_idx}."}

        os.makedirs(UPLOADS_DIR, exist_ok=True)
        fname = f"frame_{int(time.time())}_{target_idx}.jpg"
        out_path = os.path.join(UPLOADS_DIR, fname)
        cv2.imwrite(out_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
        h, w = frame.shape[:2]
    finally:
        cap.release()

    return {
        "status": "success",
        "frame_path": out_path,
        "frame_url": f"/uploads/{fname}",
        "frame_index": target_idx,
        "timestamp_sec": round(target_idx / fps, 2) if fps > 0 else 0.0,
        "width": w,
        "height": h,
    }


def _manage_live_stream(tool_input: Dict[str, Any], workspace: Dict[str, Any]) -> Dict[str, Any]:
    action = (tool_input.get("action") or "telemetry").lower()
    session_id = tool_input.get("session_id") or workspace.get("session_id") or "default_live"

    if action in ("telemetry", "status"):
        worker = LiveStreamRegistry.get(session_id)
        if not worker:
            return {"status": "offline", "session_id": session_id, "fps": 0, "active_tracks": 0}
        return {"status": "online", "session_id": session_id, "telemetry": worker.get_telemetry()}

    if action == "connect":
        stream_url = tool_input.get("stream_url") or workspace.get("stream_url")
        if not stream_url:
            return {"error": "stream_url is required to connect a live camera."}
        worker = LiveStreamRegistry.get_or_create(session_id, stream_url)
        snap = worker.connect_and_capture_snapshot()
        if snap is None:
            return {"error": f"Could not connect to camera stream at '{stream_url}'."}
        worker.start()
        return {
            "status": "connected",
            "session_id": session_id,
            "stream_url": stream_url,
            "telemetry": worker.get_telemetry(),
        }

    if action == "update_spec":
        worker = LiveStreamRegistry.get(session_id)
        if not worker:
            return {"error": f"No active live stream for session '{session_id}'."}
        spec_dict = tool_input.get("spec") or workspace.get("spec")
        if not spec_dict:
            return {"error": "spec is required to update live stream."}
        spec = WorkflowSpec.model_validate(spec_dict)
        worker.update_spec(spec)
        return {"status": "updated", "session_id": session_id}

    if action == "stop":
        LiveStreamRegistry.stop(session_id)
        return {"status": "stopped", "session_id": session_id}

    return {"error": f"Unsupported live stream action '{action}'. Use: telemetry, connect, update_spec, stop."}


def _send_whatsapp_alert(tool_input: Dict[str, Any], workspace: Dict[str, Any]) -> Dict[str, Any]:
    message = tool_input.get("message")
    if not message:
        return {"error": "message is required to send a WhatsApp alert."}

    payload: Dict[str, Any] = {"message": message}
    if tool_input.get("image_path"):
        payload["imagePath"] = tool_input["image_path"]
    if tool_input.get("to"):
        payload["to"] = tool_input["to"]

    url = f"{WHATSAPP_BRIDGE_URL.rstrip('/')}/api/send"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = {"raw": body}
            return {"status": "sent", "bridge_response": parsed}
    except Exception as e:
        return {
            "status": "error",
            "error": f"WhatsApp bridge unreachable or failed at {url}: {str(e)}",
        }


def _manage_workflows(tool_input: Dict[str, Any], workspace: Dict[str, Any]) -> Dict[str, Any]:
    action = (tool_input.get("action") or "list").lower()
    os.makedirs(WORKFLOWS_DIR, exist_ok=True)

    if action == "list":
        items = []
        for fname in sorted(os.listdir(WORKFLOWS_DIR)):
            if fname.endswith(".json"):
                path = os.path.join(WORKFLOWS_DIR, fname)
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    items.append({
                        "id": data.get("id", fname[:-5]),
                        "name": data.get("name", fname[:-5]),
                        "description": data.get("description", ""),
                        "file": fname,
                    })
                except Exception:
                    pass
        return {"status": "success", "workflows": items}

    if action == "get":
        wf_id = tool_input.get("workflow_id")
        if not wf_id:
            return {"error": "workflow_id is required for action='get'."}
        path = os.path.join(WORKFLOWS_DIR, f"{wf_id}.json")
        if not os.path.exists(path):
            return {"error": f"Workflow '{wf_id}' not found."}
        with open(path, "r", encoding="utf-8") as f:
            return {"status": "success", "workflow": json.load(f)}

    if action == "save":
        spec_dict = tool_input.get("spec") or workspace.get("spec")
        if not spec_dict:
            return {"error": "spec is required for action='save'."}
        spec = WorkflowSpec.model_validate(spec_dict)
        path = os.path.join(WORKFLOWS_DIR, f"{spec.id}.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(spec.model_dump_json(indent=2))
        return {"status": "saved", "id": spec.id, "path": path}

    return {"error": f"Unsupported workflow action '{action}'. Use: list, get, save."}


def _discover_cameras(tool_input: Dict[str, Any], workspace: Dict[str, Any]) -> Dict[str, Any]:
    timeout_sec = float(tool_input.get("timeout_sec") or 1.8)
    scan_subnet = tool_input.get("scan_subnet", True)
    return discover_lan_cameras(timeout_sec=timeout_sec, scan_subnet=bool(scan_subnet))


def _connect_camera_auto(tool_input: Dict[str, Any], workspace: Dict[str, Any]) -> Dict[str, Any]:
    ip = (tool_input.get("ip") or "").strip()
    if not ip:
        return {"error": "ip is required (or use '0' with manage_live_stream for local webcam)."}
    username = tool_input.get("username") or ""
    password = tool_input.get("password") or ""
    brand = tool_input.get("brand") or "auto"
    session_id = tool_input.get("session_id") or workspace.get("session_id") or "default_live"

    candidates = build_candidate_urls(ip, username=username, password=password, brand=brand)
    tried = []
    for url in candidates:
        tried.append(url)
        if probe_camera_url(url):
            worker = LiveStreamRegistry.get_or_create(session_id, url)
            snap = worker.connect_and_capture_snapshot()
            if snap is not None:
                worker.start()
                workspace["stream_url"] = url
                return {
                    "status": "connected",
                    "session_id": session_id,
                    "stream_url": url,
                    "brand": brand,
                    "telemetry": worker.get_telemetry(),
                }

    return {
        "status": "failed",
        "error": f"Could not connect to camera at {ip} after trying {len(tried)} common RTSP/HTTP paths. Verify credentials and ensure RTSP is enabled on the camera.",
        "tried_count": len(tried),
    }


def execute_vision_tool(tool_name: str, tool_input: Dict[str, Any], workspace: Dict[str, Any]) -> Dict[str, Any]:
    """Dispatch any VisionOps tool and return a JSON-serializable result dict."""
    if tool_name in LEGACY_TOOLS:
        return execute_legacy_tool(tool_name, tool_input, workspace)
    if tool_name == "inspect_video_metadata":
        return _inspect_video_metadata(tool_input, workspace)
    if tool_name == "extract_frame":
        return _extract_frame(tool_input, workspace)
    if tool_name == "manage_live_stream":
        return _manage_live_stream(tool_input, workspace)
    if tool_name == "discover_cameras":
        return _discover_cameras(tool_input, workspace)
    if tool_name == "connect_camera_auto":
        return _connect_camera_auto(tool_input, workspace)
    if tool_name == "send_whatsapp_alert":
        return _send_whatsapp_alert(tool_input, workspace)
    if tool_name == "manage_workflows":
        return _manage_workflows(tool_input, workspace)
    return {"error": f"Unknown tool: '{tool_name}'"}
