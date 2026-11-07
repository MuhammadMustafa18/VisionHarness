"""Vision Planner Agent powered by Google Antigravity SDK."""

import os
import json
from typing import Dict, Any
from dotenv import load_dotenv

load_dotenv()

from google.antigravity import Agent, LocalAgentConfig
from visionharness.registry.components import search_components, get_component
from visionharness.core.spec import WorkflowSpec


SYSTEM_INSTRUCTIONS = """You are VisionHarness, an AI Computer Vision Architect.
Your role is to understand user natural language vision requests (e.g., counting people entering a store, tracking cars in a parking lot, or restricted area alerts) and produce a structured, validated CV Workflow Specification.

Guidelines:
1. Decompose the user request into required CV stages:
   - Object Detection (model choice, target classes, confidence threshold)
   - Tracking (tracker algorithm, persistence buffers)
   - Event Logic (Line crossing for in/out counting, Polygon zones for restricted areas)
2. Use the provided tools `search_components` and `get_component` to inspect compatible components.
3. Output a valid, pure JSON object matching the WorkflowSpec schema.
   Do not hallucinate fake models; stick to verified components in the registry (e.g. yolo11n, yolov8n, bytetrack, botsort, line_crossing, polygon_zone).
"""


def create_agent(api_key: str | None = None) -> Agent:
    api_key = api_key or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set.")

    config = LocalAgentConfig(
        system_instructions=SYSTEM_INSTRUCTIONS,
        model="gemini-3.5-flash",
        api_key=api_key,
        tools=[search_components, get_component],
    )
    return Agent(config)


async def plan_workflow(prompt: str, api_key: str | None = None) -> str:
    """Run prompt against the agent and return the response."""
    async with create_agent(api_key) as agent:
        response = await agent.chat(prompt)
        content_tokens = []
        async for token in response:
            content_tokens.append(token)
        return "".join(content_tokens)
