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
When a user asks for a computer vision task (e.g. "I want to track cars at the intersection", "count people in a store", "how many guns in the video"):
1. Respond naturally and conversationally, acknowledging their request in 1-2 friendly sentences.
   - If a video is already in context or was previously uploaded in the workspace: acknowledge it! e.g. "Got it! I've updated the pipeline to detect and count guns on your active video. Click Run (or re-run) below and I'll analyze it."
   - If no video has been uploaded yet: politely ask them to upload the footage or send it in their next message.
2. Also plan the technical architecture behind the scenes and include a valid JSON code block ```json ... ``` with the WorkflowSpec:
   {
     "id": "wf_<timestamp>",
     "name": "Pipeline Name",
     "description": "Short description",
     "detector": {
       "model": "yolov8n.pt",
       "classes": ["car", "person", "gun", etc],
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

Be friendly, concise, and clear."""


async def plan_workflow_anthropic(prompt: str, context_has_video: bool = False, last_video_name: str | None = None) -> str:
    """Invoke Anthropic / MiMo endpoint."""
    base_url = os.getenv("ANTHROPIC_BASE_URL", "").rstrip("/")
    auth_token = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
    model = os.getenv("ANTHROPIC_MODEL", "mimo-v2.6-flash")

    if not base_url or not auth_token:
        raise ValueError("ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN not configured.")

    system_prompt = SYSTEM_INSTRUCTIONS
    if context_has_video:
        system_prompt += f"\n\nCURRENT CONTEXT: The user already uploaded and is actively working with a video in this workspace ('{last_video_name or 'active_video.mp4'}'). Do NOT tell them to upload a video again unless they want to replace it. Acknowledge the existing video and state that you're ready to run on it!"

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
) -> str:
    """Run prompt against Anthropic / MiMo endpoint, falling back to Antigravity SDK if needed."""
    if os.getenv("ANTHROPIC_BASE_URL") and os.getenv("ANTHROPIC_AUTH_TOKEN"):
        try:
            return await plan_workflow_anthropic(
                prompt, context_has_video=context_has_video, last_video_name=last_video_name
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
