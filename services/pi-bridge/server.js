/**
 * VisionHarness Pi Agent Bridge Service
 *
 * Runs the @earendil-works/pi-coding-agent harness with VisionOps custom tools
 * backed by the Python FastAPI server (/api/tools/{tool_name}), streaming SSE
 * events in the exact format expected by the VisionOps web UI.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import {
  createAgentSession,
  defineTool,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// Load root .env into process.env (without overriding already-set env vars)
function loadRootEnv() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}
loadRootEnv();

const PORT = Number(process.env.PI_BRIDGE_PORT || 8787);
const PYTHON_API_URL = (process.env.VISIONHARNESS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const ENABLE_CODING_TOOLS = process.env.PI_ENABLE_CODING_TOOLS === "1";

let sharedModelRuntime = null;
let sharedModel = null;

async function getModelConfig() {
  if (sharedModelRuntime && sharedModel) {
    return { modelRuntime: sharedModelRuntime, model: sharedModel };
  }

  const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });

  const anthropicBase = process.env.ANTHROPIC_BASE_URL;
  const anthropicKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  const anthropicModel = process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;

  if (anthropicBase && anthropicKey && anthropicModel) {
    modelRuntime.registerProvider("visionops-anthropic", {
      baseUrl: anthropicBase.replace(/\/$/, ""),
      apiKey: anthropicKey,
      api: "anthropic-messages",
      models: [
        {
          id: anthropicModel,
          name: anthropicModel,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        },
      ],
    });
    sharedModel = modelRuntime.getModel("visionops-anthropic", anthropicModel);
  } else if (process.env.GEMINI_API_KEY) {
    const geminiModelId = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    await modelRuntime.setRuntimeApiKey("google", process.env.GEMINI_API_KEY);
    sharedModel = modelRuntime.getModel("google", geminiModelId);
  }

  sharedModelRuntime = modelRuntime;
  return { modelRuntime: sharedModelRuntime, model: sharedModel };
}

const VISIONOPS_SYSTEM_PROMPT = `You are VisionHarness, an autonomous AI Computer Vision Architect and Agent powered by the Pi harness.
You design, ground, verify, and run real-world computer vision workflows across video files, webcams, and live RTSP CCTV streams.

GUIDELINES:
1. SCENE GROUNDING & PERSISTENCE:
   - When a new video is first provided, call \`vlm_ground_scene\` ONCE to inspect the scene, camera perspective, and propose tracking zones or lines.
   - Grounding is saved for the session. Once grounded, do NOT call \`vlm_ground_scene\` again unless the user asks to re-ground; use \`get_scene_grounding\` instead.
2. GEOMETRY EDITOR & USER EDITS:
   - When the user asks to show, draw, edit, adjust, or reshape a zone or line, call \`open_geometry_editor\` (only if a video is attached in workspace state).
   - Always preserve custom user-edited coordinates from workspace state or \`get_geometry_history\`. Never overwrite them unless asked.
3. VIDEO INSPECTION & VERIFICATION:
   - Use \`inspect_video_metadata\` when you need resolution, FPS, duration, or frame count before planning.
   - Use \`extract_frame\` to grab a specific timestamp/frame for inspection.
4. LIVE STREAMS, WORKFLOWS & ALERTS:
   - Use \`manage_live_stream\` to connect, check telemetry, update specs, or stop live RTSP/IP cameras.
   - Use \`manage_workflows\` to list, load, or save reusable WorkflowSpec JSONs.
   - Use \`send_whatsapp_alert\` only when the user asks to send an alert or test WhatsApp dispatch.
5. PIPELINE EXECUTION & ANALYTICS:
   - Only call \`run_pipeline\` when the user confirms or asks to execute detection/tracking.
   - Use \`query_inference_results\` for questions about counts, peak occupancy, or zone analytics.
   - When presenting a workflow spec for confirmation, format it in a \`\`\`json code block.
6. Be concise, friendly, and practical. Do not call tools for greetings or casual chat.`;

/**
 * Per-session state: Pi AgentSession + mutable workspace ref updated on each request.
 */
const sessions = new Map();

async function callPythonTool(toolName, input, workspaceRef) {
  const res = await fetch(`${PYTHON_API_URL}/api/tools/${encodeURIComponent(toolName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: input || {},
      workspace: workspaceRef.current || {},
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Python tool '${toolName}' failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  if (data.workspace && typeof data.workspace === "object") {
    workspaceRef.current = { ...workspaceRef.current, ...data.workspace };
  }
  return data.output;
}

function makeVisionTool({ name, label, description, promptSnippet, promptGuidelines, parameters }, workspaceRef) {
  return defineTool({
    name,
    label,
    description,
    promptSnippet,
    promptGuidelines,
    parameters,
    async execute(_toolCallId, params) {
      const output = await callPythonTool(name, params, workspaceRef);
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        details: output,
      };
    },
  });
}

function buildVisionTools(workspaceRef) {
  return [
    makeVisionTool(
      {
        name: "vlm_ground_scene",
        label: "VLM Ground Scene",
        description:
          "Inspect sample frames from video footage using VLM to ground scene perspective, identify objects, and propose spatial polygon zones or crossing lines. Call at most once per video.",
        promptSnippet: "vlm_ground_scene: Visually ground a video scene and propose tracking zones/lines",
        parameters: Type.Object({
          video_path: Type.Optional(Type.String({ description: "Path to the video file" })),
          goal: Type.Optional(Type.String({ description: "User tracking objective" })),
        }),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "get_scene_grounding",
        label: "Get Scene Grounding",
        description:
          "Retrieve previously grounded scene analysis (detected objects, proposed zones/lines, perspective) for the active session without re-running VLM.",
        promptSnippet: "get_scene_grounding: Recall saved VLM scene grounding for this session",
        parameters: Type.Object({}),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "open_geometry_editor",
        label: "Open Geometry Editor",
        description:
          "Open or display the interactive visual geometry editor on the video in the UI so the user can view, draw, or edit polygon zones or crossing lines.",
        promptSnippet: "open_geometry_editor: Open the interactive polygon/line editor in the UI",
        parameters: Type.Object({
          video_path: Type.Optional(Type.String({ description: "Path to the video footage" })),
          geometry_type: Type.Optional(Type.Union([Type.Literal("polygon"), Type.Literal("line")])),
          proposed_zones: Type.Optional(Type.Array(Type.Any(), { description: "Optional polygon zones to pre-populate" })),
        }),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "get_geometry_history",
        label: "Get Geometry History",
        description:
          "Query current geometry coordinates, original VLM proposal, and user edit history diff for the active video.",
        promptSnippet: "get_geometry_history: Inspect current zones/lines and user edit audit diff",
        parameters: Type.Object({
          target: Type.Optional(Type.String({ description: "'current_geometry', 'edit_diff', or 'full_history'" })),
        }),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "search_components",
        label: "Search CV Components",
        description: "Search verified computer vision modules (YOLO detectors, ByteTrack/BoT-SORT trackers, annotators).",
        promptSnippet: "search_components: Search verified detectors, trackers, and annotators",
        parameters: Type.Object({
          category: Type.Optional(Type.String({ description: "detector, tracker, filter, or sink" })),
          query: Type.Optional(Type.String({ description: "Search keyword e.g. yolo, bytetrack" })),
        }),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "run_pipeline",
        label: "Run Vision Pipeline",
        description:
          "Execute YOLO detection + ByteTrack tracking on the full video using the confirmed WorkflowSpec. Only call when the user confirms or asks to run.",
        promptSnippet: "run_pipeline: Run YOLO + ByteTrack inference on the video",
        parameters: Type.Object({
          video_path: Type.Optional(Type.String({ description: "Path to the video file" })),
          spec: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "WorkflowSpec object" })),
        }),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "query_inference_results",
        label: "Query Inference Results",
        description:
          "Query prior pipeline execution metrics, counts, peak occupancy, zone analytics, and FPS for this workspace.",
        promptSnippet: "query_inference_results: Query counts, occupancy, and stats from prior runs",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "Metric to check, e.g. total_people, peak_occupancy, fps" })),
        }),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "inspect_video_metadata",
        label: "Inspect Video Metadata",
        description: "Probe a video file's resolution, FPS, frame count, duration, codec, and file size.",
        promptSnippet: "inspect_video_metadata: Inspect video resolution, FPS, duration, and codec",
        parameters: Type.Object({
          video_path: Type.Optional(Type.String({ description: "Path to the video file" })),
        }),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "extract_frame",
        label: "Extract Video Frame",
        description: "Extract a JPEG frame from a video at a given timestamp (seconds) or frame index.",
        promptSnippet: "extract_frame: Capture a frame from a video at a timestamp or frame index",
        parameters: Type.Object({
          video_path: Type.Optional(Type.String({ description: "Path to the video file" })),
          timestamp_sec: Type.Optional(Type.Number({ description: "Timestamp in seconds" })),
          frame_index: Type.Optional(Type.Number({ description: "Exact frame index" })),
        }),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "manage_live_stream",
        label: "Manage Live CCTV Stream",
        description: "Connect, fetch real-time telemetry, update WorkflowSpec, or stop a live RTSP/IP camera stream.",
        promptSnippet: "manage_live_stream: Control live CCTV streams and read real-time telemetry",
        parameters: Type.Object({
          action: Type.Union([
            Type.Literal("telemetry"),
            Type.Literal("status"),
            Type.Literal("connect"),
            Type.Literal("update_spec"),
            Type.Literal("stop"),
          ]),
          session_id: Type.Optional(Type.String({ description: "Live stream session ID" })),
          stream_url: Type.Optional(Type.String({ description: "RTSP or HTTP-MJPEG camera URL" })),
          spec: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "WorkflowSpec for update_spec" })),
        }),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "send_whatsapp_alert",
        label: "Send WhatsApp Alert",
        description: "Send a WhatsApp security notification (with optional snapshot image) via the local Baileys bridge.",
        promptSnippet: "send_whatsapp_alert: Dispatch a WhatsApp alert with optional snapshot",
        parameters: Type.Object({
          message: Type.String({ description: "Alert message text" }),
          image_path: Type.Optional(Type.String({ description: "Optional path to snapshot image" })),
          to: Type.Optional(Type.String({ description: "Optional recipient JID or phone number" })),
        }),
      },
      workspaceRef
    ),
    makeVisionTool(
      {
        name: "manage_workflows",
        label: "Manage Saved Workflows",
        description: "List, load, or save reusable WorkflowSpec JSON files in the workflows directory.",
        promptSnippet: "manage_workflows: List, load, or save reusable WorkflowSpec JSONs",
        parameters: Type.Object({
          action: Type.Union([Type.Literal("list"), Type.Literal("get"), Type.Literal("save")]),
          workflow_id: Type.Optional(Type.String({ description: "Workflow ID for action='get'" })),
          spec: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "WorkflowSpec for action='save'" })),
        }),
      },
      workspaceRef
    ),
  ];
}

async function getOrCreateSession(sessionId, initialWorkspace) {
  let entry = sessions.get(sessionId);
  if (entry) {
    entry.workspaceRef.current = { ...entry.workspaceRef.current, ...(initialWorkspace || {}), session_id: sessionId };
    return entry;
  }

  const workspaceRef = { current: { ...(initialWorkspace || {}), session_id: sessionId } };
  const customTools = buildVisionTools(workspaceRef);

  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: PROJECT_ROOT,
    agentDir,
    settingsManager,
    systemPromptOverride: () => VISIONOPS_SYSTEM_PROMPT,
  });
  await resourceLoader.reload();

  const { modelRuntime, model } = await getModelConfig();
  const { session } = await createAgentSession({
    cwd: PROJECT_ROOT,
    agentDir,
    modelRuntime,
    model,
    noTools: ENABLE_CODING_TOOLS ? undefined : "builtin",
    customTools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  entry = { session, workspaceRef };
  sessions.set(sessionId, entry);
  return entry;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        harness: "pi-coding-agent",
        python_api: PYTHON_API_URL,
        active_sessions: sessions.size,
        coding_tools_enabled: ENABLE_CODING_TOOLS,
      })
    );
    return;
  }

  if (req.method === "POST" && req.url === "/session/reset") {
    const body = await readJsonBody(req);
    if (body.session_id) {
      sessions.delete(body.session_id);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "reset" }));
    return;
  }

  if (req.method === "POST" && req.url === "/agent/stream") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Invalid JSON: ${e.message}` }));
      return;
    }

    const sessionId = body.session_id || "default";
    const userPrompt = (body.prompt || "").trim();
    const workspace = body.workspace || {};

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let unsubscribe = null;
    try {
      const { session, workspaceRef } = await getOrCreateSession(sessionId, workspace);

      const wsContext = Object.keys(workspaceRef.current || {}).length
        ? `\n\n[ACTIVE WORKSPACE STATE]\n${JSON.stringify(workspaceRef.current)}\n`
        : "";
      const fullPrompt = `${userPrompt}${wsContext}`;

      unsubscribe = session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent) {
          const ame = event.assistantMessageEvent;
          if (ame.type === "text_delta" && ame.delta) {
            writeSse(res, { type: "text", delta: ame.delta });
          } else if (ame.type === "thinking_delta" && ame.delta) {
            writeSse(res, { type: "thinking", delta: ame.delta });
          }
        } else if (event.type === "tool_execution_start") {
          writeSse(res, {
            type: "tool_call",
            id: event.toolCallId,
            name: event.toolName,
            input: event.args || {},
            status: "calling",
          });
        } else if (event.type === "message_end" && event.message?.stopReason === "error") {
          const msg = event.message.errorMessage || "Model returned an error";
          console.error(`[pi-bridge] Model error:`, msg);
          writeSse(res, { type: "error", message: msg });
        } else if (event.type === "tool_execution_end") {
          const output = event.result?.details ?? event.result;
          writeSse(res, {
            type: "tool_result",
            id: event.toolCallId,
            name: event.toolName,
            output,
            status: event.isError ? "error" : "completed",
          });
        }
      });

      await session.prompt(fullPrompt);
      writeSse(res, { type: "done", workspace: workspaceRef.current });
    } catch (err) {
      console.error("[pi-bridge] Stream error:", err?.stack || err);
      writeSse(res, { type: "error", message: err?.message || String(err) });
      writeSse(res, { type: "done", workspace });
    } finally {
      if (unsubscribe) unsubscribe();
      res.end();
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[pi-bridge] VisionHarness Pi Agent listening on http://127.0.0.1:${PORT}`);
  console.log(`[pi-bridge] Python tool backend: ${PYTHON_API_URL}`);
});
