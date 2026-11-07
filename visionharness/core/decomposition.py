"""Decomposition and Reasoning Engine for Vision Tasks."""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class TaskDecomposition(BaseModel):
    objective: str = Field(description="Primary high-level goal extracted from the prompt")
    cv_domain: str = Field(description="Domain e.g. retail_analytics, traffic_monitoring, perimeter_security, sports")
    challenges: List[str] = Field(description="Potential vision pitfalls e.g. occlusion, double-counting, camera shake, scale variance")
    pipeline_steps: List[Dict[str, Any]] = Field(description="Ordered breakdown of required CV pipeline steps")
    recommended_models: List[Dict[str, str]] = Field(description="Selected models/trackers with rationale")
    event_triggers: List[Dict[str, Any]] = Field(description="Line crossings, polygon dwell zones, threshold triggers")
    missing_information: List[str] = Field(description="Questions or calibration details needed from the user (e.g. camera angle, entrance line position)")
