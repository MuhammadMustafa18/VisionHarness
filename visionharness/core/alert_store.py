"""Persistent JSON store for real-time CCTV object detection alerts."""

import json
import os
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

DATA_DIR = os.getenv("VISIONHARNESS_DATA_DIR", ".")
OUTPUTS_DIR = os.getenv("VISIONHARNESS_OUTPUTS_DIR", os.path.join(DATA_DIR, "output"))
ALERTS_DIR = os.path.join(OUTPUTS_DIR, "alerts")
ALERTS_FILE = os.path.join(ALERTS_DIR, "alerts.json")

_lock = threading.Lock()
_MAX_ALERTS = 500


def _ensure_dirs() -> None:
    os.makedirs(ALERTS_DIR, exist_ok=True)


def _read_all() -> List[Dict[str, Any]]:
    _ensure_dirs()
    if not os.path.exists(ALERTS_FILE):
        return []
    try:
        with open(ALERTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_all(alerts: List[Dict[str, Any]]) -> None:
    _ensure_dirs()
    with open(ALERTS_FILE, "w", encoding="utf-8") as f:
        json.dump(alerts[-_MAX_ALERTS:], f, indent=2)


def add_alert(
    session_id: str,
    camera_label: str,
    detected_classes: List[str],
    count: int,
    rule_label: str = "",
    screenshot_url: Optional[str] = None,
    screenshot_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Record a new detection alert event and persist to disk."""
    event = {
        "id": f"alert_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "epoch": time.time(),
        "session_id": session_id,
        "camera_label": camera_label,
        "rule_label": rule_label or f"Detected {', '.join(detected_classes)}",
        "detected_classes": detected_classes,
        "count": count,
        "screenshot_url": screenshot_url,
        "screenshot_path": screenshot_path,
    }
    with _lock:
        alerts = _read_all()
        alerts.append(event)
        _write_all(alerts)
    return event


def list_alerts(
    session_id: Optional[str] = None,
    object_class: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Return newest-first alerts, optionally filtered by session_id or object class."""
    with _lock:
        alerts = _read_all()
    out = []
    for a in reversed(alerts):
        if session_id and a.get("session_id") != session_id:
            continue
        if object_class:
            classes = [c.lower() for c in (a.get("detected_classes") or [])]
            if object_class.lower() not in classes:
                continue
        out.append(a)
        if len(out) >= limit:
            break
    return out


def clear_alerts(session_id: Optional[str] = None) -> int:
    """Clear all alerts (or only those for a specific session_id). Returns removed count."""
    with _lock:
        alerts = _read_all()
        if session_id:
            kept = [a for a in alerts if a.get("session_id") != session_id]
            removed = len(alerts) - len(kept)
            _write_all(kept)
            return removed
        removed = len(alerts)
        _write_all([])
        return removed
