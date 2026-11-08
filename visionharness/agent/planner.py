"""Vision Planner Agent powered by Anthropic / MiMo LLM or Google Antigravity SDK."""

import os
import json
import urllib.request
from typing import Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

from visionharness.registry.components import search_components, get_component
from visionharness.core.spec import WorkflowSpec


SYSTEM_INSTRUCTIONS = """You are VisionHarness, a conversational AI Computer Vision Architect.
When a user asks for a computer vision task or asks questions about their video or analysis:
1. Respond naturally and conversationally in 1-3 friendly sentences.
   - If an inference result was already run and produced stats (e.g. peak occupancy, in/out count, unique tracks), ANSWER THEIR QUESTION DIRECTLY using those stats! (For example: "Based on our tracking analysis, there were 10 people in the peak zone occupancy and 21 unique people tracked across the video."). Do NOT tell them to re-run unless they asked to modify the pipeline.
   - If a video is already loaded but hasn't run yet: acknowledge it! e.g. "Got it! I've configured the pipeline to track and count on '{{video_name}}'. Click Confirm & Run Pipeline below to execute."
   - If no video has been uploaded yet: politely invite them to upload the footage.
2. If this is a new pipeline architecture or configuration change, include a valid JSON code block ```json ... ``` with the WorkflowSpec:
   {
     "id": "wf_<timestamp>",
     "name": "Pipeline Name",
     "description": "Short description",
     "detector": {
       "model": "yolov8n.pt",
       "classes": ["car", "person"],
       "confidence": 0.35
     },
     "tracker": {
       "tracker_type": "bytetrack",
       "track_buffer": 30
     },
     "lines": [
       { "name": "detection_line", "start": {"x": 0.1, "y": 0.5}, "end": {"x": 0.9, "y": 0.5}, "trigger_in": true, "trigger_out": true }
     ]
   }
If the user is just asking a question about existing results, answer their question directly and omit the ```json block unless a pipeline redesign is requested.

Be friendly, direct, concise, and helpful."""


async def plan_workflow_anthropic(
    prompt: str,
    context_has_video: bool = False,
    last_video_name: str | None = None,
    last_inference_stats: dict | None = None,
) -> str:
    """Invoke Anthropic / MiMo endpoint."""
    base_url = os.getenv("ANTHROPIC_BASE_URL", "").rstrip("/")
    auth_token = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
    model = os.getenv("ANTHROPIC_MODEL", "mimo-v2.6-flash")

    if not base_url or not auth_token:
        raise ValueError("ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN not configured.")

    system_prompt = SYSTEM_INSTRUCTIONS
    if context_has_video:
        system_prompt += f"\n\nCURRENT VIDEO CONTEXT: Active video loaded in workspace: '{last_video_name or 'active_video.mp4'}'."
    if last_inference_stats:
        system_prompt += f"\n\nPRIOR INFERENCE RESULTS IN THIS WORKSPACE: The pipeline already executed on this video! Here are the actual numbers:\n{json.dumps(last_inference_stats, indent=2)}\nUse these exact figures to answer any direct questions (e.g. 'how many people', 'what was the count')."

    url = f"{base_url}/v1/messages"
    payload = {
        "model": model,
        "max_tokens": 2000,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": prompt}
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

    loop = urllib.request.urlopen(req)
    data = json.loads(loop.read().decode("utf-8"))

    # Extract text from response content
    text_parts = []
    thinking_parts = []
    for item in data.get("content", []):
        if item.get("type") == "text":
            text_parts.append(item.get("text", ""))
        elif item.get("type") == "thinking":
            thinking_parts.append(item.get("thinking", ""))

    full_text = "\n".join(text_parts)
    return full_text


async def plan_workflow(
    prompt: str,
    api_key: str | None = None,
    context_has_video: bool = False,
    last_video_name: str | None = None,
    last_inference_stats: dict | None = None,
) -> str:
    """Run prompt against Anthropic / MiMo endpoint, falling back to Antigravity SDK if needed."""
    if os.getenv("ANTHROPIC_BASE_URL") and os.getenv("ANTHROPIC_AUTH_TOKEN"):
        try:
            return await plan_workflow_anthropic(
                prompt,
                context_has_video=context_has_video,
                last_video_name=last_video_name,
                last_inference_stats=last_inference_stats,
            )
        except Exception as e:
            print(f"[Planner] Anthropic call failed: {e}")

    # Fallback to Google Antigravity SDK
    from google.antigravity import Agent, LocalAgentConfig
    api_key = api_key or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("Neither Anthropic nor GEMINI_API_KEY is configured.")

    config = LocalAgentConfig(
        system_instructions=SYSTEM_INSTRUCTIONS,
        model="gemini-3.5-flash",
        api_key=api_key,
        tools=[search_components, get_component],
    )
    async with Agent(config) as agent:
        response = await agent.chat(prompt)
        content_tokens = []
        async for token in response:
            content_tokens.append(token)
        return "".join(content_tokens)
