"""Persistent live camera & alert rule state for auto-resume across restarts."""

import json
import os
import threading
from typing import Any, Dict, Optional

DATA_DIR = os.getenv("VISIONHARNESS_DATA_DIR", ".")
SESSIONS_DIR = os.path.join(DATA_DIR, "sessions")
LIVE_STATE_FILE = os.path.join(SESSIONS_DIR, "live_state.json")

_lock = threading.Lock()


def _read_all() -> Dict[str, Any]:
    os.makedirs(SESSIONS_DIR, exist_ok=True)
    if not os.path.exists(LIVE_STATE_FILE):
        return {}
    try:
        with open(LIVE_STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_all(state: Dict[str, Any]) -> None:
    os.makedirs(SESSIONS_DIR, exist_ok=True)
    with open(LIVE_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def save_live_stream_state(session_id: str, stream_url: str, alert_rule: Optional[Dict[str, Any]] = None) -> None:
    """Persist an active non-push live stream and its optional alert rule."""
    if not stream_url or stream_url == "push":
        return
    with _lock:
        state = _read_all()
        entry = state.get(session_id, {})
        entry["stream_url"] = stream_url
        if alert_rule is not None:
            entry["alert_rule"] = alert_rule
        state[session_id] = entry
        _write_all(state)


def update_live_alert_rule(session_id: str, alert_rule: Optional[Dict[str, Any]]) -> None:
    with _lock:
        state = _read_all()
        if session_id in state:
            if alert_rule is None:
                state[session_id].pop("alert_rule", None)
            else:
                state[session_id]["alert_rule"] = alert_rule
            _write_all(state)


def remove_live_stream_state(session_id: str) -> None:
    with _lock:
        state = _read_all()
        if session_id in state:
            del state[session_id]
            _write_all(state)


def load_all_live_states() -> Dict[str, Any]:
    with _lock:
        return _read_all()
