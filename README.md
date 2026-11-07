# VisionHarness

> **Agentic Computer Vision Builder** — Describe what you want your camera or video stream to do in natural language, and let the agent assemble, test, and save verified computer vision workflows.

---

## Overview

VisionHarness is an autonomous system powered by the **Google Antigravity SDK** that bridges natural-language prompts and real-time computer vision pipelines.

Instead of writing custom CV code for every camera use case:
1. **Describe the goal**: *"Keep track of how many people enter and leave my store."*
2. **Decompose & Discover**: Agent identifies required tasks (detection, persistent tracking, line crossing) and selects verified CV models (YOLO, ByteTrack, Supervision).
3. **Structured Specification**: Generates an unambiguous, portable workflow specification (`workflow.json`).
4. **Source-Agnostic Execution**: Executes against uploaded videos, live webcams, or RTSP surveillance streams.
5. **Interactive Visual Debugging**: Validate tracking IDs, crossing lines, and event triggers on reference footage before deploying.

---

## Architecture

```
User Prompt ("Count people crossing the store entrance")
                          │
                          ▼
             Vision Planner Agent (Antigravity SDK)
                          │
       ┌──────────────────┴──────────────────┐
       ▼                                     ▼
Model & Component Registry           Workflow Specification
(YOLO, ByteTrack, SAM2, OpenCV)          (Declarative JSON)
       │                                     │
       └──────────────────┬──────────────────┘
                          ▼
                Vision Runtime Engine
       ┌──────────────────┼──────────────────┐
       ▼                  ▼                  ▼
 Uploaded Video         Webcam          RTSP CCTV Stream
```

---

## Quickstart

### 1. Prerequisites
- Python 3.10+
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### 2. Installation
```bash
git clone https://github.com/MuhammadMustafa18/VisionHarness.git
cd VisionHarness

# Create virtual environment
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Configure Environment
Copy `.env.example` to `.env` and insert your Gemini API key:
```bash
cp .env.example .env
```

---

## License
MIT License.
