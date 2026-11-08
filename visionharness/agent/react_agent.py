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
3. Be friendly, concise, and structured. For greetings or casual chat, reply in 1-2 short sentences — no tables, no capability lists, no essays.
4. When planning or configuring a pipeline, format your final spec in a ```json code block so the UI can render the interactive action card.
5. Only call tools when the task actually needs them. Never call tools for greetings or small talk.
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


def _summarize_tool_calls(tool_calls: Optional[List[Dict[str, Any]]]) -> str:
    """Compact one-line-per-tool history replay (keeps context small)."""
    if not tool_calls:
        return ""
    parts = []
    for tc in tool_calls:
        name = tc.get("name", "tool")
        status = tc.get("status", "ok")
        args = tc.get("args") or {}
        output = tc.get("output") or {}

        # Keep only high-signal args
        arg_bits = []
        for k in ("goal", "query", "category", "video_path"):
            if args.get(k):
                v = str(args[k])
                if len(v) > 80:
                    v = v[:77] + "..."
                arg_bits.append(f"{k}={v}")
        arg_s = (", ".join(arg_bits)) if arg_bits else ""

        # Keep only high-signal outputs (never dump full VLM markdown)
        out_bits = []
        if isinstance(output, dict):
            if "error" in output:
                out_bits.append(f"error={str(output['error'])[:100]}")
            if output.get("status") == "no_prior_inference":
                out_bits.append("no_prior_inference")
            for k in (
                "unique_tracks", "max_zone_occupancy", "in_count", "out_count",
                "processed_frames", "processed_fps", "video_url",
                "geometry_type",
            ):
                if k in output and output[k] is not None:
                    out_bits.append(f"{k}={output[k]}")
            if output.get("zones"):
                out_bits.append(f"zones={len(output['zones'])}")
            if output.get("lines"):
                out_bits.append(f"lines={len(output['lines'])}")
            if output.get("components") is not None:
                out_bits.append(f"components={len(output.get('components') or [])}")
            if output.get("formatted_text"):
                out_bits.append("scene_grounded=yes")
        out_s = (", ".join(out_bits)) if out_bits else ""

        piece = f"{name}({arg_s}) → {status}"
        if out_s:
            piece += f" | {out_s}"
        parts.append(piece)
    return "[tools]\n" + "\n".join(f"- {p}" for p in parts)


def stream_react_agent(
    session_id: str,
    user_prompt: str,
    workspace: Dict[str, Any],
    max_iterations: int = 6
):
    """Run server-side ReAct agent loop with mimo-v2.6-flash, streaming SSE events.

    Sync generator on purpose: blocking HTTP runs off the event loop via
    StreamingResponse's threadpool, so each yield flushes immediately.
    """
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

    # Recover video information from session history if client workspace didn't pass it
    if not workspace.get("video_path"):
        for pm in reversed(past_messages):
            vpath = pm.get("uploadedVideoPath")
            vname = pm.get("uploadedVideoName")
            vurl = pm.get("uploadedVideoUrl")
            if vpath and os.path.exists(vpath):
                workspace["video_path"] = vpath
                workspace["video_name"] = vname or os.path.basename(vpath)
                workspace["video_url"] = vurl
                break
            elif vurl and not vpath:
                # Recover from url filename
                fname = vurl.split("/")[-1]
                local_p = os.path.join("./uploads", fname)
                if os.path.exists(local_p):
                    workspace["video_path"] = local_p
                    workspace["video_name"] = vname or fname
                    workspace["video_url"] = vurl
                    break

    # Recover last inference stats from history if the client workspace lost them
    if not workspace.get("last_stats"):
        for pm in reversed(past_messages):
            if pm.get("stats"):
                workspace["last_stats"] = pm["stats"]
                break

    # Re-evaluate active video note after history recovery
    active_video = workspace.get("video_path") or workspace.get("video_name")
    video_context_note = ""
    if active_video and os.path.exists(workspace.get("video_path", "")):
        video_context_note = f"\nIMPORTANT: Video footage is available at '{workspace.get('video_path')}' (filename: '{workspace.get('video_name')}'). Call `vlm_ground_scene` with video_path='{workspace.get('video_path')}' to inspect the scene, detect entities and propose zones/lines."

    stats_note = ""
    if workspace.get("last_stats"):
        stats_note = (
            "\nPRIOR INFERENCE RESULTS: A pipeline has already run. "
            f"Use these exact numbers for follow-up questions: "
            f"{json.dumps(workspace['last_stats'])}"
        )

    sys_prompt = SYSTEM_PROMPT + f"\n\nACTIVE WORKSPACE STATE:\n{json.dumps(workspace, indent=2)}{stats_note}{video_context_note}"

    messages_payload: List[Dict[str, Any]] = []

    for pm in past_messages:
        role = "user" if pm.get("sender") == "user" else "assistant"
        txt = pm.get("text", "")

        # Replay prior tool calls so the model remembers what it already did
        tool_summary = _summarize_tool_calls(pm.get("toolCalls")) if role == "assistant" else ""
        if role == "assistant" and pm.get("stats") and not tool_summary:
            # Fallback stats line when toolCalls were not persisted
            s = pm["stats"]
            tool_summary = (
                "[Prior run results] "
                f"unique_tracks={s.get('unique_tracks')}, "
                f"max_zone_occupancy={s.get('max_zone_occupancy')}, "
                f"in_count={s.get('in_count')}, out_count={s.get('out_count')}, "
                f"processed_frames={s.get('processed_frames')}, "
                f"processed_fps={s.get('processed_fps')}"
            )

        if tool_summary:
            txt = (txt + "\n" + tool_summary).strip() if txt else tool_summary
        elif role == "assistant" and pm.get("stats") and txt:
            s = pm["stats"]
            txt += (
                "\n\n[Prior run results] "
                f"unique_tracks={s.get('unique_tracks')}, "
                f"max_zone_occupancy={s.get('max_zone_occupancy')}, "
                f"in_count={s.get('in_count')}, out_count={s.get('out_count')}, "
                f"processed_frames={s.get('processed_frames')}, "
                f"processed_fps={s.get('processed_fps')}"
            )

        if txt:
            messages_payload.append({"role": role, "content": txt})

    # Append current user prompt
    messages_payload.append({"role": "user", "content": user_prompt})

    iteration = 0
    while iteration < max_iterations:
        iteration += 1

        payload = {
            "model": model,
            "max_tokens": 1024,
            "stream": True,
            "system": sys_prompt,
            "tools": AGENT_TOOLS,
            "messages": messages_payload
        }

        # Stream the LLM so first token shows immediately (was: wait for full body)
        try:
            import requests as _req
            http = _req.post(
                f"{base_url}/v1/messages",
                headers={
                    "x-api-key": auth_token,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=payload,
                stream=True,
                timeout=(10, 120),
            )
            http.raise_for_status()
        except Exception as e:
            yield {"type": "error", "message": f"LLM API Error: {str(e)}"}
            return

        content: List[Dict[str, Any]] = []
        tool_calls_to_execute: List[Dict[str, Any]] = []
        # index of content block currently being streamed
        open_block_idx: Optional[int] = None

        def _ensure_block(idx: int, btype: str) -> Dict[str, Any]:
            while len(content) <= idx:
                content.append({})
            block = content[idx]
            if not block:
                if btype == "text":
                    content[idx] = {"type": "text", "text": ""}
                elif btype == "thinking":
                    content[idx] = {"type": "thinking", "thinking": ""}
                elif btype == "tool_use":
                    content[idx] = {"type": "tool_use", "id": "", "name": "", "input": {}}
            return content[idx]

        try:
            for raw_line in http.iter_lines():
                if not raw_line:
                    continue
                line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                if not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str == "[DONE]":
                    break
                try:
                    event = json.loads(data_str)
                except Exception:
                    continue

                et = event.get("type")
                if et == "content_block_start":
                    idx = event.get("index", 0)
                    cb = event.get("content_block") or {}
                    btype = cb.get("type")
                    if btype == "text":
                        content.append({"type": "text", "text": cb.get("text", "")})
                        # fix if append misaligned — ensure index
                        while len(content) < idx + 1:
                            content.append({"type": "text", "text": ""})
                        content[idx] = {"type": "text", "text": cb.get("text", "")}
                        open_block_idx = idx
                    elif btype == "thinking":
                        while len(content) < idx + 1:
                            content.append({"type": "thinking", "thinking": ""})
                        content[idx] = {"type": "thinking", "thinking": cb.get("thinking", "")}
                        open_block_idx = idx
                    elif btype == "tool_use":
                        while len(content) < idx + 1:
                            content.append({"type": "tool_use", "id": "", "name": "", "input": {}})
                        content[idx] = {
                            "type": "tool_use",
                            "id": cb.get("id", ""),
                            "name": cb.get("name", ""),
                            "input": cb.get("input") or {},
                        }
                        open_block_idx = idx

                elif et == "content_block_delta":
                    idx = event.get("index", 0)
                    delta = event.get("delta") or {}
                    dtype = delta.get("type")
                    while len(content) <= idx:
                        content.append({"type": "text", "text": ""})
                    block = content[idx]

                    if dtype == "text_delta":
                        piece = delta.get("text", "")
                        if block.get("type") != "text":
                            content[idx] = {"type": "text", "text": block.get("text", "") or ""}
                            block = content[idx]
                        block["text"] = (block.get("text") or "") + piece
                        if piece:
                            yield {"type": "text", "delta": piece}
                    elif dtype == "thinking_delta":
                        piece = delta.get("thinking", "")
                        if block.get("type") != "thinking":
                            content[idx] = {"type": "thinking", "thinking": block.get("thinking", "") or ""}
                            block = content[idx]
                        block["thinking"] = (block.get("thinking") or "") + piece
                        if piece:
                            yield {"type": "thinking", "delta": piece}
                    elif dtype == "input_json_delta":
                        # partial JSON for tool input — accumulate raw string
                        if block.get("type") != "tool_use":
                            content[idx] = {
                                "type": "tool_use",
                                "id": block.get("id") or "",
                                "name": block.get("name") or "",
                                "input": {},
                                "_json": "",
                            }
                            block = content[idx]
                        block["_json"] = (block.get("_json") or "") + (delta.get("partial_json") or "")

                elif et == "content_block_stop":
                    idx = event.get("index", 0)
                    if 0 <= idx < len(content) and content[idx].get("type") == "tool_use":
                        block = content[idx]
                        raw_json = block.pop("_json", "")
                        if raw_json:
                            try:
                                block["input"] = json.loads(raw_json)
                            except Exception:
                                block["input"] = block.get("input") or {}
                        if block.get("id") and block.get("name"):
                            tool_calls_to_execute.append(block)

                elif et == "message_delta":
                    # stop_reason etc — ignore
                    pass
                elif et == "error":
                    err = event.get("error") or {}
                    yield {"type": "error", "message": err.get("message", "stream error")}
                    return
        except Exception as e:
            yield {"type": "error", "message": f"LLM stream error: {str(e)}"}
            return

        # Safety: if tool_use blocks never got content_block_stop handled
        for block in content:
            if block.get("type") == "tool_use" and block.get("name") and block.get("id"):
                if block not in tool_calls_to_execute:
                    if "_json" in block:
                        try:
                            block["input"] = json.loads(block.pop("_json") or "{}")
                        except Exception:
                            block.pop("_json", None)
                    tool_calls_to_execute.append(block)

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
