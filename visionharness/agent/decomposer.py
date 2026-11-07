"""Task Decomposition and Planning benchmark."""

import asyncio
import json
from visionharness.agent.auth import GoogleAccountBridge, get_auth_status
from visionharness.agent.planner import plan_workflow

DECOMPOSITION_SYSTEM_PROMPT = """You are VisionHarness Architect, an expert computer vision systems designer.
When a user describes a vision task, do NOT jump immediately to generic code.
Instead, deeply analyze and decompose the problem into a structured JSON plan with the following schema:

{
  "objective": "Concise summary of the user's primary goal",
  "cv_domain": "e.g. retail_analytics, traffic_monitoring, perimeter_security, industrial_inspection",
  "challenges": [
    "List realistic real-world CV challenges (e.g. occlusion, lighting changes, identity switching, camera angle, crowd density)"
  ],
  "pipeline_steps": [
    {
      "step": 1,
      "name": "Frame Ingestion & Preprocessing",
      "action": "What happens to the raw video frame"
    },
    {
      "step": 2,
      "name": "Object Detection",
      "action": "Which class is detected, at what confidence"
    },
    {
      "step": 3,
      "name": "Object Tracking",
      "action": "How temporal tracking associations are maintained across frames"
    },
    {
      "step": 4,
      "name": "Spatial / Event Logic",
      "action": "Lines crossed, polygon zones triggered, or dwell timers"
    },
    {
      "step": 5,
      "name": "Metrics & Output",
      "action": "Data tallied, alerts fired, or annotated visual stream generated"
    }
  ],
  "recommended_models": [
    {
      "component": "Model / Tracker name (e.g. YOLO11n, ByteTrack, Supervision LineZone)",
      "role": "detection / tracking / logic",
      "rationale": "Why this specific component fits the constraints (latency vs accuracy)"
    }
  ],
  "event_triggers": [
    {
      "trigger_type": "line_crossing | polygon_zone | time_dwell",
      "parameters": "Trigger parameters and counting logic"
    }
  ],
  "missing_information": [
    "Important questions or camera setup details to clarify with the user (e.g. camera mount angle, line orientation)"
  ]
}

Return ONLY valid JSON matching this schema.
"""


async def decompose_prompt(user_prompt: str) -> dict:
    """Analyze a user's prompt and decompose it into structured CV tasks."""
    auth = get_auth_status()

    # 1. Preferred: Google Account Bridge (your Google Pro CLI connection)
    if auth["google_account"]["available"]:
        bridge = GoogleAccountBridge()
        raw_res = await bridge.chat(user_prompt, system_prompt=DECOMPOSITION_SYSTEM_PROMPT)
    else:
        # 2. Fallback: API Key via Antigravity SDK
        raw_res = await plan_workflow(f"{DECOMPOSITION_SYSTEM_PROMPT}\n\nTask: {user_prompt}")

    # Clean markdown
    clean = raw_res.strip()
    if "```json" in clean:
        clean = clean.split("```json")[1].split("```")[0].strip()
    elif "```" in clean:
        clean = clean.split("```")[1].split("```")[0].strip()

    try:
        return json.loads(clean)
    except Exception:
        return {"raw_output": raw_res}
