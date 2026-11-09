"""Session and Chat History Storage Manager for VisionHarness.

Stores session metadata and message logs on disk under the `./sessions/` directory.
"""

import os
import json
import time
import random
from typing import List, Dict, Any, Optional
import cv2
from pydantic import BaseModel, Field

DATA_DIR = os.getenv("VISIONHARNESS_DATA_DIR", ".")
SESSIONS_DIR = os.getenv(
    "VISIONHARNESS_SESSIONS_DIR",
    os.path.join(DATA_DIR, "sessions"),
)
THUMBNAILS_DIR = os.path.join(DATA_DIR, "output", "thumbnails")
os.makedirs(SESSIONS_DIR, exist_ok=True)
os.makedirs(THUMBNAILS_DIR, exist_ok=True)


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
    thumbnail_url: Optional[str] = None
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class SessionStore:
    """Manages reading and writing chat sessions to disk."""

    @staticmethod
    def _get_session_dir(session_id: str) -> str:
        s_dir = os.path.join(SESSIONS_DIR, session_id)
        os.makedirs(s_dir, exist_ok=True)
        return s_dir

    @staticmethod
    def _resolve_video_file(val: Any) -> Optional[str]:
        """Resolves a URL or relative path into an existing absolute or relative video filepath."""
        if not val or not isinstance(val, str) or val.startswith("blob:"):
            return None
        cleaned = val.replace("http://localhost:8000/", "").replace("http://127.0.0.1:8000/", "")
        if cleaned.startswith("/"):
            cleaned = cleaned[1:]
        cleaned = cleaned.replace("/", os.sep).replace("\\", os.sep)
        for prefix in ["", DATA_DIR, ".", "visionharness"]:
            candidate = os.path.normpath(os.path.join(prefix, cleaned))
            if os.path.exists(candidate) and os.path.isfile(candidate):
                return candidate
        return None

    @classmethod
    def _sample_random_thumbnail(cls, video_path: str, session_id: str) -> Optional[str]:
        """Extracts a random frame from video (15%-85% duration) and saves as an optimized JPEG thumbnail."""
        try:
            resolved = cls._resolve_video_file(video_path)
            if not resolved:
                return None

            cap = cv2.VideoCapture(resolved)
            if not cap.isOpened():
                return None

            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
            if total <= 1:
                ret, frame = cap.read()
            else:
                # Sample randomly from 15% to 85% to capture actual scene action rather than 0th frame intro
                low = max(0, int(total * 0.15))
                high = max(low + 1, int(total * 0.85))
                target_frame = random.randint(low, high)
                cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
                ret, frame = cap.read()
                if not ret or frame is None:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    ret, frame = cap.read()
            cap.release()

            if ret and frame is not None:
                h, w = frame.shape[:2]
                scale = 160.0 / max(h, w)
                thumb_img = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                thumb_filename = f"thumb_{session_id}.jpg"
                thumb_path = os.path.join(THUMBNAILS_DIR, thumb_filename)
                cv2.imwrite(thumb_path, thumb_img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                return f"http://localhost:8000/output/thumbnails/{thumb_filename}"
        except Exception as e:
            print(f"[SessionStore] Failed to generate random thumbnail for {session_id}: {e}")
        return None

    @classmethod
    def list_sessions(cls) -> List[Dict[str, Any]]:
        """Lists all saved sessions with metadata and auto-discovered media thumbnail."""
        sessions = []
        for s_id in os.listdir(SESSIONS_DIR):
            meta_path = os.path.join(SESSIONS_DIR, s_id, "session.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        s_data = json.load(f)
                    
                    # If thumbnail not stored or is raw video URL, sample a random frame
                    existing_thumb = s_data.get("thumbnail_url")
                    needs_thumbnail = not existing_thumb or existing_thumb.endswith(".mp4")

                    if needs_thumbnail:
                        # 1. Check if thumbnail image already exists on disk
                        saved_thumb_name = f"thumb_{s_id}.jpg"
                        saved_thumb_path = os.path.join(THUMBNAILS_DIR, saved_thumb_name)
                        if os.path.exists(saved_thumb_path):
                            s_data["thumbnail_url"] = f"http://localhost:8000/output/thumbnails/{saved_thumb_name}"
                        else:
                            # 2. Find any media in workspace or session messages
                            video_source = None
                            
                            # Check workspace.json first
                            ws_file = os.path.join(SESSIONS_DIR, s_id, "workspace.json")
                            if os.path.exists(ws_file):
                                try:
                                    with open(ws_file, "r", encoding="utf-8") as wf:
                                        ws_data = json.load(wf).get("workspace", {})
                                        video_source = ws_data.get("video_path") or ws_data.get("video_url")
                                except Exception:
                                    pass

                            # Then check messages.jsonl
                            if not video_source:
                                msg_file = os.path.join(SESSIONS_DIR, s_id, "messages.jsonl")
                                if os.path.exists(msg_file):
                                    with open(msg_file, "r", encoding="utf-8") as mf:
                                        for line in mf:
                                            if line.strip():
                                                try:
                                                    m = json.loads(line)
                                                    src = (
                                                        m.get("uploadedVideoPath")
                                                        or (m.get("stats") and m["stats"].get("output_video"))
                                                        or m.get("videoUrl")
                                                        or m.get("uploadedVideoUrl")
                                                        or (m.get("stats") and m["stats"].get("video_url"))
                                                    )
                                                    if src and not str(src).startswith("blob:"):
                                                        video_source = src
                                                        break
                                                except Exception:
                                                    pass

                            if video_source:
                                sampled_url = cls._sample_random_thumbnail(str(video_source), s_id)
                                if sampled_url:
                                    s_data["thumbnail_url"] = sampled_url
                                    # Persist in session.json
                                    try:
                                        with open(meta_path, "w", encoding="utf-8") as mf:
                                            json.dump(s_data, mf, indent=2)
                                    except Exception:
                                        pass

                    sessions.append(s_data)
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
    def save_workspace(cls, session_id: str, workspace: Dict[str, Any]) -> None:
        """Persist the active workspace state (spec, geometry, stats, video paths) for the session."""
        s_dir = cls._get_session_dir(session_id)
        ws_path = os.path.join(s_dir, "workspace.json")
        try:
            with open(ws_path, "w", encoding="utf-8") as f:
                json.dump({"workspace": workspace, "saved_at": time.time()}, f, indent=2)
        except Exception as e:
            print(f"[SessionStore] Failed to save workspace: {e}")

    @classmethod
    def get_workspace(cls, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve the persisted workspace state for the session, if it exists."""
        s_dir = cls._get_session_dir(session_id)
        ws_path = os.path.join(s_dir, "workspace.json")
        if os.path.exists(ws_path):
            try:
                with open(ws_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("workspace")
            except Exception as e:
                print(f"[SessionStore] Failed to read workspace: {e}")
        return None

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
        """Retrieves previously saved scene grounding data for the session if it exists.
        Falls back to extracting prior vlm_ground_scene output from existing messages if grounding.json
        was not yet created for an older chat session.
        """
        s_dir = cls._get_session_dir(session_id)
        grounding_path = os.path.join(s_dir, "grounding.json")
        if os.path.exists(grounding_path):
            try:
                with open(grounding_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("grounding")
            except Exception as e:
                print(f"[SessionStore] Failed to read scene grounding: {e}")

        # Retroactive recovery: scan past messages in this session for prior vlm_ground_scene toolCall
        messages = cls.get_messages(session_id)
        for msg in reversed(messages):
            tool_calls = msg.get("toolCalls") or []
            for tc in tool_calls:
                if tc.get("name") == "vlm_ground_scene" and tc.get("output") and isinstance(tc["output"], dict):
                    output = tc["output"]
                    if not output.get("error"):
                        # Retroactively save it so subsequent calls are fast
                        cls.save_scene_grounding(session_id, output)
                        return output

        return None
