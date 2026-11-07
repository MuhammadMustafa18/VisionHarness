"""Authentication Adapter for VisionHarness.

Supports:
1. Google Account Session (CLI adapter using signed-in Google account without API keys)
2. Direct API Key (BYOK) via google.antigravity SDK / Google GenAI
"""

import os
import shutil
import subprocess
import asyncio
from typing import Optional, Dict, Any
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


class GoogleAccountBridge:
    """Invokes the locally signed-in Google Antigravity / Gemini CLI session.
    
    This matches the architecture used by tools like PockoBots and Codex,
    leveraging the user's active Google account subscription without requiring
    a separate API key.
    """

    def __init__(self, cli_binary: str = "agy"):
        self.cli_binary = cli_binary or "agy"

    def is_available(self) -> bool:
        """Checks if the CLI binary is in PATH."""
        return shutil.which(self.cli_binary) is not None

    def get_signed_in_account(self) -> Optional[str]:
        """Attempts to read the active Google account from the local user profile."""
        accounts_file = Path.home() / ".gemini" / "google_accounts.json"
        if accounts_file.exists():
            try:
                import json
                with open(accounts_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("active")
            except Exception:
                pass
        return None

    async def chat(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Executes a non-interactive prompt using the user's authenticated Google CLI session."""
        if not self.is_available():
            raise RuntimeError(
                f"Google CLI binary '{self.cli_binary}' was not found in your system PATH."
            )

        full_prompt = prompt
        if system_prompt:
            full_prompt = f"System Instructions:\n{system_prompt}\n\nUser Request:\n{prompt}"

        # Run agy --print asynchronously
        proc = await asyncio.create_subprocess_exec(
            self.cli_binary,
            "--print",
            full_prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            err = stderr.decode(errors="replace").strip()
            raise RuntimeError(f"CLI session returned code {proc.returncode}: {err}")

        return stdout.decode(errors="replace").strip()


def get_auth_status() -> Dict[str, Any]:
    """Returns available authentication methods and their readiness."""
    bridge = GoogleAccountBridge()
    signed_in_email = bridge.get_signed_in_account()
    api_key_set = bool(os.getenv("GEMINI_API_KEY"))

    active_mode = "none"
    if signed_in_email and bridge.is_available():
        active_mode = "google_account"
    elif api_key_set:
        active_mode = "api_key"

    return {
        "active_mode": active_mode,
        "google_account": {
            "available": bridge.is_available(),
            "signed_in_email": signed_in_email,
        },
        "api_key": {
            "configured": api_key_set,
        },
    }
