"""Entrypoint for the packaged desktop backend.

The Tauri desktop app launches this (as a PyInstaller binary) and talks to it
over HTTP on localhost. All writable state lives under VISIONHARNESS_DATA_DIR so
the app works when installed into a read-only location such as Program Files.

Environment:
    VISIONHARNESS_DATA_DIR  writable folder for sessions/uploads/output/workflows
    VISIONHARNESS_HOST      bind address (default 127.0.0.1)
    VISIONHARNESS_PORT      bind port (default 8000)
"""

import os
import sys


def main() -> None:
    data_dir = os.getenv("VISIONHARNESS_DATA_DIR") or os.path.join(
        os.path.expanduser("~"), ".visionharness"
    )
    os.makedirs(data_dir, exist_ok=True)
    os.environ["VISIONHARNESS_DATA_DIR"] = data_dir

    # Load the user's API keys from the app-data folder (also works for a repo
    # checkout, where load_dotenv() finds the project-root .env on its own).
    try:
        from dotenv import load_dotenv

        load_dotenv(os.path.join(data_dir, ".env"))
        load_dotenv()
    except Exception:
        pass

    import uvicorn

    from visionharness.server import app

    host = os.getenv("VISIONHARNESS_HOST", "127.0.0.1")
    port = int(os.getenv("VISIONHARNESS_PORT", "8000"))

    print(f"[VisionHarness] backend ready on http://{host}:{port}", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info", access_log=False)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
