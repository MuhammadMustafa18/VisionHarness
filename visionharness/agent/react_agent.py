"""Autonomous ReAct Agent Loop for VisionHarness.

Orchestrates multimodal tools:
- vlm_ground_scene: visual grounding & spatial geometry
- query_inference_results: in-workspace memory & QA
- search_components: verified CV models & trackers
- run_pipeline: execution of confirmed YOLO + ByteTrack workflow
"""

import os
import json
import time
import urllib.request
from typing import Dict, Any, List, Optional, AsyncGenerator
from dotenv import load_dotenv

load_dotenv()

from visionharness.agent.grounding import ground_scene_with_vlm
from visionharness.registry.components import search_components
from visionharness.core.session_store import SessionStore
from visionharness.core.spec import WorkflowSpec, Point2D, ZoneConfig, LineCrossingConfig
from visionharness.runtime.engine import VisionRuntime, VideoSource

AGENT_TOOLS = [
    {
        "name": "vlm_ground_scene",
        "description": "Inspect sample frames from the video footage using VLM to ground scene perspective, observe objects, and extract spatial boundaries (polygon zones or crossing lines). Call this when a video is loaded and you need to understand the scene or set up spatial rules.",
        "input_schema": {
            "type": "object",
            "properties": {
                "video_path": {"type": "string", "description": "Absolute or relative path to the video file"},
                "goal": {"type": "string", "description": "User tracking objective, e.g. count people, track vehicles, monitor zone"}
            },
            "required": ["video_path"]
        }
    },
    {
        "name": "query_inference_results",
        "description": "Query previous inference metrics, counts, and stats from this workspace (e.g. peak occupancy, in/out counts, unique tracks). Call this whenever the user asks analytical questions about the video or prior execution.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What metric to check: 'total_people', 'peak_occupancy', 'fps', etc."}
            }
        }
    },
    {
        "name": "search_components",
        "description": "Search verified computer vision modules (YOLO detectors, ByteTrack trackers, supervision annotators).",
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "description": "detector, tracker, filter, sink"},
                "query": {"type": "string", "description": "Search keyword e.g. yolo, bytetrack, ppe"}
            }
        }
    },
    {
        "name": "run_pipeline",
        "description": "Execute YOLO detection + ByteTrack tracking on the full video footage using the confirmed workflow specification. Only call this when the user explicitly confirms or asks to run the pipeline.",
        "input_schema": {
            "type": "object",
            "properties": {
                "video_path": {"type": "string", "description": "Path to the video file"},
                "spec": {"type": "object", "description": "WorkflowSpec configuration object"}
            },
            "required": ["video_path"]
        }
    }
]

SYSTEM_PROMPT = """You are VisionHarness, an autonomous AI Computer Vision Architect and Agent.
You design, ground, and run real-world computer vision workflows across video streams and edge devices.

You operate inside an autonomous ReAct loop with access to tools:
- `vlm_ground_scene`: Call this to visually inspect video footage, identify scene elements, and generate polygon zones or crossing lines.
- `query_inference_results`: Call this if the user asks questions about prior pipeline execution (counts, stats, occupants).
- `search_components`: Search available CV modules.
- `run_pipeline`: Execute the confirmed detection & tracking pipeline on the full video.

GUIDELINES:
1. When the user provides or references video footage, call `vlm_ground_scene` to inspect the scene, understand the camera perspective, and propose tracking zones.
2. If the user asks a question about previous counts or results (e.g. "how many total people?"), query the existing workspace stats or answer directly using the workspace context.
3. Be friendly, concise, and structured. Always provide your final response in clean markdown with the proposed or active workflow specification when configuring a pipeline.
4. When planning or configuring a pipeline, format your final spec in a ```json code block so the UI can render the interactive action card.
"""


def execute_tool(tool_name: str, tool_input: Dict[str, Any], workspace: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a tool synchronously or asynchronously and return the observation."""
    if tool_name == "vlm_ground_scene":
        video_path = tool_input.get("video_path") or workspace.get("video_path")
        goal = tool_input.get("goal") or "Track moving entities"
        if not video_path or not os.path.exists(video_path):
            return {"error": f"Video path '{video_path}' not found on server."}
        try:
            grounding = ground_scene_with_vlm(video_path, goal)
            return grounding
        except Exception as e:
            return {"error": str(e)}

    elif tool_name == "query_inference_results":
        stats = workspace.get("last_stats")
        if not stats:
            return {"status": "no_prior_inference", "message": "No pipeline has run yet on this footage."}
        return {
            "status": "success",
            "stats": stats,
            "unique_tracks": stats.get("unique_tracks"),
            "max_zone_occupancy": stats.get("max_zone_occupancy"),
            "in_count": stats.get("in_count"),
            "out_count": stats.get("out_count"),
            "processed_fps": stats.get("processed_fps"),
            "processed_frames": stats.get("processed_frames")
        }

    elif tool_name == "search_components":
        cat = tool_input.get("category", "")
        q = tool_input.get("query", "")
        results = search_components(query=q, category=cat)
        return {"components": results[:5]}

    elif tool_name == "run_pipeline":
        video_path = tool_input.get("video_path") or workspace.get("video_path")
        spec_dict = tool_input.get("spec") or workspace.get("spec") or {
            "id": f"wf_{int(time.time())}",
            "name": "Custom Vision Pipeline",
            "detector": {"model": "yolov8n.pt", "classes": ["person", "car"]},
            "tracker": {"tracker_type": "bytetrack"}
        }
        if not video_path or not os.path.exists(video_path):
            return {"error": f"Video path '{video_path}' not found."}

        try:
            spec = WorkflowSpec.model_validate(spec_dict)
            output_video_rel = f"output_{spec.id}_{int(time.time())}.mp4"
            output_video_path = os.path.join("./output", output_video_rel)
            source = VideoSource(video_path)
            runtime = VisionRuntime(spec)
            stats = runtime.process_video(source, output_video_path=output_video_path)
            stats["video_url"] = f"/output/{output_video_rel}"
            # Update workspace
            workspace["last_stats"] = stats
            return stats
        except Exception as e:
            return {"error": str(e)}

    return {"error": f"Unknown tool: {tool_name}"}


async def stream_react_agent(
    session_id: str,
    user_prompt: str,
    workspace: Dict[str, Any],
    max_iterations: int = 6
) -> AsyncGenerator[Dict[str, Any], None]:
    """Run server-side ReAct agent loop with mimo-v2.6-flash, streaming SSE events."""
    base_url = os.getenv("ANTHROPIC_BASE_URL", "").rstrip("/")
    auth_token = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
    model = os.getenv("ANTHROPIC_MODEL", "mimo-v2.6-flash")

    if not base_url or not auth_token:
        yield {"type": "error", "message": "ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN not configured."}
        return

    # Prepare system context with workspace state
    active_video = workspace.get("video_path") or workspace.get("video_name")
    video_context_note = ""
    if active_video:
        video_context_note = f"\nIMPORTANT: The user has attached/uploaded video footage: '{workspace.get('video_path')}' (filename: '{workspace.get('video_name')}'). You SHOULD immediately call `vlm_ground_scene` with video_path='{workspace.get('video_path')}' to inspect the scene, understand objects and camera angle, and extract zones/lines for the user!"

    stats_note = ""
    if workspace.get("last_stats"):
        stats_note = (
            "\nPRIOR INFERENCE RESULTS: A pipeline has already run. "
            f"Use these exact numbers for follow-up questions: "
            f"{json.dumps(workspace['last_stats'])}"
        )

    sys_prompt = SYSTEM_PROMPT + f"\n\nACTIVE WORKSPACE STATE:\n{json.dumps(workspace, indent=2)}{stats_note}{video_context_note}"

    # Load recent conversation history from session store
    past_messages = SessionStore.get_messages(session_id)[-8:]

    # Recover last inference stats from history if the client workspace lost them
    if not workspace.get("last_stats"):
        for pm in reversed(past_messages):
            if pm.get("stats"):
                workspace["last_stats"] = pm["stats"]
                break

    messages_payload: List[Dict[str, Any]] = []

    for pm in past_messages:
        role = "user" if pm.get("sender") == "user" else "assistant"
        txt = pm.get("text", "")
        if txt:
            # Surface prior run numbers in-band so the model can't miss them
            if role == "assistant" and pm.get("stats"):
                s = pm["stats"]
                txt += (
                    "\n\n[Prior run results] "
                    f"unique_tracks={s.get('unique_tracks')}, "
                    f"max_zone_occupancy={s.get('max_zone_occupancy')}, "
                    f"in_count={s.get('in_count')}, out_count={s.get('out_count')}, "
                    f"processed_frames={s.get('processed_frames')}, "
                    f"processed_fps={s.get('processed_fps')}"
                )
            messages_payload.append({"role": role, "content": txt})

    # Append current user prompt
    messages_payload.append({"role": "user", "content": user_prompt})

    iteration = 0
    while iteration < max_iterations:
        iteration += 1

        payload = {
            "model": model,
            "max_tokens": 3000,
            "system": sys_prompt,
            "tools": AGENT_TOOLS,
            "messages": messages_payload
        }

        req = urllib.request.Request(
            f"{base_url}/v1/messages",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "x-api-key": auth_token,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
        )

        try:
            loop_res = urllib.request.urlopen(req)
            data = json.loads(loop_res.read().decode("utf-8"))
        except Exception as e:
            yield {"type": "error", "message": f"LLM API Error: {str(e)}"}
            return

        content = data.get("content", [])
        tool_calls_to_execute = []
        assistant_text_chunks = []

        for item in content:
            item_type = item.get("type")
            if item_type == "thinking":
                th = item.get("thinking", "")
                if th:
                    yield {"type": "thinking", "delta": th}
            elif item_type == "text":
                txt = item.get("text", "")
                if txt:
                    assistant_text_chunks.append(txt)
                    yield {"type": "text", "delta": txt}
            elif item_type == "tool_use":
                tool_calls_to_execute.append(item)

        # If no tool calls, model provided final answer!
        if not tool_calls_to_execute:
            break

        # Append assistant turn to conversation payload
        messages_payload.append({"role": "assistant", "content": content})

        # Execute each tool and return tool_result
        tool_result_contents = []
        for tc in tool_calls_to_execute:
            t_id = tc.get("id")
            t_name = tc.get("name")
            t_input = tc.get("input", {})

            # Yield tool calling event to client
            yield {
                "type": "tool_call",
                "id": t_id,
                "name": t_name,
                "input": t_input,
                "status": "calling"
            }

            # Run tool
            output = execute_tool(t_name, t_input, workspace)

            # Yield tool completed event to client
            yield {
                "type": "tool_result",
                "id": t_id,
                "name": t_name,
                "output": output,
                "status": "completed"
            }

            tool_result_contents.append({
                "type": "tool_result",
                "tool_use_id": t_id,
                "content": json.dumps(output)
            })

        # Append tool results as user turn to loop back to model
        messages_payload.append({
            "role": "user",
            "content": tool_result_contents
        })

    yield {"type": "done", "workspace": workspace}
