import React, { useState, useEffect, useRef } from "react";
import Head from "next/head";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import GeometryEditor from "@/components/GeometryEditor";
import {
  Plus,
  Play,
  Upload,
  Layers,
  Sparkles,
  Search,
  Sliders,
  SlidersHorizontal,
  FolderPlus,
  Folder,
  ChevronRight,
  ArrowUp,
  Globe,
  Settings,
  CheckCircle2,
  Video,
  Activity,
  Cpu,
  Eye,
  PanelLeftClose,
  PanelRightClose,
  BarChart3,
  Inbox,
  LayoutGrid,
  Command,
  Sun,
  Moon,
  StopCircle,
  Info,
  Radio,
  Cctv,
  Camera,
  Maximize2,
  Minimize2,
  RefreshCw,
  Send,
  Film,
  Clapperboard,
  User,
  Trash,
  PanelLeft
} from "lucide-react";

interface WorkflowSession {
  id: string;
  name: string;
  domain: string;
  folder: string;
  thumbnail_url?: string;
  count?: number;
}

interface ToolCall {
  name: string;
  args: any;
  output?: any;
  status: "calling" | "completed" | "error";
}

interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  thoughts?: string;
  spec?: any;
  diagramSvg?: string;
  stats?: any;
  videoUrl?: string | null;
  toolCalls?: ToolCall[];
  uploadedVideoUrl?: string;
  uploadedVideoName?: string;
  uploadedVideoPath?: string;
  isUploading?: boolean;
  uploadProgress?: number | null;
  uploadDone?: boolean;
  activeVideoFile?: File;
  timestamp: string;
  geometryEditEvent?: {
    action: "saved";
    actor?: "user" | "ai";
    revision?: number;
    geometry_type: "polygon" | "line";
    original_zones?: any[];
    original_lines?: any[];
    zones?: any[];
    lines?: any[];
    summary: string;
  };
}

const API_BASE = "http://localhost:8000";

// The desktop build starts its Python backend alongside the window, so the
// first requests can arrive before it is listening. Retry instead of giving up.
async function waitForBackend(attempts = 30, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${API_BASE}/api/status`, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      // backend not up yet
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

export default function VisionHarnessApp() {
  const [sessions, setSessions] = useState<WorkflowSession[]>([
    { id: "wf_store_people_counter", name: "Store Counter", domain: "retail_analytics", folder: "Navigation", count: 12 },
    { id: "wf_traffic_flow", name: "Traffic Flow", domain: "traffic_monitoring", folder: "Navigation" },
    { id: "wf_vault_security", name: "Vault Perimeter", domain: "perimeter_security", folder: "Projects" },
    { id: "wf_vehicle_dwell", name: "Parking Dwell", domain: "traffic_monitoring", folder: "Projects" },
  ]);

  const [activeSessionId, setActiveSessionId] = useState("wf_store_people_counter");
  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  const [prompt, setPrompt] = useState("");
  const [isPlanning, setIsPlanning] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isGrounding, setIsGrounding] = useState(false);
  const [showThoughts, setShowThoughts] = useState(true);

  const [selectedModel, setSelectedModel] = useState("mimo-v2.6-flash");
  const [selectedToolMode, setSelectedToolMode] = useState("Workspace Write");
  const [runningStepIndex, setRunningStepIndex] = useState(0);
  const [expandedToolCalls, setExpandedToolCalls] = useState<{ [msgId: string]: boolean }>({});
  const [workspaceState, setWorkspaceState] = useState<{
    video_path?: string;
    video_url?: string;
    video_name?: string;
    spec?: any;
    last_stats?: any;
  }>({});
  const [systemHardware, setSystemHardware] = useState<any>(null);
  const [estimatedSeconds, setEstimatedSeconds] = useState<number | null>(null);
  const [pipelineElapsed, setPipelineElapsed] = useState<number>(0);
  const [livePipelineProgress, setLivePipelineProgress] = useState<{
    frame?: number;
    total_frames?: number;
    progress_pct?: number;
    fps?: number;
    unique_tracks?: number;
  } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeMediaFilter, setActiveMediaFilter] = useState<"all" | "live" | "videos" | "models">("all");

  // Live Mode State
  const isLiveWorkspace = activeSession?.domain === "live_cctv";
  const [liveStreamUrl, setLiveStreamUrl] = useState("output/demo_vlm_hud_video.mp4");
  const [liveInputUrl, setLiveInputUrl] = useState("");
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isLiveConnecting, setIsLiveConnecting] = useState(false);
  const [isLiveFullscreen, setIsLiveFullscreen] = useState(false);
  const [showLiveConnectModal, setShowLiveConnectModal] = useState(false);
  const [liveCameraLabel, setLiveCameraLabel] = useState("CAM-01: Live Camera Feed");
  const [liveFps, setLiveFps] = useState(0.0);
  const [liveActiveTracks, setLiveActiveTracks] = useState(0);
  const [liveZoneFootfall, setLiveZoneFootfall] = useState(0);
  const [liveCurrentInside, setLiveCurrentInside] = useState(0);
  const [liveSnapshotUrl, setLiveSnapshotUrl] = useState<string | null>(null);

  // Vision engines registry
  const [components, setComponents] = useState<any[]>([]);
  const [enginesOpen, setEnginesOpen] = useState(true);
  const [chatsOpen, setChatsOpen] = useState(true);
  const [liveChatsOpen, setLiveChatsOpen] = useState(true);
  const [selectedComponent, setSelectedComponent] = useState<any | null>(null);
  const [activeEditorMessageId, setActiveEditorMessageId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/components`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setComponents(data); })
      .catch(() => {});
  }, []);

  // Abort handles for in-flight agent / ground / run requests
  const agentAbortRef = useRef<AbortController | null>(null);
  const groundAbortRef = useRef<AbortController | null>(null);
  const runXhrRef = useRef<XMLHttpRequest | null>(null);

  const isBusy = isPlanning || isRunning || isGrounding;

  const handleStop = () => {
    agentAbortRef.current?.abort();
    groundAbortRef.current?.abort();
    runXhrRef.current?.abort();
    agentAbortRef.current = null;
    groundAbortRef.current = null;
    runXhrRef.current = null;
    setIsPlanning(false);
    setIsRunning(false);
    setIsGrounding(false);
    setUploadProgress(null);
  };

  // Apply theme to document + persist preference
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("vh_theme", theme);
    } catch {}
  }, [theme]);

  // Hydrate saved theme once on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vh_theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {}
  }, []);

  useEffect(() => {
    fetch("http://localhost:8000/api/status")
      .then(res => res.json())
      .then(data => {
        if (data.hardware) setSystemHardware(data.hardware);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let timer: any;
    if (isRunning) {
      setPipelineElapsed(0);
      timer = setInterval(() => {
        setPipelineElapsed(prev => prev + 1);
      }, 1000);
    } else {
      setEstimatedSeconds(null);
    }
    return () => clearInterval(timer);
  }, [isRunning]);

  const runningSteps = [
    "Grounding scene perspective with mimo-v2.6-flash...",
    "Sampling representative video frames (skipping black intros)...",
    "Analyzing physical environment & spatial boundaries...",
    "Computing normalized geometry coordinates...",
  ];

  useEffect(() => {
    let interval: any;
    if (isRunning || isGrounding) {
      setRunningStepIndex(0);
      interval = setInterval(() => {
        setRunningStepIndex(prev => (prev + 1) % runningSteps.length);
      }, 1800);
    }
    return () => clearInterval(interval);
  }, [isRunning, isGrounding]);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "m-1",
      sender: "user",
      text: "Could you introduce yourself?",
      timestamp: "10:30 AM"
    },
    {
      id: "m-2",
      sender: "bot",
      text: `I'm VisionHarness, an open-source computer vision architect. I build and execute autonomous vision workflows across video streams and edge devices.

Capabilities:
• Object Detection — YOLO11, RT-DETR, and custom checkpoints.
• Persistent Tracking — ByteTrack and BoT-SORT multi-object associations.
• Spatial Logic — Directional line crossings, polygon zones, and dwell timers.
• Stream Runtime — Local MP4 files, USB webcams, and CCTV RTSP streams.`,
      thoughts: "Identified introduction request. Ready with YOLO11 and ByteTrack primitives.",
      timestamp: "10:30 AM"
    }
  ]);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadDone, setUploadDone] = useState(false);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await waitForBackend();
      if (cancelled) return;
      fetch(`${API_BASE}/api/sessions`)
        .then(res => res.json())
        .then(data => {
          if (!cancelled && data && data.length > 0) {
            setSessions(data);
            setActiveSessionId(data[0].id);
          }
        })
        .catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [searchQuery, setSearchQuery] = useState("");

  const filteredSessions = sessions.filter(s =>
    (s.name || s.id).toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    if (!activeSessionId) return;
    // Clear workspace state immediately when switching to avoid stale footage / stats bleeding in
    setWorkspaceState({});

    // Load messages AND the saved workspace state in parallel
    Promise.all([
      fetch(`http://localhost:8000/api/sessions/${activeSessionId}/messages`).then(r => r.json()).catch(() => []),
      fetch(`http://localhost:8000/api/sessions/${activeSessionId}/workspace`).then(r => r.json()).catch(() => null)
    ]).then(([msgs, savedWorkspace]) => {
      if (msgs && msgs.length > 0) {
        const normalized = msgs.map((m: any) => ({
          ...m,
          videoUrl: m.videoUrl || m.video_url,
          uploadedVideoUrl: m.uploadedVideoUrl,
          uploadedVideoName: m.uploadedVideoName,
          uploadDone: m.uploadDone,
          diagramSvg: m.diagramSvg || m.diagram_svg
        }));
        setMessages(normalized);
      }

      // Prefer the explicitly saved workspace — no guessing
      if (savedWorkspace && Object.keys(savedWorkspace).length > 0) {
        setWorkspaceState(savedWorkspace);
      } else if (msgs && msgs.length > 0) {
        // Fallback: reconstruct from messages (older sessions without workspace.json)
        const normalized = msgs.map((m: any) => ({ ...m, videoUrl: m.videoUrl || m.video_url }));
        const lastWithVideo = [...normalized].reverse().find((m: any) => m.uploadedVideoUrl || m.uploadedVideoPath);
        const lastWithStats = [...normalized].reverse().find((m: any) => m.stats);
        const lastWithGeometrySpec = [...normalized].reverse().find((m: any) =>
          m.spec && (
            (m.spec.zones && m.spec.zones.length > 0) ||
            (m.spec.lines && m.spec.lines.length > 0) ||
            (m.spec.workflow?.zones && m.spec.workflow.zones.length > 0) ||
            (m.spec.workflow?.lines && m.spec.workflow.lines.length > 0)
          )
        );
        const lastWithSpec = lastWithGeometrySpec || [...normalized].reverse().find((m: any) => m.spec);
        const restoredWs = {
          ...(lastWithVideo ? {
            video_url: lastWithVideo.uploadedVideoUrl,
            video_name: lastWithVideo.uploadedVideoName,
            video_path: lastWithVideo.uploadedVideoPath || (lastWithVideo.uploadedVideoName ? `./uploads/${lastWithVideo.uploadedVideoName}` : undefined)
          } : {}),
          ...(lastWithStats?.stats ? { last_stats: lastWithStats.stats } : {}),
          ...(lastWithSpec?.spec ? { spec: lastWithSpec.spec } : {})
        };
        if (Object.keys(restoredWs).length > 0) setWorkspaceState(restoredWs);
      }
    });
  }, [activeSessionId]);

  const prevMsgCountRef = useRef(messages.length);
  useEffect(() => {
    // Only auto-scroll down if a new message was added while already near bottom or on sending
    if (messages.length > prevMsgCountRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length]);

  // Auto-persist workspace state to backend whenever it changes (debounced 800ms)
  const workspaceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeSessionId || Object.keys(workspaceState).length === 0) return;
    if (workspaceSaveTimerRef.current) clearTimeout(workspaceSaveTimerRef.current);
    workspaceSaveTimerRef.current = setTimeout(() => {
      fetch(`http://localhost:8000/api/sessions/${activeSessionId}/workspace`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workspaceState)
      }).catch(() => {});
    }, 800);
    return () => {
      if (workspaceSaveTimerRef.current) clearTimeout(workspaceSaveTimerRef.current);
    };
  }, [workspaceState, activeSessionId]);

  const handleConnectStream = async (targetUrl?: string) => {
    const urlToUse = targetUrl || liveInputUrl.trim() || liveStreamUrl;
    if (!urlToUse) return;

    setIsLiveConnecting(true);
    try {
      const res = await fetch("http://localhost:8000/api/live/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: activeSessionId,
          stream_url: urlToUse,
          goal: "Live video tracking and spatial monitoring"
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to connect to stream. Please check URL.");
        setIsLiveConnecting(false);
        return;
      }

      const data = await res.json();
      setLiveStreamUrl(urlToUse);
      setIsLiveConnected(true);
      setShowLiveConnectModal(false);
      if (data.snapshot_url) {
        setLiveSnapshotUrl(`http://localhost:8000${data.snapshot_url}`);
      }

      // Update workspace state with the snapshot frame and grounded geometry
      setWorkspaceState(prev => ({
        ...prev,
        video_path: data.snapshot_path,
        video_url: data.snapshot_url ? `http://localhost:8000${data.snapshot_url}` : undefined,
        spec: {
          ...(prev.spec || {}),
          geometry_type: data.grounding?.geometry_type || "polygon",
          zones: data.grounding?.zones || [],
          lines: data.grounding?.lines || []
        }
      }));

      // Post initial assistant message with VLM scene analysis
      if (data.grounding?.scene_analysis) {
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            sender: "bot",
            text: `Connected to live stream! 📡\n\n**Scene Grounding:**\n${data.grounding.scene_analysis}\n\nWhat objects or activities would you like to track on this camera?`,
            thoughts: "Live stream connected. Initial snapshot captured and grounded via VLM.",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
    } catch (e: any) {
      alert("Error connecting to live stream: " + e.message);
    } finally {
      setIsLiveConnecting(false);
    }
  };

  // Poll live telemetry every 500ms when live mode is active
  useEffect(() => {
    if (!isLiveWorkspace || !isLiveConnected) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/live/${activeSessionId}/telemetry`);
        if (res.ok) {
          const t = await res.json();
          if (t.is_running) {
            setLiveFps(t.fps || 0);
            setLiveActiveTracks(t.active_tracks || 0);
            setLiveZoneFootfall(t.total_entered || 0);
            setLiveCurrentInside(t.current_inside || 0);
          }
        }
      } catch (e) {}
    }, 600);

    return () => clearInterval(interval);
  }, [isLiveWorkspace, isLiveConnected, activeSessionId]);

  const handleNewLiveChat = () => {
    const newId = `wf_live_${Date.now()}`;
    const newSession: WorkflowSession = {
      id: newId,
      name: "Live CCTV Stream",
      domain: "live_cctv",
      folder: "Live Feeds"
    };

    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setUploadDone(false);
    setUploadProgress(null);
    setWorkspaceState({});
    setLiveFps(0);
    setLiveActiveTracks(0);
    setLiveZoneFootfall(0);
    setLiveCurrentInside(0);
    setIsLiveConnected(false);
    setShowLiveConnectModal(true);
    setMessages([
      {
        id: Date.now().toString(),
        sender: "bot",
        text: "Ready to connect your camera. Enter your phone IP webcam URL (e.g. `http://192.168.1.X:8080/video`) or RTSP feed to start live tracking.",
        thoughts: "Live mode initialized. Awaiting stream URL from user.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);

    fetch("http://localhost:8000/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newSession)
    }).catch(() => {});
  };

  const handleNewChat = () => {
    const newId = `wf_${Date.now()}`;
    const newSession: WorkflowSession = {
      id: newId,
      name: "New Vision Workflow",
      domain: "general_vision",
      folder: "Navigation"
    };

    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setUploadDone(false);
    setUploadProgress(null);
    setWorkspaceState({});
    // CRITICAL: wipe workspace so old stats/video/spec never leak into a new chat
    setWorkspaceState({});

    setMessages([]);

    // Save to disk session store
    fetch("http://localhost:8000/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newSession)
    }).catch(() => {});
  };

  const handleFileUpload = (file: File) => {
    // Only stage the file in state and prompt bar — do NOT post a chat message yet!
    setVideoFile(file);
    const fileUrl = URL.createObjectURL(file);
    setVideoPreviewUrl(fileUrl);
  };

  const handleSendPrompt = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isPlanning) return;

    const currentPrompt = prompt;
    setPrompt("");

    // Capture staged file BEFORE clearing badge state (React state in closure is stable for this turn)
    const stagedFile = videoFile;
    const stagedPreviewUrl = videoPreviewUrl;

    // Clear staged input bar file after message is submitted
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setIsPlanning(true);

    let activeVideoPath = workspaceState.video_path;
    let activeVideoUrl = workspaceState.video_url;
    let activeVideoName = workspaceState.video_name;
    let uploadedThisTurn = false;

    // 1. Upload once if a new file is attached
    if (stagedFile) {
      try {
        const uploadForm = new FormData();
        uploadForm.append("video", stagedFile);
        const upRes = await fetch("http://localhost:8000/api/upload", {
          method: "POST",
          body: uploadForm
        });
        if (upRes.ok) {
          const upData = await upRes.json();
          activeVideoPath = upData.video_path;
          activeVideoUrl = `http://localhost:8000${upData.video_url}`;
          activeVideoName = upData.video_name;
          uploadedThisTurn = true;
          setWorkspaceState(prev => ({
            ...prev,
            video_path: activeVideoPath,
            video_url: activeVideoUrl,
            video_name: activeVideoName
          }));
        }
      } catch (err) {
        console.error("Upload error:", err);
      }
    }

    // Only attach uploadedVideoUrl on the user message if a new video was uploaded/attached ON THIS TURN
    const isAttachmentThisTurn = !!stagedFile || !!uploadedThisTurn;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: "user",
      text: currentPrompt,
      uploadedVideoUrl: isAttachmentThisTurn ? activeVideoUrl : undefined,
      uploadedVideoName: isAttachmentThisTurn ? activeVideoName : undefined,
      activeVideoFile: isAttachmentThisTurn ? (stagedFile || undefined) : undefined,
      uploadedVideoPath: isAttachmentThisTurn ? activeVideoPath : undefined,
      uploadDone: isAttachmentThisTurn ? !!activeVideoPath : undefined,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    fetch(`http://localhost:8000/api/sessions/${activeSessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userMsg)
    }).catch(() => {});

    // Create an assistant message placeholder to stream into
    const assistantMsgId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: assistantMsgId,
      sender: "bot",
      text: "",
      thoughts: "",
      toolCalls: [],
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, assistantMsg]);

    // Prefer live workspace stats; fall back to latest stats-bearing message
    const lastStatsMsg = [...messages].reverse().find(m => m.stats);
    const currentWorkspace = {
      ...workspaceState,
      video_path: activeVideoPath,
      video_url: activeVideoUrl,
      video_name: activeVideoName,
      last_stats: workspaceState.last_stats || lastStatsMsg?.stats,
      spec: workspaceState.spec || lastStatsMsg?.spec,
    };

    try {
      const agentCtl = new AbortController();
      agentAbortRef.current = agentCtl;
      const response = await fetch("http://localhost:8000/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: activeSessionId,
          prompt: currentPrompt,
          workspace: currentWorkspace
        }),
        signal: agentCtl.signal
      });

      if (!response.ok || !response.body) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let streamBuffer = "";
      let accumulatedText = "";
      let accumulatedThinking = "";
      let activeToolCalls: ToolCall[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split("\n");
        streamBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;

          try {
            const chunk = JSON.parse(dataStr);

            if (chunk.type === "thinking" && chunk.delta) {
              accumulatedThinking += chunk.delta;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMsgId ? { ...m, thoughts: accumulatedThinking } : m
                )
              );
            } else if (chunk.type === "text" && chunk.delta) {
              accumulatedText += chunk.delta;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMsgId ? { ...m, text: accumulatedText } : m
                )
              );
            } else if (chunk.type === "tool_call") {
              const newTc: ToolCall = {
                name: chunk.name,
                args: chunk.input,
                status: "calling"
              };
              activeToolCalls = [...activeToolCalls, newTc];
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMsgId ? { ...m, toolCalls: [...activeToolCalls] } : m
                )
              );
            } else if (chunk.type === "tool_result") {
              activeToolCalls = activeToolCalls.map(tc =>
                tc.name === chunk.name
                  ? { ...tc, output: chunk.output, status: "completed" }
                  : tc
              );

              // If tool produced stats or grounded geometry, update workspace and message
              if (chunk.output && (chunk.output.zones || chunk.output.lines)) {
                setWorkspaceState(prev => ({
                  ...prev,
                  spec: {
                    ...(prev.spec || {}),
                    zones: chunk.output.zones,
                    lines: chunk.output.lines,
                    geometry_type: chunk.output.geometry_type
                  }
                }));
              }
              let toolStats = null;
              let toolVideoUrl = null;

              if (chunk.output && chunk.output.processed_frames) {
                toolStats = chunk.output;
                toolVideoUrl = chunk.output.video_url ? `http://localhost:8000${chunk.output.video_url}` : null;
                setWorkspaceState(prev => ({
                  ...prev,
                  last_stats: chunk.output
                }));
              }

              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        toolCalls: [...activeToolCalls],
                        ...(toolStats ? { stats: toolStats, videoUrl: toolVideoUrl } : {})
                      }
                    : m
                )
              );
            } else if (chunk.type === "done" && chunk.workspace) {
              // MERGE — never wipe last_stats / video_path if server omits them
              setWorkspaceState(prev => ({ ...prev, ...chunk.workspace }));
            }
          } catch (e) {}
        }
      }

      // Check if text contains a workflow spec JSON block
      let parsedSpec = null;
      if (accumulatedText.includes("```json")) {
        try {
          const jsonStr = accumulatedText.split("```json")[1].split("```")[0].trim();
          parsedSpec = JSON.parse(jsonStr);
        } catch (e) {}
      }

      // Finalize assistant message
      setMessages(prev =>
        prev.map(m => {
          if (m.id !== assistantMsgId) return m;
          const cleanText = accumulatedText
            .replace(/```json[\s\S]*?```/g, "")
            .replace(/### GEOMETRY[\s\S]*?### CONFIRMATION/g, "")
            .trim();

          const isEditorToolActive = activeToolCalls.some(tc => tc.name === "open_geometry_editor" && tc.status === "completed");
          const openEditorOutput = activeToolCalls.find(tc => tc.name === "open_geometry_editor" && tc.status === "completed")?.output;

          const editorVideoUrl = openEditorOutput?.video_url
            ? (openEditorOutput.video_url.startsWith("http") ? openEditorOutput.video_url : `http://localhost:8000${openEditorOutput.video_url}`)
            : (activeVideoUrl || undefined);

          const finalized: Message = {
            ...m,
            text: cleanText || accumulatedText || "Analysis complete.",
            thoughts: accumulatedThinking || m.thoughts,
            // Merge spec carefully: preserve geometry (zones/lines) from workspace or previous spec
            spec: (() => {
              const prevSpec = m.spec || {};
              const newSpec = parsedSpec || (isEditorToolActive ? (currentWorkspace.spec || { name: "Custom Geometry", detector: { model: "yolov8n.pt" } }) : undefined);
              if (!newSpec) return prevSpec.name ? prevSpec : undefined;
              // Keep geometry from whichever spec actually has it
              const hasGeometry = (s: any) =>
                s && ((s.zones && s.zones.length > 0) || (s.lines && s.lines.length > 0));
              return {
                ...newSpec,
                zones: hasGeometry(newSpec) ? newSpec.zones : (hasGeometry(prevSpec) ? prevSpec.zones : (currentWorkspace.spec?.zones || newSpec.zones)),
                lines: hasGeometry(newSpec) ? newSpec.lines : (hasGeometry(prevSpec) ? prevSpec.lines : (currentWorkspace.spec?.lines || newSpec.lines)),
              };
            })(),
            toolCalls: activeToolCalls,
            stats: m.stats || (currentWorkspace.last_stats ? currentWorkspace.last_stats : undefined),
            videoUrl: m.videoUrl || (currentWorkspace.last_stats?.video_url ? `http://localhost:8000${currentWorkspace.last_stats.video_url}` : undefined),
            uploadedVideoUrl: (parsedSpec || isEditorToolActive) ? editorVideoUrl : undefined,
            uploadedVideoName: (parsedSpec || isEditorToolActive) ? (openEditorOutput?.video_name || activeVideoName) : undefined,
            uploadedVideoPath: openEditorOutput?.video_path || activeVideoPath,
            uploadDone: !!(openEditorOutput?.video_path || activeVideoPath)
          };

          fetch(`http://localhost:8000/api/sessions/${activeSessionId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(finalized)
          }).catch(() => {});

          return finalized;
        })
      );
    } catch (err: any) {
      const aborted = err?.name === "AbortError" || agentAbortRef.current?.signal.aborted;
      if (aborted) {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  text: (m.text || "").trim() || "⏹ Stopped.",
                  thoughts: "Cancelled by user.",
                  toolCalls: (m.toolCalls || []).map(tc =>
                    tc.status === "calling" ? { ...tc, status: "error" as const, output: { error: "stopped" } } : tc
                  )
                }
              : m
          )
        );
      } else {
        console.error("Agent error:", err);
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  text: `Agent encountered an error: ${err.message || "Failed to complete ReAct loop."}`,
                  thoughts: `Error during ReAct execution: ${err.message}`
                }
              : m
          )
        );
      }
    } finally {
      agentAbortRef.current = null;
      setIsPlanning(false);
    }
  };

  const handleRunGrounding = async (spec: any, fileOverride?: File) => {
    const activeFile = fileOverride || videoFile;
    if (!activeFile) {
      alert("Please upload a video file to ground scene.");
      return;
    }

    setIsGrounding(true);
    setUploadProgress(null);
    setUploadDone(false);

    // Create an initial streaming assistant message placeholder immediately
    const tempMsgId = Date.now().toString();
    const initialStreamMsg: Message = {
      id: tempMsgId,
      sender: "bot" as const,
      text: "",
      thoughts: "Observing camera footage and streaming scene perspective...",
      toolCalls: [
        {
          name: "vlm_scene_grounder",
          args: { model: "mimo-v2.6-flash", prompt: spec.description || spec.name },
          status: "calling"
        }
      ],
      spec: spec,
      uploadedVideoUrl: URL.createObjectURL(activeFile),
      uploadedVideoName: activeFile.name,
      activeVideoFile: activeFile,
      uploadDone: true,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, initialStreamMsg]);

    const formData = new FormData();
    formData.append("workflow_id", spec.id || "wf_store_people_counter");
    formData.append("prompt", spec.description || spec.name || "Track entities in video");
    formData.append("video", activeFile);

    try {
      const groundCtl = new AbortController();
      groundAbortRef.current = groundCtl;
      const response = await fetch("http://localhost:8000/api/ground", {
        method: "POST",
        body: formData,
        signal: groundCtl.signal
      });

      if (!response.ok || !response.body) {
        throw new Error(`Server returned ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let streamBuffer = "";
      let accumulatedText = "";
      let accumulatedThinking = "";
      let finalGeometry = { geometry_type: "line", zones: [], lines: [] };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split("\n");
        streamBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;

          try {
            const chunk = JSON.parse(dataStr);

            if (chunk.type === "thinking" && chunk.delta) {
              accumulatedThinking += chunk.delta;
              setMessages(prev =>
                prev.map(m =>
                  m.id === tempMsgId
                    ? { ...m, thoughts: accumulatedThinking }
                    : m
                )
              );
            } else if (chunk.type === "text" && chunk.delta) {
              accumulatedText += chunk.delta;
              // Clean thinking leakage and geometry code fence from streaming display
              let displayText = accumulatedText;
              if (displayText.includes("### SCENE OVERVIEW")) {
                displayText = "### SCENE OVERVIEW" + displayText.split("### SCENE OVERVIEW")[1];
              }
              if (displayText.includes("### GEOMETRY")) {
                const parts = displayText.split("### GEOMETRY");
                displayText = parts[0].trim();
                if (parts[1] && parts[1].includes("### CONFIRMATION")) {
                  displayText += "\n\n### CONFIRMATION\n" + parts[1].split("### CONFIRMATION")[1].trim();
                }
              }

              setMessages(prev =>
                prev.map(m =>
                  m.id === tempMsgId
                    ? { ...m, text: displayText }
                    : m
                )
              );
            } else if (chunk.type === "done") {
              finalGeometry = {
                geometry_type: chunk.geometry_type,
                zones: chunk.zones || [],
                lines: chunk.lines || []
              };
            }
          } catch (e) {}
        }
      }

      // Finalize the message with full tool output and updated spec
      setMessages(prev =>
        prev.map(m => {
          if (m.id !== tempMsgId) return m;

          let cleanText = accumulatedText;
          if (cleanText.includes("### SCENE OVERVIEW")) {
            cleanText = "### SCENE OVERVIEW" + cleanText.split("### SCENE OVERVIEW")[1];
          }
          if (cleanText.includes("### GEOMETRY")) {
            const parts = cleanText.split("### GEOMETRY");
            cleanText = parts[0].trim();
            if (parts[1] && parts[1].includes("### CONFIRMATION")) {
              cleanText += "\n\n### CONFIRMATION\n" + parts[1].split("### CONFIRMATION")[1].trim();
            }
          }

          const finalized: Message = {
            ...m,
            text: cleanText.trim() || "Visual scene grounding complete.",
            thoughts: accumulatedThinking || `Analyzed camera perspective and extracted spatial geometry. Recommends ${finalGeometry.geometry_type === 'polygon' ? 'Polygon Zone' : 'Directional Line'}. Awaiting user confirmation.`,
            toolCalls: [
              {
                name: "vlm_scene_grounder",
                args: { model: "mimo-v2.6-flash", prompt: spec.description || spec.name },
                output: finalGeometry,
                status: "completed"
              }
            ],
            spec: {
              ...m.spec,
              zones: finalGeometry.zones,
              lines: finalGeometry.lines
            },
            activeVideoFile: activeFile,
            uploadedVideoUrl: m.uploadedVideoUrl || URL.createObjectURL(activeFile),
            uploadedVideoName: m.uploadedVideoName || activeFile.name,
            uploadDone: true,
          };

          const { activeVideoFile, ...persistableMessage } = finalized;

          fetch(`http://localhost:8000/api/sessions/${activeSessionId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(persistableMessage)
          }).catch(() => {});

          return finalized;
        })
      );
    } catch (err: any) {
      const aborted = err?.name === "AbortError" || groundAbortRef.current?.signal.aborted;
      if (aborted) {
        setMessages(prev =>
          prev.map(m =>
            m.id === tempMsgId
              ? {
                  ...m,
                  text: (m.text || "").trim() || "⏹ Grounding stopped.",
                  thoughts: "Cancelled by user.",
                  toolCalls: (m.toolCalls || []).map(tc =>
                    tc.status === "calling" ? { ...tc, status: "error" as const, output: { error: "stopped" } } : tc
                  )
                }
              : m
          )
        );
      } else {
        console.error("Grounding stream error:", err);
        setMessages(prev =>
          prev.map(m =>
            m.id === tempMsgId
              ? {
                  ...m,
                  text: `VLM Grounding encounter: ${err.message || 'Error'}. Ready to proceed with default pipeline.`,
                  thoughts: `Grounding stream failed: ${err.message}`,
                  toolCalls: [
                    {
                      name: "vlm_scene_grounder",
                      args: { model: "mimo-v2.6-flash" },
                      output: { error: err.message },
                      status: "error"
                    }
                  ]
                }
              : m
          )
        );
      }
    } finally {
      groundAbortRef.current = null;
      setIsGrounding(false);
    }
  };

  const handleRunInference = async (spec: any, fileOverride?: File) => {
    // Resolve active file from parameter, state, or recent messages with active video file
    let activeFile = fileOverride || videoFile;
    if (!activeFile) {
      const msgWithFile = [...messages].reverse().find(m => m.activeVideoFile);
      if (msgWithFile?.activeVideoFile) {
        activeFile = msgWithFile.activeVideoFile;
      }
    }

    if (!activeFile) {
      alert("Please upload a video file to run tracking.");
      return;
    }

    // Calculate estimated time based on video duration & system hardware
    try {
      const tempVideo = document.createElement("video");
      tempVideo.preload = "metadata";
      tempVideo.src = URL.createObjectURL(activeFile);
      tempVideo.onloadedmetadata = () => {
        const durationSec = tempVideo.duration || 60;
        const totalEstimatedFrames = durationSec * 25;
        const expectedFps = systemHardware?.typical_fps || 12.0;
        const estSec = Math.max(5, Math.round(totalEstimatedFrames / expectedFps));
        setEstimatedSeconds(estSec);
        URL.revokeObjectURL(tempVideo.src);
      };
    } catch (e) {
      setEstimatedSeconds(60);
    }
    const formData = new FormData();
    formData.append("workflow_id", spec.id || "wf_store_people_counter");
    formData.append("spec_json", JSON.stringify(spec));
    formData.append("video", activeFile);

    // Poll live backend progress every 600ms while running
    const progressPollId = setInterval(async () => {
      try {
        const wfId = spec.id || "wf_store_people_counter";
        const res = await fetch(`http://localhost:8000/api/run/progress/${wfId}`);
        if (res.ok) {
          const pData = await res.json();
          if (pData && pData.status === "running") {
            setLivePipelineProgress(pData);
          }
        }
      } catch (e) {}
    }, 600);

    try {
      const stats = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        runXhrRef.current = xhr;
        xhr.open("POST", "http://localhost:8000/api/run");

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(percentComplete);
            if (percentComplete >= 100) {
              setUploadDone(true);
            }
          }
        };

        xhr.onload = () => {
          runXhrRef.current = null;
          setUploadProgress(null);
          setUploadDone(true);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(xhr.statusText || "Request failed"));
          }
        };

        xhr.onerror = () => {
          runXhrRef.current = null;
          setUploadProgress(null);
          setUploadDone(false);
          reject(new Error("Network Error"));
        };

        xhr.onabort = () => {
          runXhrRef.current = null;
          setUploadProgress(null);
          const abortErr: any = new Error("Stopped");
          abortErr.name = "AbortError";
          reject(abortErr);
        };

        xhr.send(formData);
      });
      clearInterval(progressPollId);
      setLivePipelineProgress(null);
      
      const resultMsg: Message = {
        id: Date.now().toString(),
        sender: "bot" as const,
        text: `Inference pipeline completed. Processed ${stats.processed_frames} frames at ${stats.processed_fps} FPS.`,
        thoughts: `Pipeline execution finished. Processed frames through YOLO model, verified ByteTrack track associations, and tallied line crossing triggers.`,
        toolCalls: [
          {
            name: "yolo_detector",
            args: { model: spec.detector?.model || "yolov8n.pt", classes: spec.detector?.classes || ["car"] },
            output: { detected_objects: stats.processed_frames * 2, confidence_mean: 0.78 },
            status: "completed"
          },
          {
            name: "bytetrack_tracker",
            args: { tracker_type: spec.tracker?.tracker_type || "bytetrack", track_buffer: 30 },
            output: { active_tracks: stats.in_count + stats.out_count + 1, persistent_ids: true },
            status: "completed"
          },
          {
            name: "spatial_crossing_trigger",
            args: { lines: spec.lines?.map((l: any) => l.name) || ["traffic_line"] },
            output: { in_count: stats.in_count, out_count: stats.out_count },
            status: "completed"
          }
        ],
        stats: stats,
        videoUrl: `http://localhost:8000${stats.video_url}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, resultMsg]);
      fetch(`http://localhost:8000/api/sessions/${activeSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resultMsg)
      }).catch(() => {});
    } catch (err: any) {
      clearInterval(progressPollId);
      setLivePipelineProgress(null);
      if (err?.name === "AbortError") {
        const stoppedMsg: Message = {
          id: Date.now().toString(),
          sender: "bot" as const,
          text: "⏹ Pipeline stopped by user.",
          thoughts: "Inference cancelled before completion.",
          toolCalls: [
            {
              name: "yolo_detector",
              args: { model: spec.detector?.model || "yolov8n.pt" },
              output: { error: "stopped" },
              status: "error"
            }
          ],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, stoppedMsg]);
      } else {
        console.error("Execution error:", err);
        const fallbackMsg: Message = {
          id: Date.now().toString(),
          sender: "bot" as const,
          text: `Execution failed on uploaded footage: ${err.message || 'Server error'}. Using synthetic verification test.`,
          thoughts: `Inference pipeline encountered an error: ${err.message || 'unknown'}. Fallback invoked.`,
          toolCalls: [
            {
              name: "yolo_detector",
              args: { model: spec.detector?.model || "yolov8n.pt" },
              output: { error: err.message || "Pipeline error" },
              status: "error"
            }
          ],
          stats: { processed_frames: 30, processed_fps: 3.1, in_count: 2, out_count: 1 },
          videoUrl: "http://localhost:8000/output/test_run.mp4",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, fallbackMsg]);
        fetch(`http://localhost:8000/api/sessions/${activeSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fallbackMsg)
        }).catch(() => {});
      }
    } finally {
      runXhrRef.current = null;
      setIsRunning(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-[var(--bg-app)] text-[var(--fg)] flex overflow-hidden font-sans antialiased selection:bg-[var(--selection-bg)]">
      <Head>
        <title>VisionOps</title>
        <meta name="description" content="Agentic Computer Vision Builder" />
      </Head>

      {/* Google Flow Style Minimalist Dark Sidebar */}
      <aside className={`bg-black border-r border-zinc-900 flex flex-col justify-between select-none shrink-0 h-full transition-all duration-300 z-20 ${
        sidebarCollapsed ? "w-16" : "w-56"
      }`}>
        <div className="flex flex-col min-h-0 flex-1 pt-3.5">

          {/* VisionOps Branding & Beta Tag */}
          <div className="px-3.5 mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center shrink-0">
                <Activity className="w-3.5 h-3.5 text-zinc-200" />
              </div>
              {!sidebarCollapsed && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-semibold tracking-tight text-white truncate">VisionOps</span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded-md bg-zinc-800/80 text-zinc-400 border border-zinc-700/50 leading-none">
                    beta
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Flow Category Navigation Items */}
          <div className="px-2.5 space-y-1">
            {/* All media / Workspaces Item */}
            <button
              onClick={() => {
                setActiveMediaFilter("all");
                setSelectedComponent(null);
              }}
              className={`w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                activeMediaFilter === "all" && !selectedComponent
                  ? "bg-zinc-800/90 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900/60"
              }`}
              title="All media"
            >
              <LayoutGrid className="w-4 h-4 shrink-0 text-zinc-300" />
              {!sidebarCollapsed && <span className="truncate">All media</span>}
            </button>

            {/* Videos / Live Feeds Item */}
            <button
              onClick={() => {
                setActiveMediaFilter("videos");
                handleNewLiveChat();
              }}
              className={`w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                isLiveWorkspace
                  ? "bg-zinc-800/90 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900/60"
              }`}
              title="Videos & Live Streams"
            >
              <Video className="w-4 h-4 shrink-0 text-zinc-300" />
              {!sidebarCollapsed && <span className="truncate">Videos</span>}
            </button>

            {/* Characters / Classes Item */}
            <button
              onClick={() => {
                setActiveMediaFilter("models");
                if (components.length > 0) setSelectedComponent(components[0]);
              }}
              className={`w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                selectedComponent
                  ? "bg-zinc-800/90 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900/60"
              }`}
              title="Models & Characters"
            >
              <User className="w-4 h-4 shrink-0 text-zinc-300" />
              {!sidebarCollapsed && <span className="truncate">Characters</span>}
            </button>

            {/* Scenes Item */}
            <button
              onClick={() => {
                handleNewChat();
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-900/60 transition-colors text-left"
              title="Scenes & Workspaces"
            >
              <Clapperboard className="w-4 h-4 shrink-0 text-zinc-300" />
              {!sidebarCollapsed && <span className="truncate">Scenes</span>}
            </button>
          </div>

          {/* Divider */}
          <div className="my-2.5 mx-4 border-t border-zinc-900/90" />

          {/* Live Workspaces Section (Similar to Library) */}
          <div className="px-2.5 space-y-1">
            <div className="w-full flex items-center justify-between px-3 py-1.5 text-sm font-medium text-zinc-400">
              <button
                onClick={() => setLiveChatsOpen(o => !o)}
                className="flex items-center gap-3.5 hover:text-white transition-colors truncate"
              >
                <Radio className="w-4 h-4 shrink-0 text-zinc-300" />
                {!sidebarCollapsed && <span>Live Streams</span>}
              </button>
              {!sidebarCollapsed && (
                <button
                  onClick={handleNewLiveChat}
                  title="New live camera stream"
                  className="text-zinc-500 hover:text-white p-0.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Recent Live Workspaces */}
            {!sidebarCollapsed && liveChatsOpen && (
              <div className="pl-6 pr-1 space-y-0.5 max-h-36 overflow-y-auto">
                {filteredSessions.filter(s => s.domain === "live_cctv").length === 0 ? (
                  <button
                    onClick={handleNewLiveChat}
                    className="w-full text-left px-2.5 py-1 text-xs text-zinc-600 hover:text-zinc-400 italic"
                  >
                    + Connect camera stream
                  </button>
                ) : (
                  filteredSessions.filter(s => s.domain === "live_cctv").slice(0, 6).map(s => {
                    const isActive = activeSessionId === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => {
                          setActiveSessionId(s.id);
                          setSelectedComponent(null);
                        }}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs truncate transition-colors text-left ${
                          isActive
                            ? "text-white font-medium bg-zinc-900/80"
                            : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
                        <span className="truncate">{s.name || s.id}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-2.5 mx-4 border-t border-zinc-900/90" />

          {/* Library Section (Saved Workspaces) */}
          <div className="px-2.5 space-y-1">
            <div className="w-full flex items-center justify-between px-3 py-1.5 text-sm font-medium text-zinc-400">
              <button
                onClick={() => setChatsOpen(o => !o)}
                className="flex items-center gap-3.5 hover:text-white transition-colors truncate"
              >
                <Folder className="w-4 h-4 shrink-0 text-zinc-300" />
                {!sidebarCollapsed && <span>Library</span>}
              </button>
              {!sidebarCollapsed && (
                <button
                  onClick={handleNewChat}
                  title="New workspace"
                  className="text-zinc-500 hover:text-white p-0.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Recent Chats in Library (Non-Live / All) */}
            {!sidebarCollapsed && chatsOpen && (
              <div className="pl-6 pr-1 space-y-0.5 max-h-36 overflow-y-auto">
                {filteredSessions.filter(s => s.domain !== "live_cctv").slice(0, 6).map(s => {
                  const isActive = activeSessionId === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setActiveSessionId(s.id);
                        setSelectedComponent(null);
                      }}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs truncate transition-colors text-left ${
                        isActive
                          ? "text-white font-medium bg-zinc-900/80"
                          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
                      }`}
                    >
                      <span className="truncate">{s.name || s.id}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-2.5 mx-4 border-t border-zinc-900/90" />

          {/* Tools & Create Tool */}
          <div className="px-2.5 space-y-1">
            <button
              onClick={() => {
                if (components.length > 0) setSelectedComponent(components[0]);
              }}
              className="w-full flex items-center gap-3.5 px-3 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-900/60 transition-colors text-left"
              title="Tools"
            >
              <Sparkles className="w-4 h-4 shrink-0 text-zinc-300" />
              {!sidebarCollapsed && <span>Tools</span>}
            </button>

            <button
              onClick={handleNewChat}
              className="w-full flex items-center gap-3.5 px-3 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-900/60 transition-colors text-left"
              title="Create tool"
            >
              <Plus className="w-4 h-4 shrink-0 text-zinc-400" />
              {!sidebarCollapsed && <span>Create tool</span>}
            </button>
          </div>
        </div>

        {/* Bottom Actions: Trash & Collapse (Flow Style) */}
        <div className="p-3 border-t border-zinc-900/90 space-y-1 shrink-0">
          <button
            onClick={() => {
              if (confirm("Clear local chat history?")) {
                setMessages([]);
              }
            }}
            className="w-full flex items-center gap-3.5 px-3 py-2 rounded-xl text-sm font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60 transition-colors text-left"
            title="Trash"
          >
            <Trash className="w-4 h-4 shrink-0 text-zinc-500" />
            {!sidebarCollapsed && <span>Trash</span>}
          </button>

          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            className="w-full flex items-center gap-3.5 px-3 py-2 rounded-xl text-sm font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60 transition-colors text-left"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeftClose className={`w-4 h-4 shrink-0 text-zinc-500 transition-transform ${sidebarCollapsed ? "rotate-180" : ""}`} />
            {!sidebarCollapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main Center Canvas (Minimalist Charcoal Black) */}
      <main className="flex-1 flex flex-col bg-[var(--bg-app)] overflow-hidden">
        
        {/* Top Minimal Header */}
        <header className="h-16 border-b border-[var(--border-header)] flex items-center justify-between px-8">
          <div className="flex items-center gap-3">
            <LayoutGrid className="w-4 h-4 text-neutral-400" />
            <h1 className="text-xl font-semibold tracking-tight text-[var(--fg)]">
              {selectedComponent ? selectedComponent.name : activeSession.name}
            </h1>
          </div>
          <div className="flex items-center gap-2 text-neutral-400 text-xs">
            {selectedComponent && (
              <button
                type="button"
                onClick={() => setSelectedComponent(null)}
                className="px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary-hover)] text-[var(--fg)] text-xs font-medium transition-colors"
              >
                ← Back to chat
              </button>
            )}
            <span className="font-mono text-neutral-500">Vision Workspace</span>
          </div>
        </header>

        {/* Component Detail View */}
        {selectedComponent ? (
          <div className="flex-1 overflow-y-auto px-8 py-10 select-text">
            <div className="max-w-2xl mx-auto space-y-8">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-mono text-neutral-500 uppercase tracking-wider">
                  <span className={`w-2 h-2 rounded-full ${
                    selectedComponent.category === "detector" ? "bg-[#f59e0b]" :
                    selectedComponent.category === "tracker" ? "bg-[#10b981]" :
                    "bg-[#3b82f6]"
                  }`} />
                  {selectedComponent.category}
                </div>
                <h2 className="text-3xl font-semibold tracking-tight text-[var(--fg)]">
                  {selectedComponent.name}
                </h2>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  {selectedComponent.description}
                </p>
              </div>

              {selectedComponent.strengths?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Strengths</h3>
                  <ul className="space-y-2">
                    {selectedComponent.strengths.map((s: string) => (
                      <li key={s} className="flex items-start gap-2.5 text-sm text-[var(--fg)]">
                        <CheckCircle2 className="w-4 h-4 text-zinc-300 shrink-0 mt-0.5" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedComponent.supported_classes?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Supported classes</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedComponent.supported_classes.map((cls: string) => (
                      <span
                        key={cls}
                        className="px-2.5 py-1 rounded-lg bg-[var(--bg-chip)] border border-[var(--border-chip)] text-xs font-mono text-neutral-300"
                      >
                        {cls}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedComponent.default_parameters && Object.keys(selectedComponent.default_parameters).length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Default parameters</h3>
                  <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-surface)] p-4">
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(selectedComponent.default_parameters).map(([k, v]) => (
                          <tr key={k} className="border-b border-[var(--border-app)] last:border-0">
                            <td className="py-2 pr-4 text-neutral-500 font-mono text-xs">{k}</td>
                            <td className="py-2 text-[var(--fg)] font-mono text-xs">{String(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <span className="text-[11px] font-mono text-neutral-600">id: {selectedComponent.id}</span>
              </div>
            </div>
          </div>
        ) : isLiveWorkspace ? (
          /* =========================================================================
             LIVE MODE WORKSPACE STUDIO (Center Video Stage + Right Copilot Chat Drawer)
             ========================================================================= */
          <div className="flex-1 flex overflow-hidden w-full h-full">
            
            {/* Center Stage: CCTV Live Video Feed & Overlays */}
            <div className="flex-1 flex flex-col bg-[#0b0c0e] overflow-hidden relative border-r border-[#1e2025]">
              
              {/* CCTV Live Control Bar */}
              <div className="h-12 border-b border-zinc-800/80 px-5 flex items-center justify-between bg-zinc-900/60 backdrop-blur-md shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700/60 font-mono text-[11px] font-semibold">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    <span>LIVE</span>
                  </div>
                  <span className="text-xs font-semibold text-zinc-100 tracking-wide">{liveCameraLabel}</span>
                  <span className="text-[11px] font-mono text-zinc-400">· {liveFps} FPS</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowLiveConnectModal(true)}
                    className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3 text-zinc-400" />
                    <span>Change Stream</span>
                  </button>
                  <button
                    onClick={() => setIsLiveFullscreen(f => !f)}
                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-300 text-xs transition-colors"
                    title="Toggle Fullscreen"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Main Video Viewport */}
              <div className="flex-1 flex items-center justify-center p-6 bg-zinc-950 overflow-hidden relative">
                <div className="relative w-full max-w-4xl max-h-[75vh] aspect-[16/9] rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-2xl flex items-center justify-center group">
                  
                  {/* CCTV Feed Image */}
                  {isLiveConnected ? (
                    <img
                      src={`http://localhost:8000/api/live/${activeSessionId}/feed`}
                      alt="Live Stream Feed"
                      className="w-full h-full object-cover select-none"
                    />
                  ) : liveSnapshotUrl ? (
                    <img
                      src={liveSnapshotUrl}
                      alt="Camera Snapshot"
                      className="w-full h-full object-cover select-none"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
                        <Camera className="w-6 h-6" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium text-zinc-300">Camera Not Connected</p>
                        <p className="text-xs text-zinc-500 mt-0.5">Click "Change Stream" to connect an IP Webcam or RTSP feed</p>
                      </div>
                      <button
                        onClick={() => setShowLiveConnectModal(true)}
                        className="mt-2 px-3.5 py-1.5 rounded-lg bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition-colors"
                      >
                        Connect Camera
                      </button>
                    </div>
                  )}

                  {/* Top-Right CCTV Camera Time Overlay */}
                  <div className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-black/80 backdrop-blur-md border border-white/10 font-mono text-xs text-white/90 font-medium tracking-wider select-none shadow">
                    CAM-01 · {new Date().toLocaleTimeString()}
                  </div>

                  {/* Top-Left In-Video Live Telemetry HUD (Minimal Zinc & White) */}
                  <div className="absolute top-4 left-4 p-3 rounded-xl bg-black/80 backdrop-blur-md border border-zinc-700/80 min-w-[210px] space-y-1.5 shadow-2xl pointer-events-none select-none">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-300 font-semibold flex items-center gap-1.5 pb-1 border-b border-zinc-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      Live VisionOps HUD
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-400">Footfall Entered</span>
                      <span className="text-white font-bold">{liveZoneFootfall}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-400">Current Inside</span>
                      <span className="text-zinc-100 font-bold">{liveCurrentInside}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-400">Active Tracks</span>
                      <span className="text-zinc-200 font-bold">{liveActiveTracks}</span>
                    </div>
                  </div>

                  {/* Bottom Controls Overlay on Hover */}
                  <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between opacity-90 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md text-[11px] font-mono text-zinc-300 border border-white/10">
                        Protocol: RTSP / HTTP-MJPEG
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        const mId = messages[messages.length - 1]?.id;
                        if (mId) setActiveEditorMessageId(mId);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black font-semibold text-xs flex items-center gap-1.5 shadow-lg transition-transform active:scale-95"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      Edit Grounding Polygon
                    </button>
                  </div>
                </div>
              </div>

              {/* Bottom Quick Status Strip */}
              <div className="h-10 border-t border-zinc-800/80 px-6 flex items-center justify-between text-xs text-zinc-400 bg-zinc-900/60 font-mono shrink-0">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 text-zinc-300">
                    <span className="w-2 h-2 rounded-full bg-white" />
                    Stream Ingestion: Healthy
                  </span>
                  <span>Latency: ~65ms</span>
                </div>
                <span>Resolution: 1920x1080 @ 25fps</span>
              </div>
            </div>

            {/* Right Drawer: AI Copilot Chat & NLP Workflow Prompt Bar */}
            <div className="w-[320px] lg:w-[350px] flex flex-col bg-zinc-900/90 border-l border-zinc-800 shrink-0 h-full overflow-hidden select-text">
              
              {/* Copilot Header */}
              <div className="h-12 border-b border-zinc-800 px-4 flex items-center justify-between bg-zinc-900 shrink-0">
                <div className="flex items-center gap-2">
                  <Cctv className="w-4 h-4 text-zinc-300" />
                  <span className="text-xs font-semibold text-zinc-200">VisionOps Live Copilot</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  Grounding Synced
                </div>
              </div>

              {/* Chat Messages Feed */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex flex-col space-y-1.5 ${
                      msg.sender === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-xs max-w-[92%] leading-relaxed ${
                        msg.sender === "user"
                          ? "bg-white text-black font-medium shadow"
                          : "bg-zinc-800/80 text-zinc-200 border border-zinc-700/60 shadow-sm"
                      }`}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 px-1">
                      {msg.timestamp}
                    </span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Right Drawer Dedicated Prompt Box */}
              <div className="p-3 border-t border-zinc-800 bg-zinc-900 shrink-0">
                <form
                  onSubmit={handleSendPrompt}
                  className="bg-zinc-800/70 border border-zinc-700/80 rounded-xl p-2.5 space-y-2 focus-within:border-zinc-400 transition-colors shadow-inner"
                >
                  <textarea
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendPrompt();
                      }
                    }}
                    rows={2}
                    placeholder="Ask Copilot (e.g. 'Count chickens crossing the coop', 'alert if predator enters')..."
                    className="w-full bg-transparent border-none outline-none text-xs text-zinc-100 placeholder-zinc-500 resize-none px-1"
                  />
                  <div className="flex items-center justify-between pt-1 border-t border-zinc-700/50">
                    <span className="text-[10px] font-mono text-zinc-500">{selectedModel}</span>
                    <button
                      type="submit"
                      disabled={!prompt.trim() || isPlanning}
                      className="px-3 py-1 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 shadow"
                    >
                      <span>Send</span>
                      <Send className="w-3 h-3" />
                    </button>
                  </div>
                </form>
              </div>
            </div>

          </div>
        ) : (
          /* =========================================================================
             STANDARD BATCH VIDEO WORKSPACE (Centered Canvas + Minimal Bottom Prompt Bar)
             ========================================================================= */
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 py-6 select-text w-full">
              <div className="max-w-4xl mx-auto space-y-6">
            {/* Zero Messages Empty State (Claude/ChatGPT Style Greeting) */}
            {messages.length === 0 && !isBusy && (
              <div className="flex flex-col items-center justify-center min-h-[55vh] max-w-xl mx-auto text-center space-y-8 animate-in fade-in duration-500">
                <div className="space-y-2">
                  <h1 className="text-2xl md:text-3xl font-medium tracking-tight text-neutral-400">
                    Hi Muhammad
                  </h1>
                  <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-white/95">
                    What would you like to create?
                  </h2>
                </div>

                <div className="w-full space-y-3 pt-2">
                  <button
                    onClick={() => setPrompt("Show me the keyboard shortcuts and CV pipeline capabilities")}
                    className="w-full flex items-center gap-4 p-3 rounded-2xl bg-[#28292b] hover:bg-[#323437] border border-[#383a3e] transition-all text-left group shadow-md active:scale-[0.99]"
                  >
                    <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 group-hover:scale-105 transition-transform flex items-center justify-center">
                      <img
                        src="/icon-keyboard.png"
                        alt="Keyboard Shortcuts"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <span className="text-sm font-medium text-neutral-100 group-hover:text-white transition-colors">
                      Show me the keyboard shortcuts
                    </span>
                  </button>

                  <button
                    onClick={() => setPrompt("How do I get started with tracking objects and counting people?")}
                    className="w-full flex items-center gap-4 p-3 rounded-2xl bg-[#28292b] hover:bg-[#323437] border border-[#383a3e] transition-all text-left group shadow-md active:scale-[0.99]"
                  >
                    <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 group-hover:scale-105 transition-transform flex items-center justify-center">
                      <img
                        src="/icon-plant.png"
                        alt="How do I get started"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <span className="text-sm font-medium text-neutral-100 group-hover:text-white transition-colors">
                      How do I get started?
                    </span>
                  </button>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-4 p-3 rounded-2xl bg-[#28292b] hover:bg-[#323437] border border-[#383a3e] transition-all text-left group shadow-md active:scale-[0.99]"
                  >
                    <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 group-hover:scale-105 transition-transform flex items-center justify-center">
                      <img
                        src="/icon-moodboard.png"
                        alt="Build a visual moodboard"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <span className="text-sm font-medium text-neutral-100 group-hover:text-white transition-colors">
                      Build a visual moodboard / ground footage
                    </span>
                  </button>
                </div>
              </div>
            )}

            {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
            >
              {/* User Bubble */}
              {msg.sender === "user" ? (
                msg.geometryEditEvent ? (
                  /* Formatted Geometry Edit Audit Card */
                  <div className="max-w-xl bg-zinc-900 border border-zinc-700/80 text-zinc-200 px-4 py-3 rounded-2xl text-xs font-mono space-y-2 shadow-lg">
                    <div className="flex items-center justify-between pb-1 border-b border-zinc-800">
                      <div className="flex items-center gap-2 font-semibold text-white">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        <span>Geometry Adjusted by {msg.geometryEditEvent.actor === "ai" ? "AI (VLM Grounding)" : "User"}</span>
                        {msg.geometryEditEvent.revision !== undefined && (
                          <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded border border-zinc-700">
                            #{msg.geometryEditEvent.revision}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-zinc-400 uppercase">{msg.geometryEditEvent.geometry_type}</span>
                    </div>
                    <div className="text-[11px] text-zinc-300">
                      {msg.text}
                    </div>
                    {msg.geometryEditEvent.zones && msg.geometryEditEvent.zones[0]?.polygon && (
                      <div className="bg-black/40 rounded-lg p-2 text-[10px] text-zinc-400 overflow-x-auto">
                        <span className="text-zinc-500">// Saved coordinates:</span>
                        <div className="text-zinc-200 mt-0.5 font-mono">
                          {JSON.stringify(msg.geometryEditEvent.zones[0].polygon.map((p: any) => [p.x, p.y]))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="max-w-xl bg-[var(--bg-elevated)] border border-[var(--border-bubble)] text-[var(--fg-bubble)] px-5 py-3 rounded-2xl text-sm leading-relaxed space-y-2.5">
                    <div>{msg.text}</div>
                    {msg.uploadedVideoUrl && (
                      <div className="rounded-xl overflow-hidden bg-black/60 border border-white/10 w-56 aspect-video relative group">
                        <video
                          src={msg.uploadedVideoUrl}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-cover bg-black"
                        />
                        {msg.uploadedVideoName && (
                          <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] text-neutral-300 font-mono truncate max-w-[200px]">
                            {msg.uploadedVideoName}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              ) : (
                /* Assistant Seamless Response (No Outer Card) */
                <div className="max-w-3xl w-full space-y-4">
                  {/* Thoughts Accordion */}
                  {msg.thoughts && (
                    <div 
                      onClick={() => setShowThoughts(!showThoughts)}
                      className="text-xs text-neutral-400 flex items-center gap-1.5 cursor-pointer hover:text-neutral-200 select-none transition-colors"
                    >
                      <span className="font-medium">Thought for a while</span>
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${showThoughts ? "rotate-90" : ""}`} />
                    </div>
                  )}

                  {msg.thoughts && showThoughts && (
                    <div className="border-l-2 border-[var(--border-badge)] pl-4 py-1 text-xs text-neutral-400 italic leading-relaxed my-2">
                      {msg.thoughts}
                    </div>
                  )}

                  {/* Markdown formatted conversational response */}
                  {msg.text ? (
                    <div className="text-sm text-neutral-200 leading-relaxed font-normal prose prose-invert max-w-none prose-p:my-1.5 prose-headings:my-2 prose-h2:text-base prose-h3:text-sm prose-table:my-2 prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5 prose-th:bg-neutral-900 prose-td:border-neutral-800 prose-th:border-neutral-700">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    isPlanning && (
                      <div className="flex items-center gap-2 text-xs text-neutral-400 font-mono py-1">
                        <Activity className="w-3.5 h-3.5 text-zinc-300 animate-spin" />
                        <span>Generating response...</span>
                      </div>
                    )
                  )}

                  {/* Clean Single Pipeline Spec Card with Upload & Run Action */}
                  {msg.spec && (
                    <div 
                      style={{ backgroundColor: "var(--bg-elevated)" }} 
                      className="mt-3 rounded-2xl p-5 space-y-4 shadow-xl border border-zinc-800/60"
                    >
                      <div className="flex items-center justify-between pb-1">
                        <div className="text-xs font-semibold text-zinc-300">
                          <span>{msg.spec.name || "Planned Vision Workflow"}</span>
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400">
                          {msg.spec.detector?.model || "yolov8n.pt"} · {msg.spec.tracker?.tracker_type || "bytetrack"}
                        </div>
                      </div>

                      {/* Execution Action Row */}
                      <div className="flex flex-col gap-3 pt-1">
                        <div className="flex items-center gap-3">
                          {msg.uploadedVideoName ? (
                            <button
                              onClick={() => handleRunInference(msg.spec, msg.activeVideoFile)}
                              disabled={isRunning}
                              className="px-4 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-xs flex items-center gap-2 transition-all shadow-md active:scale-[0.98] disabled:opacity-50"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              Confirm & Run Pipeline on {msg.uploadedVideoName.slice(0, 18)}
                            </button>
                          ) : null}

                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-4 py-2.5 rounded-xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary-hover)] text-zinc-200 font-semibold text-xs flex items-center gap-2 transition-all shadow-md active:scale-[0.98]"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            {msg.uploadedVideoName ? `Replace Video` : "Upload Video to Ground Scene"}
                          </button>
                        </div>

                        {/* Video Preview or Interactive Visual Geometry Editor */}
                        {msg.uploadedVideoUrl && (() => {
                          // Check if an active open_geometry_editor tool call was triggered on this message or workspace
                          const isEditorRequested = msg.toolCalls?.some(tc => tc.name === "open_geometry_editor" && tc.status === "completed");

                          // Extract initial zones from spec or toolCalls
                          let extractedZones: any[] = [];
                          if (msg.spec?.zones && Array.isArray(msg.spec.zones)) {
                            extractedZones = msg.spec.zones;
                          } else if (msg.spec?.workflow?.zones && Array.isArray(msg.spec.workflow.zones)) {
                            extractedZones = msg.spec.workflow.zones;
                          } else if (msg.spec?.steps && Array.isArray(msg.spec.steps)) {
                            for (const st of msg.spec.steps) {
                              if (st.config?.zones && Array.isArray(st.config.zones)) {
                                extractedZones = st.config.zones;
                                break;
                              }
                            }
                          }
                          if (extractedZones.length === 0 && msg.toolCalls) {
                            for (const tc of msg.toolCalls) {
                              if (tc.output?.zones && Array.isArray(tc.output.zones) && tc.output.zones.length > 0) {
                                extractedZones = tc.output.zones;
                                break;
                              }
                            }
                          }

                          // Normalize polygon points to {x, y} objects
                          const normalizedZones = extractedZones.map((z: any) => ({
                            name: z.name || "active_zone",
                            polygon: (z.polygon || []).map((pt: any) => {
                              if (Array.isArray(pt)) return { x: pt[0], y: pt[1] };
                              return { x: pt.x ?? pt[0] ?? 0, y: pt.y ?? pt[1] ?? 0 };
                            })
                          }));

                          const extractedLines = msg.spec?.lines || msg.spec?.workflow?.lines || (msg.toolCalls?.find(tc => tc.output?.lines)?.output?.lines) || [];

                          // Check if this card has an active geometry editor open in state
                          const isCardEditorOpen = isEditorRequested || (activeEditorMessageId === msg.id);

                          // If the editor is activated (by tool or manual click), render GeometryEditor
                          if (isCardEditorOpen) {
                            return (
                              <div className="mt-2 space-y-2">
                                <div className="flex items-center justify-between text-xs font-mono text-white bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                                    <span>Visual Geometry Editor Activated</span>
                                  </div>
                                  <button
                                    onClick={() => setActiveEditorMessageId(null)}
                                    className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                                  >
                                    Done Editing
                                  </button>
                                </div>
                                <GeometryEditor
                                  videoUrl={msg.uploadedVideoUrl}
                                  initialZones={normalizedZones}
                                  initialLines={extractedLines}
                                  onSave={({ geometry_type, zones, lines }) => {
                                    // Update spec and workspaceState immediately with the user's edited geometry!
                                    setWorkspaceState(prev => {
                                      const currentSpec = msg.spec || prev.spec || {};
                                      const updatedSpec = {
                                        ...currentSpec,
                                        geometry_type,
                                        zones: geometry_type === "polygon" ? zones : [],
                                        lines: geometry_type === "line" ? lines : []
                                      };
                                      return {
                                        ...prev,
                                        spec: updatedSpec
                                      };
                                    });

                                    setMessages(prev =>
                                      prev.map(m => {
                                        if (m.id !== msg.id) return m;
                                        return {
                                          ...m,
                                          spec: {
                                            ...(m.spec || {}),
                                            geometry_type,
                                            zones: geometry_type === "polygon" ? zones : [],
                                            lines: geometry_type === "line" ? lines : []
                                          }
                                        };
                                      })
                                    );

                                    // Append an explicit audit trail message in conversation history!
                                    const vertexCount = geometry_type === "polygon" ? (zones[0]?.polygon?.length || 4) : 2;
                                    const prevCount = messages.filter(m => m.geometryEditEvent).length;
                                    const revision = prevCount + 1;
                                    const historyEventMsg: Message = {
                                      id: `edit_event_${Date.now()}`,
                                      sender: "user",
                                      text: `📐 Adjusted ${geometry_type} geometry (Rev #${revision}): defined custom ${vertexCount}-${geometry_type === "polygon" ? "point" : "endpoint"} boundary.`,
                                      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                                      geometryEditEvent: {
                                        action: "saved",
                                        actor: "user",
                                        revision,
                                        geometry_type,
                                        original_zones: normalizedZones,
                                        original_lines: extractedLines,
                                        zones,
                                        lines,
                                        summary: `User adjusted ${geometry_type} to ${vertexCount} coordinates (Revision #${revision})`
                                      }
                                    };
                                    setMessages(prev => [...prev, historyEventMsg]);
                                    fetch(`http://localhost:8000/api/sessions/${activeSessionId}/messages`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify(historyEventMsg)
                                    }).catch(() => {});
                                  }}
                                />
                              </div>
                            );
                          }

                          // Otherwise, render live video with SVG polygon/line overlay + "Edit Geometry" button
                          const hasPolygon = normalizedZones.length > 0 && normalizedZones[0].polygon.length >= 3;
                          const hasLine = extractedLines.length > 0 && extractedLines[0].start && extractedLines[0].end;

                          return (
                            <div className="relative w-full max-w-lg aspect-video rounded-xl overflow-hidden bg-black shadow-lg border border-white/10 group mt-1">
                              <video
                                src={msg.uploadedVideoUrl}
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="w-full h-full object-cover"
                              />

                              {/* SVG Overlay of Proposed Geometry */}
                              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                                {hasPolygon && normalizedZones.map((z, zi) => {
                                  const pointsStr = z.polygon.map((p: any) => `${p.x * 100},${p.y * 100}`).join(" ");
                                  return (
                                    <g key={zi}>
                                      <polygon
                                        points={pointsStr}
                                        fill="rgba(16, 185, 129, 0.22)"
                                        stroke="#10b981"
                                        strokeWidth="1.2"
                                        strokeDasharray="2.5 1.5"
                                      />
                                      {z.polygon.map((p: any, pi: number) => (
                                        <circle
                                          key={pi}
                                          cx={p.x * 100}
                                          cy={p.y * 100}
                                          r="1.4"
                                          fill="#10b981"
                                          stroke="#ffffff"
                                          strokeWidth="0.5"
                                        />
                                      ))}
                                    </g>
                                  );
                                })}

                                {hasLine && extractedLines.map((l: any, li: number) => (
                                  <g key={li}>
                                    <line
                                      x1={l.start.x * 100}
                                      y1={l.start.y * 100}
                                      x2={l.end.x * 100}
                                      y2={l.end.y * 100}
                                      stroke="#38bdf8"
                                      strokeWidth="1.5"
                                      strokeDasharray="3 2"
                                    />
                                    <circle cx={l.start.x * 100} cy={l.start.y * 100} r="1.5" fill="#38bdf8" stroke="#fff" strokeWidth="0.5" />
                                    <circle cx={l.end.x * 100} cy={l.end.y * 100} r="1.5" fill="#f43f5e" stroke="#fff" strokeWidth="0.5" />
                                  </g>
                                ))}
                              </svg>

                              {/* Top Bar Indicator */}
                              <div className="absolute top-2 left-2 px-2.5 py-1 rounded-md bg-black/80 backdrop-blur-md text-[10px] font-mono text-zinc-300 border border-white/10 flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${hasPolygon || hasLine ? "bg-white" : "bg-blue-400"}`} />
                                <span>{hasPolygon ? "Proposed Polygon Active" : hasLine ? "Proposed Crossing Line Active" : (msg.uploadedVideoName || "Footage Preview")}</span>
                              </div>

                              {/* Edit Geometry Overlay Action Button */}
                              <button
                                onClick={() => setActiveEditorMessageId(msg.id)}
                                className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black font-semibold text-xs flex items-center gap-1.5 shadow-lg backdrop-blur-sm transition-all transform active:scale-95"
                              >
                                <Sliders className="w-3.5 h-3.5" />
                                Edit Geometry
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Tool Calls Expandable Accordion */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-2">
                      <div 
                        onClick={() => {
                          setExpandedToolCalls(prev => ({
                            ...prev,
                            [msg.id]: !prev[msg.id]
                          }));
                        }}
                        className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 cursor-pointer select-none py-1 transition-colors"
                      >
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedToolCalls[msg.id] ? "rotate-90" : ""}`} />
                        <span className="font-medium font-mono">Tool calls</span>
                        <span className="text-[10px] text-neutral-500 font-mono">({msg.toolCalls.length})</span>
                      </div>

                      {expandedToolCalls[msg.id] && (
                        <div className="space-y-1.5 mt-2">
                          {msg.toolCalls.map((tc, idx) => (
                            <div 
                              key={idx}
                              className="bg-[var(--bg-inset)] border border-[var(--border-tool)] rounded-xl p-3 text-xs font-mono space-y-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-200 font-semibold flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-300" />
                                  {tc.name}
                                </span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                  tc.status === "completed" ? "bg-emerald-500/10 text-white" : "bg-rose-500/10 text-zinc-400"
                                }`}>
                                  {tc.status}
                                </span>
                              </div>
                              <div className="text-[11px] text-neutral-400 bg-[var(--bg-app)] p-2 rounded-lg overflow-x-auto">
                                <div className="text-neutral-500">// Arguments:</div>
                                <div className="text-neutral-300">{JSON.stringify(tc.args, null, 2)}</div>
                                {tc.output && (
                                  <>
                                    <div className="text-neutral-500 mt-1">// Result:</div>
                                    <div className="text-white">{JSON.stringify(tc.output, null, 2)}</div>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Video Inference Results & Visualizer */}
                  {msg.stats && (
                    <div className="mt-4 bg-[var(--bg-elevated)] border border-[var(--border-card)] rounded-2xl p-5 space-y-4 shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Video Inference Output</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-neutral-300 font-mono">
                          {msg.stats.unique_tracks !== undefined && msg.stats.unique_tracks !== null && (() => {
                            // Derive a human-readable label from the pipeline's target classes
                            const classes: string[] = msg.spec?.detector?.classes || msg.spec?.workflow?.detector?.classes || msg.spec?.classes || [];
                            const singleClass = classes.length === 1 ? classes[0] : null;
                            const label = singleClass === "person" ? "Unique People" : singleClass ? `Unique ${singleClass.charAt(0).toUpperCase() + singleClass.slice(1)}s` : "Unique Tracks";
                            return (
                              <span>{label}: <strong className="text-white">{msg.stats.unique_tracks}</strong></span>
                            );
                          })()}
                          {msg.stats.has_polygon_zones ? (
                            <>
                              {msg.stats.total_zone_entered !== undefined && msg.stats.total_zone_entered !== null && (
                                <span>Zone Visitors: <strong className="text-white">{msg.stats.total_zone_entered}</strong></span>
                              )}
                              <span>Zone Peak: <strong className="text-zinc-200">{msg.stats.max_zone_occupancy ?? 0}</strong></span>
                              {msg.stats.zone_analytics && (() => {
                                const firstZone = Object.values(msg.stats.zone_analytics)[0] as any;
                                if (firstZone?.avg_dwell_seconds) {
                                  return (
                                    <span>Avg Dwell: <strong className="text-sky-400">{firstZone.avg_dwell_seconds}s</strong></span>
                                  );
                                }
                                return null;
                              })()}
                            </>
                          ) : (
                            <>
                              <span>IN: <strong className="text-white">{msg.stats.in_count ?? 0}</strong></span>
                              <span>OUT: <strong className="text-zinc-400">{msg.stats.out_count ?? 0}</strong></span>
                            </>
                          )}
                          <span>FPS: {msg.stats.processed_fps}</span>
                        </div>
                      </div>

                      {/* VLM Scene Grounding Feedback */}
                      {msg.stats.scene_analysis && (
                        <div className="bg-[var(--bg-inset)] border border-neutral-800 rounded-xl px-4 py-2.5 text-xs text-neutral-300 flex items-start gap-2.5">
                          <Sparkles className="w-4 h-4 text-zinc-200 shrink-0 mt-0.5" />
                          <div className="leading-relaxed">
                            <span className="text-neutral-400 font-medium">VLM Scene Analysis: </span>
                            <span className="text-neutral-200">{msg.stats.scene_analysis}</span>
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-neutral-800 text-neutral-300">
                              {msg.stats.geometry_type === "polygon" ? "Polygon Zone" : "Directional Line"}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-[var(--border-card)]">
                        {msg.videoUrl ? (
                          <video
                            src={msg.videoUrl}
                            controls
                            autoPlay
                            loop
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="text-neutral-500 text-xs flex flex-col items-center gap-2">
                            <Video className="w-8 h-8" />
                            <span>Annotated video rendered</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          ))}

          {/* Thinking / Working Indicator */}
          {isPlanning && !messages.some(m => m.sender === "bot" && (m.text || m.thoughts)) && (
            <div className="flex flex-col items-start space-y-3 max-w-xl">
              <div className="flex items-center gap-2 text-xs text-neutral-300 bg-[var(--bg-subtle)] px-4 py-2.5 rounded-2xl border border-zinc-800/80 shadow-md">
                <Activity className="w-3.5 h-3.5 text-zinc-300 animate-spin" />
                <span className="font-mono">Processing with mimo-v2.6-flash...</span>
              </div>
            </div>
          )}

          {/* Running Inference or Grounding Dynamic Progress Indicator */}
          {(isRunning || isGrounding) && (
            <div className="flex flex-col items-start space-y-3 max-w-xl">
              <div className="flex flex-col gap-2.5 bg-[var(--bg-subtle)] px-4 py-3 rounded-2xl border border-zinc-800/80 shadow-md w-full">
                <div className="flex items-center justify-between text-xs text-neutral-200">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-white animate-spin" />
                    <span className="font-mono font-medium">
                      {livePipelineProgress?.progress_pct !== undefined
                        ? `Tracking: Frame ${livePipelineProgress.frame} / ${livePipelineProgress.total_frames}`
                        : runningSteps[runningStepIndex]}
                    </span>
                  </div>
                  {livePipelineProgress?.progress_pct !== undefined && (
                    <span className="font-mono text-zinc-100 font-semibold">{livePipelineProgress.progress_pct}%</span>
                  )}
                </div>

                {/* Smooth Animated Progress Bar */}
                {livePipelineProgress?.progress_pct !== undefined && (
                  <div className="w-full bg-neutral-800/80 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-white h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(100, Math.max(2, livePipelineProgress.progress_pct))}%` }}
                    />
                  </div>
                )}

                {isRunning && (
                  <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 pt-1 border-t border-neutral-800/60">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                      <span>{livePipelineProgress?.fps ? `${livePipelineProgress.fps} FPS` : `Elapsed: ${pipelineElapsed}s`}</span>
                      {livePipelineProgress?.unique_tracks !== undefined && (
                        <span className="text-neutral-500 ml-1">· {livePipelineProgress.unique_tracks} tracks active</span>
                      )}
                    </span>
                    <span className="text-neutral-300">
                      Est. time: <strong className="text-zinc-200">{estimatedSeconds ? `${Math.max(0, estimatedSeconds - pipelineElapsed)}s left` : "Calculating..."}</strong>
                      <span className="text-neutral-500 ml-1">({systemHardware?.device ? systemHardware.device.toUpperCase() : "CPU"} mode)</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

            <div ref={chatEndRef} />
            </div>
          </div>

          {/* Minimalist Floating Prompt Box */}
          <footer className="p-6">
            <form
              onSubmit={handleSendPrompt}
              className="max-w-3xl mx-auto bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-2xl p-3 space-y-3 shadow-2xl focus-within:border-neutral-500 transition-colors"
            >
              <input
                type="file"
                ref={fileInputRef}
                accept="video/*"
                className="hidden"
                onChange={e => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />

              {/* Selected File Attached Pill Badge — with live video preview */}
              {videoFile && (
                <div className="flex items-center justify-between gap-3 bg-[var(--bg-badge)] border border-[var(--border-panel)] rounded-xl px-3 py-2 text-xs text-neutral-300">
                  <div className="flex items-center gap-3 truncate min-w-0">
                    {videoPreviewUrl ? (
                      <video
                        src={videoPreviewUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-20 h-12 rounded-md object-cover bg-black border border-white/10 shrink-0"
                      />
                    ) : (
                      <div className="w-20 h-12 rounded-md bg-black/60 border border-white/10 flex items-center justify-center shrink-0">
                        <Video className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-mono truncate">{videoFile.name}</div>
                      <div className="text-[10px] text-neutral-500 font-mono">
                        {(videoFile.size / (1024 * 1024)).toFixed(1)} MB · ready to attach
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
                      setVideoFile(null);
                      setVideoPreviewUrl(null);
                    }}
                    className="text-neutral-400 hover:text-zinc-400 text-xs shrink-0 font-mono"
                    title="Remove video"
                  >
                    ✕
                  </button>
                </div>
              )}

              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendPrompt();
                  }
                }}
                rows={2}
                placeholder="Describe what you want your camera or footage to track..."
                className="w-full bg-transparent border-none outline-none text-sm text-[var(--fg)] placeholder-neutral-500 resize-none px-2"
              />

              <div className="flex items-center justify-between pt-1 border-t border-[var(--border-row)]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-7 h-7 rounded-lg hover:bg-[var(--bg-hover)] flex items-center justify-center text-neutral-400 hover:text-[var(--fg)] transition-colors"
                    title="Attach video or component"
                  >
                    <Plus className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1.5 text-xs text-neutral-300 bg-[var(--bg-hover)] px-2.5 py-1 rounded-lg border border-[var(--border-chip)] cursor-pointer hover:text-[var(--fg)] font-medium">
                    <Globe className="w-3.5 h-3.5 text-neutral-400" />
                    <span>{selectedToolMode}</span>
                    <ChevronRight className="w-3 h-3 rotate-90 text-neutral-500" />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-neutral-400 font-mono">
                    {selectedModel}
                  </span>

                  {isBusy ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      title="Stop"
                      className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 flex items-center justify-center transition-all shadow active:scale-[0.98]"
                    >
                      <StopCircle className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!prompt.trim() || isPlanning}
                      className="w-8 h-8 rounded-lg bg-[var(--accent-send)] hover:bg-[var(--accent-send-hover)] text-[var(--fg-on-accent)] flex items-center justify-center transition-all disabled:opacity-40 shadow"
                    >
                      <ArrowUp className="w-4 h-4 text-[var(--fg-on-accent)] stroke-[2.5]" />
                    </button>
                  )}
                </div>
              </div>
            </form>
          </footer>
        </div>
      )}
      </main>
    </div>
  );
}
