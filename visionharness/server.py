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
WORKFLOWS_DIR = os.getenv("VISIONHARNESS_WORKFLOWS_DIR", "./workflows")
OUTPUTS_DIR = "./output"
UPLOADS_DIR = "./uploads"

for d in [WORKFLOWS_DIR, OUTPUTS_DIR, UPLOADS_DIR]:
    os.makedirs(d, exist_ok=True)

# Mount outputs for direct video playback
app.mount("/output", StaticFiles(directory=OUTPUTS_DIR), name="output")


class PlanRequest(BaseModel):
    prompt: str
    session_id: Optional[str] = "wf_store_people_counter"
    auth_mode: Optional[str] = "auto"  # 'google_account', 'api_key', 'auto'
    context_has_video: Optional[bool] = False
    last_video_name: Optional[str] = None


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


@app.get("/api/status")
def status():
    """Return backend status and active auth mode."""
    auth = get_auth_status()
    return {
        "status": "ready",
        "version": "0.1.0",
        "auth": auth,
    }


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

        if not spec_obj:
            # Fallback default workflow spec matching prompt
            spec_obj = {
                "id": f"wf_{int(time.time())}",
                "name": "Custom Vision Pipeline",
                "description": prompt,
                "detector": {"model": "yolov8n.pt", "classes": ["car", "person"], "confidence": 0.35},
                "tracker": {"tracker_type": "bytetrack", "track_buffer": 30},
                "lines": [{"name": "detection_line", "start": {"x": 0.1, "y": 0.5}, "end": {"x": 0.9, "y": 0.5}, "trigger_in": True, "trigger_out": True}]
            }

        diagram_svg = generate_pipeline_svg(spec_obj)
        # Extract conversational text without the raw json block
        conversational_text = raw_res
        if "```json" in conversational_text:
            conversational_text = conversational_text.split("```json")[0].strip()
        elif "```" in conversational_text:
            conversational_text = conversational_text.split("```")[0].strip()

        if not conversational_text:
            conversational_text = "Got it! I've planned the detection and tracking pipeline for your task. Send the video in your next message (or click the attach button below) and I'll label and track the objects for you."

        return {"plan_text": conversational_text, "spec": spec_obj, "diagram_svg": diagram_svg}
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

    # Visual Scene Grounding with VLM (MiMo)
    # Inspects real footage frames to dynamically position line crossings or polygon zones
    scene_analysis_text = None
    geometry_type = None
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
    stats = runtime.process_video(
        source, output_video_path=output_video_path, max_frames=max_frames or 150
    )
    stats["video_url"] = f"/output/{output_video_rel}"
    stats["scene_analysis"] = scene_analysis_text
    stats["geometry_type"] = geometry_type

    return stats
