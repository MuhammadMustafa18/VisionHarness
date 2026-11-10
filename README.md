<div align="center">

<!-- Project Logo / Banner Image Placeholder -->
<!-- ![VisionHarness Logo](./images/LOGO.png) -->
<br />

# VisionOps (VisionHarness)

**Autonomous AI Computer Vision Agent & Real-Time CCTV Intelligence Platform.**  
An open-source, self-hosted agentic platform that turns natural language into verified computer vision workflows with spatial grounding, real-time live streaming, and instant WhatsApp security dispatch.

*Free & Open Source · Zero Cloud Subscription · Bring Your Own Model · Real-Time Local Execution*

[Website](#) · [See It in Action](#see-it-in-action) · [Try a Prompt](#try-a-prompt) · [Features & Capabilities](#features--capabilities) · [WhatsApp Alert Bridge](#whatsapp-alert-dispatcher-baileys) · [Get Started](#get-started) · [Architecture](#how-it-works) · [Build from Source](#build-from-source) · [Contact](#author--contact)

---

<!-- Hero Showcase Image Placeholder -->
<!-- ![VisionOps Hero Studio Showcase](./images/hero_showcase.png) -->
*VisionOps Studio: Autonomous multi-model reasoning, interactive polygon editor, live CCTV telemetry HUD, and WhatsApp alert dispatcher.*

</div>

<br />

## Overview

Give VisionOps a video file, webcam, or RTSP security camera stream, describe what you want in plain English, and let the agent configure, visually ground, verify, and monitor the scene in real time.

**Your hardware is the vision computer.** Detection (YOLOv8 / YOLO11), multi-object association (ByteTrack / BoT-SORT), spatial geometry (Polygon Zones & Tripwire Lines), video decoding, and alerting run locally on your machine. No mandatory enterprise SaaS contracts or closed-source platform locks.

VisionOps is free, open-source software. Language model inference uses standard OpenAI-compatible or Anthropic-compatible endpoints (Gemini, Claude, DeepSeek, local vLLM/Ollama). Model keys and video frames stay on your device unless sent to your chosen LLM/VLM for initial spatial scene grounding.

---

## What's New in v0.2

- **Live CCTV & IP Webcam Studio**: Connect any phone IP camera (`http://<ip>:8080/video`) or security camera RTSP feed. Features zero-lag thread buffering (`CAP_PROP_BUFFERSIZE=1`), live in-video HUD overlays, and real-time telemetry streaming (FPS, footfall, current inside, active tracks).
- **Instant VLM Spatial Grounding**: When a video or stream connects, the vision agent snapshots the scene and automatically identifies perspective, key physical boundaries, and objects using multimodal VLM intelligence.
- **WhatsApp Alert Dispatcher (Baileys Multi-Device)**: Real-time CCTV intrusion and breach notifications sent directly to your WhatsApp with snapshot pictures attached — no WhatsApp Business API fees or approvals needed. Built on `@whiskeysockets/baileys` with in-app QR code pairing.
- **Google Flow-Inspired Minimalist Studio**: Clean monochrome zinc & obsidian interface, collapsible navigation, separate tabs for offline Workspaces, Live Camera Feeds, Models/Characters, and Notification Alerts.

---

## See It in Action

<!-- Live Demo GIF / Image Placeholder -->
<!-- ![VisionOps Live CCTV Stream & Intrusion Alert](./images/live_demo.gif) -->
*Live phone CCTV stream connected to VisionOps with real-time HUD telemetry, polygon boundary tracking, and WhatsApp instant snapshot delivery.*

---

## Features & Capabilities

<!-- Feature Showcase Grid Image Placeholder -->
<!-- ![VisionOps Features Showcase](./images/features_showcase.png) -->

### Try a Prompt
- *"Count how many people enter and exit through the front doorway."*
- *"Track clear plastic bottles on the conveyor belt and alert me if throughput drops below 10/min."*
- *"Monitor the chicken enclosure perimeter and alert my WhatsApp if a predator or dog enters the zone."*
- *"Calculate the average dwell time of customers waiting in the checkout queue."*

The vision agent decomposes requests, maps user concepts to detector classes, checks spatial orientation, and presents verified execution plans before running inference.

---

### What Your Vision Agent Can Do

| Capability | In VisionOps |
| :--- | :--- |
| **Natural Language to CV** | Conversational planner transforms plain English objectives into deterministic, structured workflow specs (`spec.json`). |
| **Multimodal Scene Grounding** | VLM inspects sample frames to understand camera angles, identify objects, and propose normalized polygon zones or crossing lines. |
| **Interactive Geometry Editor** | Visually fine-tune, drag, or redraw polygon vertices and tripwire lines directly on the video canvas with audit diff history. |
| **Live Stream Ingestion** | Connect phone IP webcams (HTTP-MJPEG), security cameras (RTSP), USB webcams, or pre-recorded MP4/AVI videos. |
| **Zero-Lag CCTV Engine** | Background threaded frame grabber with single-frame FIFO buffer prevents network latency buildup. |
| **In-Video Telemetry HUD** | Dynamic in-stream HUD cards render live FPS, cumulative footfall, current occupants, and active track counts directly into the frame. |
| **Instant WhatsApp Alerts** | Dispatches high-priority security notifications with attached snapshot crops directly to your WhatsApp chat or security group. |
| **Component Registry** | Searchable verified models: YOLOv8/YOLO11 detectors, ByteTrack & BoT-SORT trackers, Supervision spatial annotators. |

---

## WhatsApp Alert Dispatcher (Baileys)

<!-- WhatsApp QR Pairing & Alert Notification Image Placeholder -->
<!-- ![WhatsApp QR Scan & Mobile Alert](./images/whatsapp_alerts.png) -->

VisionOps includes a local Baileys microservice running on the WhatsApp Web Multi-Device protocol:

- **Scan & Go**: Open the **Alerts** tab in VisionOps, scan the pairing QR code with your phone (**Settings → Linked Devices → Link a Device**), and you're paired in seconds.
- **Message Yourself**: Alerts can be sent directly to your own personal "You" chat — no second SIM or phone required.
- **Custom Groups & Numbers**: Route breach alerts to a family WhatsApp group or security team JID.
- **Snapshot Proof**: Dispatches both rich text details (timestamp, camera name, object counts) and the exact high-res video frame of the intrusion.
- **Anti-Spam Throttling**: Built-in 45-second debounce window prevents notification flooding.
- **1-Click Disconnect**: Log out and clear credentials from local storage at any time with a single click.

---

## How It Works

<!-- Architecture Diagram Image Placeholder -->
<!-- ![VisionOps Architecture Flow](./images/architecture.png) -->

```mermaid
flowchart TD
    User["User Prompt / CCTV Stream"] --> Agent["ReAct Vision Agent (Antigravity SDK)"]
    Agent --> VLM["VLM Scene Grounder (Perspective & Spatial Zones)"]
    VLM --> Editor["Interactive Canvas Geometry Editor"]
    Editor --> Engine["Vision Runtime Engine (YOLO + ByteTrack)"]
    Engine --> HUD["In-Video Telemetry HUD & Live MJPEG Stream"]
    Engine -->|"Breach Triggered"| Alert["FastAPI Alert Dispatcher"]
    Alert --> Baileys["Baileys WhatsApp Bridge (Local Node.js)"]
    Baileys --> Phone["Your WhatsApp Phone / Security Group 📱"]
```

### What is Local vs. Cloud?

| Runs Locally on Your Machine | Uses Your Chosen API / Network |
| :--- | :--- |
| YOLOv8 / YOLO11 object detection & inference | Language model reasoning (OpenAI, Anthropic, Gemini, or local Ollama) |
| ByteTrack multi-object persistent tracking | Initial VLM scene perspective grounding |
| Spatial polygon geometry & line crossing logic | WhatsApp Web socket communication |
| OpenCV video decoding & MJPEG streaming | Remote RTSP / IP camera network feed |
| Baileys WhatsApp credential storage & bridge | Optional public webhooks |

---

## Get Started

> [!WARNING]  
> **VisionOps v0.2 Beta**: Active development release. Please report edge cases, model questions, or stream connection issues on GitHub Issues!

### Prerequisites
- **Python**: 3.10+
- **Node.js**: 18.0+
- **GPU (Optional)**: NVIDIA GPU with CUDA support for accelerated inference (CPU fallback supported).

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/MuhammadMustafa18/VisionHarness.git
cd VisionHarness
```

### Step 2: Set Up Python Backend
```bash
# Create and activate virtual environment
python -m venv venv

# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install Python requirements
pip install -r requirements.txt
```

### Step 3: Configure Environment Variables
Copy `.env.example` to `.env` and add your model provider keys:
```bash
cp .env.example .env
```
```env
ANTHROPIC_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
ANTHROPIC_AUTH_TOKEN=your_gemini_or_openai_api_key_here
ANTHROPIC_MODEL=mimo-v2.6-flash
```

### Step 4: Install WhatsApp Bridge & Frontend Dependencies
```bash
# Install Baileys WhatsApp Bridge
cd services/whatsapp-bridge
npm install
cd ../..

# Install Web Frontend
cd web
npm install
cd ..
```

---

## Running the Application

Start the three companion services (or run each in a dedicated terminal):

```bash
# Terminal 1: FastAPI Vision Engine & API
python -m uvicorn visionharness.server:app --port 8000

# Terminal 2: WhatsApp Baileys Alert Bridge
node services/whatsapp-bridge/server.js

# Terminal 3: Next.js Studio Frontend
cd web && npm run dev
```

Open your browser at **[http://localhost:3000](http://localhost:3000)**.

---

## Connecting a Camera

### Option 1: Phone as Camera (Recommended for Quick Demo)
1. Install **IP Webcam** (Android) or **IP Camera Lite** (iOS) on your phone.
2. Connect your phone and PC to the same Wi-Fi network.
3. Start the server on the app. It will display a local address (e.g., `http://192.168.1.45:8080`).
4. In VisionOps, click **Videos** or **Live Streams** in the sidebar, paste:
   ```text
   http://192.168.1.45:8080/video
   ```
5. Click **Connect Camera** — the scene is grounded instantly and live telemetry begins!

### Option 2: Physical CCTV Camera (RTSP)
Enter the RTSP stream URL of your security camera:
```text
rtsp://admin:password@192.168.1.100:554/stream1
```

### Option 3: Virtual CCTV (Local Video File)
Paste any local video path to simulate a surveillance feed:
```text
output/demo_vlm_hud_video.mp4
```

---

## Comparison

<!-- Comparison Table Banner Image Placeholder -->
<!-- ![VisionOps vs Enterprise CCTV Platforms](./images/comparison.png) -->

| Feature / Metric | VisionOps (VisionHarness) | Traditional Enterprise CCTV | Cloud Video AI SaaS |
| :--- | :--- | :--- | :--- |
| **Pricing** | **$0 / Free & Open Source** | $500–$5,000+ per camera license | $0.10–$0.50 per stream minute |
| **Setup Time** | **< 3 minutes** | Weeks of NVR / proprietary setup | Cloud ingestion setup & bandwidth costs |
| **Interaction** | **Natural Language Copilot** | Hardcoded rigid rule menus | Complex JSON API configurations |
| **Mobile Alerts** | **Direct WhatsApp + Snapshot** | SMS (paid) or Proprietary App | Email / Webhook only |
| **Camera Support** | **RTSP, Phone IP Webcam, USB, MP4** | Vendor-locked IP cameras | Cloud-compatible streams only |
| **Data Privacy** | **Local execution on your hardware** | Local NVR hardware | Stream leaves premises to third-party cloud |

---

## Project Structure

```text
VisionHarness/
├── visionharness/               # Core Python Engine
│   ├── agent/                   # ReAct Agent loop, tools, and VLM grounding
│   ├── runtime/                 # Live camera worker, zero-lag grabber & YOLO engine
│   ├── core/                    # Session stores, schemas, and specs
│   └── server.py                # FastAPI endpoints (SSE streams, sessions, telemetry)
├── services/
│   └── whatsapp-bridge/         # Baileys WhatsApp microservice (Node.js)
├── web/                         # Next.js Studio Frontend
│   ├── components/              # Interactive GeometryEditor, chat drawers, telemetry
│   └── pages/                   # Flow-inspired minimalist Studio canvas
├── images/                      # Documentation screenshots, assets & sample test images
├── uploads/                     # Uploaded user video footage
└── output/                      # Rendered video outputs & alert snapshot crops
```

---

## Build from Source & Verification

To verify frontend TypeScript types and Turbopack builds:
```bash
cd web
npm run build
```

To run test suites:
```bash
pytest tests/
```

---

## License & Credits

VisionOps (VisionHarness) is open-source software licensed under the **[MIT License](LICENSE)**.

Built with:
- **[Ultralytics YOLO](https://github.com/ultralytics/ultralytics)** — Object detection & segmentation.
- **[Supervision](https://github.com/roboflow/supervision)** — Spatial analytics, polygon zones, and annotators.
- **[Baileys](https://github.com/WhiskeySockets/Baileys)** — WhatsApp Web Multi-Device protocol engine.
- **[Next.js](https://nextjs.org/) & [Tailwind CSS](https://tailwindcss.com/)** — Studio frontend.
- **[FastAPI](https://fastapi.tiangolo.com/) & [OpenCV](https://opencv.org/)** — Real-time backend streaming and inference.

---

## Author & Contact

Created by **Muhammad Mustafa**. For inquiries, contributions, and discussions:

- **GitHub**: [@MuhammadMustafa18](https://github.com/MuhammadMustafa18)
- **Repository**: [https://github.com/MuhammadMustafa18/VisionHarness](https://github.com/MuhammadMustafa18/VisionHarness)
