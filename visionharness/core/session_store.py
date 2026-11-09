"""Session and Chat History Storage Manager for VisionHarness.

Stores session metadata and message logs on disk under the `./sessions/` directory.
"""

import os
import json
import time
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

SESSIONS_DIR = os.getenv(
    "VISIONHARNESS_SESSIONS_DIR",
    os.path.join(os.getenv("VISIONHARNESS_DATA_DIR", "."), "sessions"),
)
os.makedirs(SESSIONS_DIR, exist_ok=True)


class ChatMessage(BaseModel):
    id: str
    sender: str  # "user" | "bot"
    text: str
    thoughts: Optional[str] = None
    spec: Optional[Dict[str, Any]] = None
    stats: Optional[Dict[str, Any]] = None
    video_url: Optional[str] = None
    videoUrl: Optional[str] = None
    uploadedVideoUrl: Optional[str] = None
    uploadedVideoName: Optional[str] = None
    uploadedVideoPath: Optional[str] = None
    uploadDone: Optional[bool] = None
    geometryEditEvent: Optional[Dict[str, Any]] = None
    toolCalls: Optional[List[Dict[str, Any]]] = None
    diagramSvg: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: time.strftime("%I:%M %p"))


class SessionMetadata(BaseModel):
    id: str
    name: str
    domain: str = "general_vision"
    folder: str = "Default workspace"
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class SessionStore:
    """Manages reading and writing chat sessions to disk."""

    @staticmethod
    def _get_session_dir(session_id: str) -> str:
        s_dir = os.path.join(SESSIONS_DIR, session_id)
        os.makedirs(s_dir, exist_ok=True)
        return s_dir

    @classmethod
    def list_sessions(cls) -> List[Dict[str, Any]]:
        """Lists all saved sessions with metadata."""
        sessions = []
        for s_id in os.listdir(SESSIONS_DIR):
            meta_path = os.path.join(SESSIONS_DIR, s_id, "session.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        sessions.append(json.load(f))
                except Exception:
                    pass
        # Sort by updated_at descending
        sessions.sort(key=lambda s: s.get("updated_at", 0), reverse=True)
        return sessions

    @classmethod
    def get_or_create_session(cls, session_id: str, name: str = "New Vision Session", folder: str = "Default workspace") -> Dict[str, Any]:
        """Loads an existing session or initializes a new one."""
        s_dir = cls._get_session_dir(session_id)
        meta_path = os.path.join(s_dir, "session.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)

        meta = SessionMetadata(id=session_id, name=name, folder=folder)
        with open(meta_path, "w", encoding="utf-8") as f:
            f.write(meta.model_dump_json(indent=2))
        return meta.model_dump()

    @classmethod
    def get_messages(cls, session_id: str) -> List[Dict[str, Any]]:
        """Reads all messages for a given session."""
        s_dir = cls._get_session_dir(session_id)
        msg_file = os.path.join(s_dir, "messages.jsonl")
        messages = []
        if os.path.exists(msg_file):
            with open(msg_file, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        try:
                            messages.append(json.loads(line))
                        except Exception:
                            pass
        return messages

    @classmethod
    def append_message(cls, session_id: str, message: ChatMessage) -> Dict[str, Any]:
        """Appends a new message turn or updates an existing message turn by id."""
        s_dir = cls._get_session_dir(session_id)
        msg_file = os.path.join(s_dir, "messages.jsonl")
        meta_path = os.path.join(s_dir, "session.json")

        existing_lines = []
        replaced = False
        if os.path.exists(msg_file):
            with open(msg_file, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        try:
                            d = json.loads(line)
                            if d.get("id") == message.id:
                                existing_lines.append(message.model_dump_json() + "\n")
                                replaced = True
                            else:
                                existing_lines.append(line)
                        except Exception:
                            existing_lines.append(line)

        if not replaced:
            existing_lines.append(message.model_dump_json() + "\n")

        with open(msg_file, "w", encoding="utf-8") as f:
            f.writelines(existing_lines)

        # Update metadata timestamp
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                data["updated_at"] = time.time()
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
            except Exception:
                pass

        return message.model_dump()

    @classmethod
    def save_scene_grounding(cls, session_id: str, grounding_data: Dict[str, Any]) -> None:
        """Saves scene grounding results (scene objects, proposed zones/lines, commentary) for the session."""
        s_dir = cls._get_session_dir(session_id)
        grounding_path = os.path.join(s_dir, "grounding.json")
        try:
            with open(grounding_path, "w", encoding="utf-8") as f:
                json.dump({
                    "grounding": grounding_data,
                    "saved_at": time.time()
                }, f, indent=2)
        except Exception as e:
            print(f"[SessionStore] Failed to save scene grounding: {e}")

    @classmethod
    def get_scene_grounding(cls, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves previously saved scene grounding data for the session if it exists."""
        s_dir = cls._get_session_dir(session_id)
        grounding_path = os.path.join(s_dir, "grounding.json")
        if os.path.exists(grounding_path):
            try:
                with open(grounding_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("grounding")
            except Exception as e:
                print(f"[SessionStore] Failed to read scene grounding: {e}")
        return None
