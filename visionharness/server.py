"""FastAPI Backend Server for VisionHarness.

Provides endpoints for:
- Authentication & System Status (Google Account vs API Key)
- Component Registry Exploration
- Natural Language Workflow Planning
- Workflow Specification Management
- Video Upload & Inference Execution
- Streaming/Serving Annotated Video Output
"""

import os
import json
import time
import shutil
from typing import Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from visionharness.agent.auth import get_auth_status, GoogleAccountBridge
from visionharness.agent.planner import plan_workflow
from visionharness.agent.grounding import ground_scene_with_vlm, stream_ground_scene_with_vlm
from visionharness.registry.components import search_components, get_component, REGISTRY
from visionharness.core.spec import (
    WorkflowSpec,
    DetectorConfig,
    TrackerConfig,
    LineCrossingConfig,
    ZoneConfig,
    Point2D,
    WorkflowOutputConfig,
)
from visionharness.runtime.engine import VisionRuntime, VideoSource
from visionharness.runtime.live_stream import LiveCameraWorker, LiveStreamRegistry
from visionharness.core.session_store import SessionStore, ChatMessage, SessionMetadata
from visionharness.core.diagram import generate_pipeline_svg

app = FastAPI(title="VisionHarness API", version="0.1.0")

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directories
# VISIONHARNESS_DATA_DIR lets the desktop build keep all writable state in the
# user's app-data folder instead of next to the installed binary.
DATA_DIR = os.getenv("VISIONHARNESS_DATA_DIR", ".")
WORKFLOWS_DIR = os.getenv("VISIONHARNESS_WORKFLOWS_DIR", os.path.join(DATA_DIR, "workflows"))
OUTPUTS_DIR = os.getenv("VISIONHARNESS_OUTPUTS_DIR", os.path.join(DATA_DIR, "output"))
UPLOADS_DIR = os.getenv("VISIONHARNESS_UPLOADS_DIR", os.path.join(DATA_DIR, "uploads"))

for d in [WORKFLOWS_DIR, OUTPUTS_DIR, UPLOADS_DIR]:
    os.makedirs(d, exist_ok=True)

# Mount outputs and uploads for direct video playback & thumbnail previews
app.mount("/output", StaticFiles(directory=OUTPUTS_DIR), name="output")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

# Live pipeline progress for /api/run/progress/{workflow_id}
ACTIVE_PIPELINE_PROGRESS: Dict[str, Any] = {}


@app.get("/api/run/progress/{workflow_id}")
def get_pipeline_progress(workflow_id: str):
    """Pollable live progress endpoint for active pipeline execution."""
    return ACTIVE_PIPELINE_PROGRESS.get(workflow_id, {"status": "idle", "progress_pct": 0})


class PlanRequest(BaseModel):
    prompt: str
    session_id: Optional[str] = "wf_store_people_counter"
    auth_mode: Optional[str] = "auto"  # 'google_account', 'api_key', 'auto'
    context_has_video: Optional[bool] = False
    last_video_name: Optional[str] = None
    last_inference_stats: Optional[Dict[str, Any]] = None


@app.get("/api/sessions")
def list_sessions():
    """List all saved chat sessions."""
    return SessionStore.list_sessions()


@app.get("/api/sessions/{session_id}/messages")
def get_session_messages(session_id: str):
    """Retrieve all chat messages for a session."""
    return SessionStore.get_messages(session_id)


@app.post("/api/sessions")
def create_session(meta: SessionMetadata):
    """Create a new chat session."""
    return SessionStore.get_or_create_session(meta.id, meta.name, meta.folder)


@app.post("/api/sessions/{session_id}/messages")
def append_message(session_id: str, message: ChatMessage):
    """Append a message to a session."""
    return SessionStore.append_message(session_id, message)


@app.get("/api/sessions/{session_id}/workspace")
def get_workspace(session_id: str):
    """Retrieve the persisted active workspace state for a session."""
    ws = SessionStore.get_workspace(session_id)
    if ws is None:
        return {}
    return ws


@app.put("/api/sessions/{session_id}/workspace")
def save_workspace(session_id: str, body: Dict[str, Any]):
    """Persist the active workspace state (spec, geometry, stats, video paths) for a session."""
    SessionStore.save_workspace(session_id, body)
    return {"status": "saved"}


@app.get("/api/status")
def status():
    """Return backend status and active auth mode."""
    auth = get_auth_status()
    import torch
    import psutil
    cuda_avail = False
    device_name = "CPU"
    try:
        cuda_avail = torch.cuda.is_available()
        if cuda_avail:
            device_name = torch.cuda.get_device_name(0)
    except Exception:
        pass

    return {
        "status": "ready",
        "version": "0.1.0",
        "auth": auth,
        "hardware": {
            "device": "cuda" if cuda_avail else "cpu",
            "device_name": device_name,
            "cpu_cores": psutil.cpu_count(logical=False),
            "logical_cores": psutil.cpu_count(logical=True),
            "typical_fps": 60.0 if cuda_avail else 12.0
        }
    }


from visionharness.agent.react_agent import stream_react_agent


@app.post("/api/upload")
async def upload_video_once(video: UploadFile = File(...)):
    """Upload footage once, save to disk, and return persistent path and preview url."""
    safe_filename = video.filename.replace(" ", "_") if video.filename else "footage.mp4"
    save_name = f"upload_{int(time.time())}_{safe_filename}"
    target_path = os.path.join(UPLOADS_DIR, save_name)
    with open(target_path, "wb") as f_out:
        shutil.copyfileobj(video.file, f_out)

    return {
        "video_path": target_path,
        "video_name": safe_filename,
        "video_url": f"/uploads/{save_name}"
    }


class AgentChatRequest(BaseModel):
    session_id: str
    prompt: str
    workspace: Optional[Dict[str, Any]] = None


@app.post("/api/agent")
async def react_agent_endpoint(req: AgentChatRequest):
    """Server-side autonomous ReAct agent streaming loop."""
    workspace = req.workspace or {}

    # Sync generator → Starlette runs it in a threadpool so blocking
    # LLM HTTP does not freeze the event loop (keeps SSE flushing live).
    def event_generator():
        yield f"data: {json.dumps({'type': 'start'})}\n\n"
        for chunk in stream_react_agent(
            session_id=req.session_id,
            user_prompt=req.prompt,
            workspace=workspace,
            max_iterations=6
        ):
            yield f"data: {json.dumps(chunk)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/components")
def list_components(category: Optional[str] = None, q: Optional[str] = None):
    """List or search verified CV components."""
    return search_components(query=q or "", category=category or "")


@app.post("/api/plan")
async def plan_pipeline(req: PlanRequest):
    """Decompose prompt into a CV workflow spec using Anthropic / MiMo or Antigravity SDK."""
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt cannot be empty.")

    try:
        raw_res = await plan_workflow(
            prompt,
            context_has_video=req.context_has_video or False,
            last_video_name=req.last_video_name,
            last_inference_stats=req.last_inference_stats,
        )
        clean_res = raw_res
        spec_obj = None

        if "```json" in clean_res:
            json_str = clean_res.split("```json")[1].split("```")[0].strip()
            try:
                spec_obj = json.loads(json_str)
            except Exception:
                pass
        elif "```" in clean_res:
            json_str = clean_res.split("```")[1].split("```")[0].strip()
            try:
                spec_obj = json.loads(json_str)
            except Exception:
                pass

        diagram_svg = generate_pipeline_svg(spec_obj) if spec_obj else ""
        # Extract conversational text without the raw json block
        conversational_text = raw_res
        if "```json" in conversational_text:
            conversational_text = conversational_text.split("```json")[0].strip()
        elif "```" in conversational_text:
            conversational_text = conversational_text.split("```")[0].strip()

        if not conversational_text:
            conversational_text = "Analysis complete."

        # If user is asking a question about previous stats and no new spec was provided, do not force a new spec
        is_qa_only = bool(req.last_inference_stats and "```" not in raw_res)
        final_spec = None if is_qa_only else spec_obj

        return {"plan_text": conversational_text, "spec": final_spec, "diagram_svg": diagram_svg}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/workflows")
def list_workflows():
    """List all saved workflow specifications."""
    workflows = []
    for f in os.listdir(WORKFLOWS_DIR):
        if f.endswith(".json"):
            p = os.path.join(WORKFLOWS_DIR, f)
            try:
                with open(p, "r", encoding="utf-8") as wf:
                    workflows.append(json.load(wf))
            except Exception:
                pass
    return workflows


@app.post("/api/workflows")
def save_workflow(spec: WorkflowSpec):
    """Save or update a workflow specification."""
    filename = f"{spec.id}.json"
    p = os.path.join(WORKFLOWS_DIR, filename)
    with open(p, "w", encoding="utf-8") as f:
        f.write(spec.model_dump_json(indent=2))
    return {"status": "saved", "path": p, "id": spec.id}


@app.post("/api/ground")
async def ground_video_scene(
    workflow_id: str = Form(...),
    prompt: Optional[str] = Form("Track entities in video"),
    video: Optional[UploadFile] = File(None),
    video_path: Optional[str] = Form(None),
):
    """VLM Scene Grounding Endpoint: Inspects sampled footage frames and streams the explanation."""
    target_video = video_path
    if video:
        safe_filename = video.filename.replace(" ", "_") if video.filename else "input.mp4"
        save_name = f"upload_{int(time.time())}_{safe_filename}"
        target_video = os.path.join(UPLOADS_DIR, save_name)
        with open(target_video, "wb") as f_out:
            shutil.copyfileobj(video.file, f_out)

    if not target_video or not os.path.exists(target_video):
        synthetic_path = "./tests/synthetic_test.mp4"
        if os.path.exists(synthetic_path):
            target_video = synthetic_path
        else:
            raise HTTPException(status_code=400, detail="A valid video file or path is required.")

    def event_stream():
        for chunk in stream_ground_scene_with_vlm(target_video, prompt):
            chunk["video_path"] = target_video
            chunk["video_name"] = os.path.basename(target_video)
            yield f"data: {json.dumps(chunk)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/run")
async def run_pipeline(
    workflow_id: str = Form(...),
    spec_json: Optional[str] = Form(None),
    video: Optional[UploadFile] = File(None),
    video_path: Optional[str] = Form(None),
    max_frames: Optional[int] = Form(None),
):
    """Execute a workflow against an uploaded video file or existing path/stream."""
    # Load workflow spec from spec_json or from workflows directory
    spec = None
    if spec_json:
        try:
            spec = WorkflowSpec.model_validate(json.loads(spec_json))
        except Exception:
            pass

    if spec is None:
        spec_path = os.path.join(WORKFLOWS_DIR, f"{workflow_id}.json")
        if os.path.exists(spec_path):
            with open(spec_path, "r", encoding="utf-8") as f:
                spec = WorkflowSpec.model_validate(json.load(f))
        else:
            # Fallback default workflow spec
            spec = WorkflowSpec(
                id=workflow_id,
                name="Auto Vision Pipeline",
                detector=DetectorConfig(model="yolov8n.pt", classes=["car", "person"], confidence=0.35),
                tracker=TrackerConfig(tracker_type="bytetrack"),
                lines=[LineCrossingConfig(name="traffic_line", trigger_in=True, trigger_out=True)]
            )

    # Resolve video source
    target_video = video_path
    if video:
        # Sanitize filename
        safe_filename = video.filename.replace(" ", "_") if video.filename else "input.mp4"
        save_name = f"upload_{int(time.time())}_{safe_filename}"
        target_video = os.path.join(UPLOADS_DIR, save_name)
        with open(target_video, "wb") as f_out:
            shutil.copyfileobj(video.file, f_out)

    if not target_video or not os.path.exists(target_video):
        # Fallback to synthetic test footage if available
        synthetic_path = "./tests/synthetic_test.mp4"
        if os.path.exists(synthetic_path):
            target_video = synthetic_path
        else:
            raise HTTPException(status_code=400, detail="A valid video file or path is required.")

    # Only ground scene if spec does NOT already contain confirmed zones or lines
    scene_analysis_text = None
    geometry_type = None
    has_existing_geometry = bool(spec.zones or spec.lines)
    if not has_existing_geometry:
        try:
            grounding_result = ground_scene_with_vlm(target_video, spec.description or spec.name)
            scene_analysis_text = grounding_result.get("scene_analysis")
            geometry_type = grounding_result.get("geometry_type")

            # Dynamically inject VLM grounded lines or zones
            if geometry_type == "polygon" and grounding_result.get("zones"):
                grounded_zones = []
                for z in grounding_result["zones"]:
                    poly_pts = [Point2D(x=pt["x"], y=pt["y"]) for pt in z.get("polygon", [])]
                    if len(poly_pts) >= 3:
                        grounded_zones.append(ZoneConfig(name=z.get("name", "zone"), polygon=poly_pts))
                if grounded_zones:
                    spec.zones = grounded_zones
                    spec.lines = []  # prioritize polygon zone
            elif grounding_result.get("lines"):
                grounded_lines = []
                for l in grounding_result["lines"]:
                    grounded_lines.append(
                        LineCrossingConfig(
                            name=l.get("name", "line"),
                            start=Point2D(x=l["start"]["x"], y=l["start"]["y"]),
                            end=Point2D(x=l["end"]["x"], y=l["end"]["y"]),
                            trigger_in=l.get("trigger_in", True),
                            trigger_out=l.get("trigger_out", True),
                        )
                    )
                if grounded_lines:
                    spec.lines = grounded_lines
        except Exception as e:
            print(f"[Grounding Warning] Failed to ground scene geometry: {e}")

    # Execute runtime
    output_video_rel = f"output_{spec.id}_{int(time.time())}.mp4"
    output_video_path = os.path.join(OUTPUTS_DIR, output_video_rel)

    source = VideoSource(target_video)
    runtime = VisionRuntime(spec)

    def on_progress(p: Dict[str, Any]):
        p["status"] = "running"
        ACTIVE_PIPELINE_PROGRESS[spec.id] = p

    try:
        stats = runtime.process_video(
            source,
            output_video_path=output_video_path,
            max_frames=max_frames,
            progress_callback=on_progress
        )
    finally:
        ACTIVE_PIPELINE_PROGRESS.pop(spec.id, None)

    stats["video_url"] = f"/output/{output_video_rel}"
    stats["scene_analysis"] = scene_analysis_text
    stats["geometry_type"] = geometry_type

    return stats


# ============================================================================
# Live CCTV Stream Endpoints (Connect, Instant Grounding, Telemetry, MJPEG)
# ============================================================================

class LiveConnectRequest(BaseModel):
    session_id: str
    stream_url: str
    goal: Optional[str] = "Track moving objects and people on live camera"


@app.post("/api/live/connect")
async def connect_live_stream(req: LiveConnectRequest):
    """Verifies live camera stream, captures snapshot, and triggers instant VLM scene grounding."""
    worker = LiveStreamRegistry.get_or_create(req.session_id, req.stream_url)
    snapshot = worker.connect_and_capture_snapshot()
    if snapshot is None:
        raise HTTPException(status_code=400, detail=f"Could not connect to camera stream at '{req.stream_url}'. Ensure stream is active and reachable.")

    # Save snapshot to uploads for VLM inspection and UI thumbnail
    snapshot_rel = f"live_snap_{req.session_id}_{int(time.time())}.jpg"
    snapshot_path = os.path.join(UPLOADS_DIR, snapshot_rel)
    import cv2
    cv2.imwrite(snapshot_path, snapshot, [cv2.IMWRITE_JPEG_QUALITY, 85])

    # Run VLM scene grounding on the captured frame
    grounding_data = {}
    try:
        grounding_data = ground_scene_with_vlm(snapshot_path, req.goal or "Track moving entities")
    except Exception as e:
        print(f"[LiveGrounding Error]: {e}")
        grounding_data = {
            "scene_analysis": "Live CCTV camera connected successfully. Stream is active.",
            "geometry_type": "polygon",
            "zones": [
                {
                    "name": "live_monitoring_zone",
                    "polygon": [{"x": 0.1, "y": 0.2}, {"x": 0.9, "y": 0.2}, {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}]
                }
            ]
        }

    # Automatically start worker in background
    worker.start()

    return {
        "status": "connected",
        "session_id": req.session_id,
        "stream_url": req.stream_url,
        "snapshot_url": f"/uploads/{snapshot_rel}",
        "snapshot_path": snapshot_path,
        "grounding": grounding_data,
        "telemetry": worker.get_telemetry()
    }


@app.get("/api/live/{session_id}/feed")
def live_mjpeg_feed(session_id: str):
    """Streams live MJPEG frames with real-time HUD and detections to browser."""
    worker = LiveStreamRegistry.get(session_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Live stream not found or not active.")

    def frame_generator():
        while worker.is_running:
            jpeg = worker.get_latest_jpeg()
            if jpeg:
                yield (b"--frame\r\n"
                       b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n")
            time.sleep(0.04)

    return StreamingResponse(frame_generator(), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/api/live/{session_id}/telemetry")
def get_live_telemetry(session_id: str):
    """Pollable endpoint for real-time stream telemetry (FPS, footfall, tracks, occupancy)."""
    worker = LiveStreamRegistry.get(session_id)
    if not worker:
        return {"status": "offline", "fps": 0, "active_tracks": 0, "total_entered": 0, "current_inside": 0}
    return worker.get_telemetry()


@app.post("/api/live/{session_id}/update-spec")
def update_live_spec(session_id: str, spec: WorkflowSpec):
    """Updates live tracking zones/lines and parameters on the active stream."""
    worker = LiveStreamRegistry.get(session_id)
    if worker:
        worker.update_spec(spec)
        return {"status": "updated"}
    return {"status": "not_found"}


@app.post("/api/live/{session_id}/stop")
def stop_live_stream(session_id: str):
    """Stops the live camera ingestion worker."""
    LiveStreamRegistry.stop(session_id)
    return {"status": "stopped"}

