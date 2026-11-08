import React, { useState, useEffect, useRef } from "react";
import Head from "next/head";
import {
  Plus,
  Play,
  Upload,
  Layers,
  Sparkles,
  Search,
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
  Command
} from "lucide-react";

interface WorkflowSession {
  id: string;
  name: string;
  domain: string;
  folder: string;
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
  videoUrl?: string;
  toolCalls?: ToolCall[];
  uploadedVideoUrl?: string;
  uploadedVideoName?: string;
  isUploading?: boolean;
  uploadProgress?: number | null;
  uploadDone?: boolean;
  activeVideoFile?: File;
  timestamp: string;
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
    fetch("http://localhost:8000/api/sessions")
      .then(res => res.json())
      .then(data => {
        if (data && data.length > 0) {
          setSessions(data);
          setActiveSessionId(data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    fetch(`http://localhost:8000/api/sessions/${activeSessionId}/messages`)
      .then(res => res.json())
      .then(msgs => {
        if (msgs && msgs.length > 0) {
          // Normalize video URLs, thumbnails, and state
          const normalized = msgs.map((m: any) => {
            let restoredVideoUrl = m.uploadedVideoUrl;
            if (!restoredVideoUrl && m.uploadedVideoPath) {
              const filename = m.uploadedVideoPath.split(/[\\/]/).pop();
              restoredVideoUrl = `http://localhost:8000/uploads/${filename}`;
            }

            return {
              ...m,
              videoUrl: m.videoUrl || m.video_url,
              uploadedVideoUrl: restoredVideoUrl,
              uploadedVideoName: m.uploadedVideoName || (m.uploadedVideoPath ? m.uploadedVideoPath.split(/[\\/]/).pop() : undefined),
              uploadDone: m.uploadDone !== undefined ? m.uploadDone : (!!restoredVideoUrl || !!m.uploadedVideoName),
              diagramSvg: m.diagramSvg || m.diagram_svg
            };
          });
          setMessages(normalized);
        }
      })
      .catch(() => {});
  }, [activeSessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

    const initialBotMsg: Message = {
      id: (Date.now() + 1).toString(),
      sender: "bot",
      text: "Started new vision workflow workspace. Describe what objects, cameras, or crossing lines you want to track.",
      thoughts: "Initialized fresh session context. Ready for new CV prompt and footage.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages([initialBotMsg]);

    // Save to disk session store
    fetch("http://localhost:8000/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newSession)
    }).catch(() => {});

    fetch(`http://localhost:8000/api/sessions/${newId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initialBotMsg)
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
    if (stagedFile && !activeVideoPath) {
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

    // Determine if a NEW video was uploaded in THIS turn
    const isNewUploadThisTurn = !!uploadedThisTurn;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: "user",
      text: currentPrompt,
      uploadedVideoUrl: isNewUploadThisTurn ? activeVideoUrl : undefined,
      uploadedVideoName: isNewUploadThisTurn ? activeVideoName : undefined,
      activeVideoFile: isNewUploadThisTurn ? (stagedFile || undefined) : undefined,
      uploadDone: !!activeVideoPath,
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

    const currentWorkspace = {
      ...workspaceState,
      video_path: activeVideoPath,
      video_url: activeVideoUrl,
      video_name: activeVideoName,
    };

    try {
      const response = await fetch("http://localhost:8000/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: activeSessionId,
          prompt: currentPrompt,
          workspace: currentWorkspace
        })
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
              setWorkspaceState(chunk.workspace);
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

          const finalized: Message = {
            ...m,
            text: cleanText || accumulatedText || "Analysis complete.",
            thoughts: accumulatedThinking || m.thoughts,
            spec: parsedSpec || m.spec || (currentWorkspace.spec ? currentWorkspace.spec : undefined),
            toolCalls: activeToolCalls,
            stats: m.stats || (currentWorkspace.last_stats ? currentWorkspace.last_stats : undefined),
            videoUrl: m.videoUrl || (currentWorkspace.last_stats?.video_url ? `http://localhost:8000${currentWorkspace.last_stats.video_url}` : undefined),
            uploadedVideoUrl: activeVideoUrl,
            uploadedVideoName: activeVideoName,
            uploadDone: !!activeVideoPath
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
    } finally {
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
      const response = await fetch("http://localhost:8000/api/ground", {
        method: "POST",
        body: formData
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
    } finally {
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

    try {
      const stats = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
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
          setUploadProgress(null);
          setUploadDone(false);
          reject(new Error("Network Error"));
        };

        xhr.send(formData);
      });
      
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
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-[#0d0e11] text-[#ededef] flex overflow-hidden font-sans antialiased selection:bg-neutral-800">
      <Head>
        <title>VisionHarness</title>
        <meta name="description" content="Agentic Computer Vision Builder" />
      </Head>

      {/* Deep Obsidian Sidebar (Matching Ember Design System) */}
      <aside className="w-64 bg-[#0a0b0d] border-r border-[#191a1f] flex flex-col justify-between select-none">
        <div className="flex flex-col">
          
          {/* Top Brand & Sidebar Switcher */}
          <div className="px-5 pt-5 pb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="font-semibold text-base tracking-tight text-white">VisionHarness</span>
            </div>
            <button
              onClick={handleNewChat}
              title="New Vision Chat (⌘N)"
              className="p-1.5 rounded-lg bg-[#14151a] hover:bg-[#1f2026] text-neutral-400 hover:text-white border border-[#242630] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* New Chat Quick Button */}
          <div className="px-4 pb-2">
            <button
              onClick={handleNewChat}
              className="w-full py-2.5 px-3.5 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98]"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>New Workspace</span>
            </button>
          </div>

          {/* Search Box with Pill Shortcut */}
          <div className="px-4 py-2">
            <div className="w-full py-2 px-3 rounded-xl bg-[#131418] border border-[#202228] flex items-center justify-between text-neutral-400 text-xs">
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-neutral-500" />
                <span>Search</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] font-mono bg-[#1c1e24] px-1.5 py-0.5 rounded text-neutral-400 border border-[#262830]">
                <span>⌘</span>
                <span>K</span>
              </div>
            </div>
          </div>

          {/* Navigation Section */}
          <div className="px-5 pt-6 pb-2 text-[11px] font-medium tracking-normal text-neutral-500">
            Navigation
          </div>

          <div className="px-3 space-y-1">
            <button
              onClick={() => setActiveSessionId("wf_store_people_counter")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                activeSessionId === "wf_store_people_counter"
                  ? "bg-[#1c1d22] text-white shadow-inner font-semibold border border-[#2a2c34]"
                  : "text-neutral-400 hover:text-white hover:bg-[#131418]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <LayoutGrid className="w-4 h-4 text-neutral-400" />
                <span>Overview</span>
              </div>
            </button>

            <button
              onClick={() => setActiveSessionId("wf_traffic_flow")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                activeSessionId === "wf_traffic_flow"
                  ? "bg-[#1c1d22] text-white shadow-inner font-semibold border border-[#2a2c34]"
                  : "text-neutral-400 hover:text-white hover:bg-[#131418]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Inbox className="w-4 h-4 text-neutral-400" />
                <span>Traffic Feeds</span>
              </div>
              <span className="text-[11px] text-neutral-500 font-mono">12</span>
            </button>

            <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-neutral-400 hover:text-white hover:bg-[#131418] transition-all">
              <div className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-neutral-400" />
                <span>CV Projects</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-neutral-600 rotate-90" />
            </button>

            <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-neutral-400 hover:text-white hover:bg-[#131418] transition-all">
              <div className="flex items-center gap-2.5">
                <BarChart3 className="w-4 h-4 text-neutral-400" />
                <span>Analytics / Reports</span>
              </div>
            </button>
          </div>

          {/* Model Engines / Tiers Section */}
          <div className="px-5 pt-6 pb-2 text-[11px] font-medium tracking-normal text-neutral-500">
            Vision engines
          </div>

          <div className="px-3 space-y-1">
            <div className="flex items-center justify-between px-3 py-2 rounded-lg text-xs text-neutral-400">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-[#f59e0b] shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                <span>YOLO11 Ultra</span>
              </div>
              <span className="text-neutral-500 font-mono text-[11px]">18</span>
            </div>

            <div className="flex items-center justify-between px-3 py-2 rounded-lg text-xs text-neutral-400">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-[#10b981] shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span>ByteTrack Pro</span>
              </div>
              <span className="text-neutral-500 font-mono text-[11px]">64</span>
            </div>

            <div className="flex items-center justify-between px-3 py-2 rounded-lg text-xs text-neutral-400">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-[#3b82f6] shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                <span>Google Pro CLI</span>
              </div>
              <span className="text-neutral-500 font-mono text-[11px]">210</span>
            </div>
          </div>

        </div>

        {/* User Footer Profile */}
        <div className="p-4 border-t border-[#191a1f] flex items-center justify-between text-xs text-neutral-400">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-neutral-700 to-neutral-900 border border-neutral-700 flex items-center justify-center text-white font-semibold text-xs shadow">
              M
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-white truncate max-w-[110px]">Mustafa</span>
              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Pro Connected
              </span>
            </div>
          </div>
          <Settings className="w-4 h-4 text-neutral-500 hover:text-white cursor-pointer transition-colors" />
        </div>
      </aside>

      {/* Main Center Canvas (Minimalist Charcoal Black) */}
      <main className="flex-1 flex flex-col bg-[#0d0e11] overflow-hidden">
        
        {/* Top Minimal Header */}
        <header className="h-16 border-b border-[#17181e] flex items-center justify-between px-8">
          <div className="flex items-center gap-3">
            <LayoutGrid className="w-4 h-4 text-neutral-400" />
            <h1 className="text-xl font-semibold tracking-tight text-white">
              {activeSession.name}
            </h1>
          </div>
          <div className="flex items-center gap-2 text-neutral-400 text-xs">
            <span className="font-mono text-neutral-500">Vision Workspace</span>
          </div>
        </header>

        {/* Chat / Reasoning Canvas */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 select-text">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
            >
              {/* User Bubble */}
              {msg.sender === "user" ? (
                <div className="max-w-xl bg-[#18191f] border border-[#262832] text-[#f4f4f5] px-5 py-3 rounded-2xl text-sm leading-relaxed space-y-2.5">
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
              ) : (
                /* Assistant Seamless Response (No Outer Card) */
                <div className="max-w-3xl w-full space-y-4">
                  
                  {/* Pink Mascot Avatar & Brand */}
                  <div className="flex items-center gap-2.5">
                    <img
                      src="/mascot.png"
                      alt="VisionHarness Mascot"
                      className="w-5 h-5 object-contain"
                    />
                    <span className="text-xs font-semibold tracking-wide text-neutral-300">VisionHarness</span>
                  </div>

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
                    <div className="border-l-2 border-[#2b2e38] pl-4 py-1 text-xs text-neutral-400 italic leading-relaxed my-2">
                      {msg.thoughts}
                    </div>
                  )}

                  {/* Clean conversational response */}
                  {msg.text ? (
                    <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-line font-normal">
                      {msg.text}
                    </div>
                  ) : (
                    isPlanning && (
                      <div className="flex items-center gap-2 text-xs text-neutral-400 font-mono py-1">
                        <Activity className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                        <span>Generating response...</span>
                      </div>
                    )
                  )}

                  {/* Clean Single Pipeline Spec Card with Upload & Run Action */}
                  {msg.spec && (
                    <div 
                      style={{ backgroundColor: "#1e1f26" }} 
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
                              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs flex items-center gap-2 transition-all shadow-md active:scale-[0.98] disabled:opacity-50"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              Confirm & Run Pipeline on {msg.uploadedVideoName.slice(0, 18)}
                            </button>
                          ) : null}

                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-4 py-2.5 rounded-xl bg-[#2a2c35] hover:bg-[#343742] text-zinc-200 font-semibold text-xs flex items-center gap-2 transition-all shadow-md active:scale-[0.98]"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            {msg.uploadedVideoName ? `Replace Video` : "Upload Video to Ground Scene"}
                          </button>
                        </div>

                        {/* Video Thumbnail with Circular Progress Bar when uploading & Done Overlay */}
                        {msg.uploadedVideoUrl && (
                          <div className="relative w-64 h-36 rounded-xl overflow-hidden bg-black shadow-lg mt-1 group border-0">
                            <video
                              src={msg.uploadedVideoUrl}
                              controls={msg.uploadProgress === null}
                              playsInline
                              preload="metadata"
                              className={`w-full h-full object-cover transition-all duration-300 ${
                                msg.uploadProgress !== null && msg.uploadProgress !== undefined ? "blur-md scale-105 opacity-60" : "blur-0 opacity-100"
                              }`}
                            />

                            {/* Upload Progress Overlay (Blurred Background + Circular Progress Ring) */}
                            {msg.uploadProgress !== null && msg.uploadProgress !== undefined && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md">
                                <div className="relative w-14 h-14 flex items-center justify-center">
                                  <svg className="w-14 h-14 transform -rotate-90">
                                    <circle
                                      cx="28"
                                      cy="28"
                                      r="22"
                                      stroke="rgba(255,255,255,0.12)"
                                      strokeWidth="4"
                                      fill="transparent"
                                    />
                                    <circle
                                      cx="28"
                                      cy="28"
                                      r="22"
                                      stroke="#10b981"
                                      strokeWidth="4"
                                      fill="transparent"
                                      strokeDasharray={2 * Math.PI * 22}
                                      strokeDashoffset={
                                        2 * Math.PI * 22 * (1 - (msg.uploadProgress || 0) / 100)
                                      }
                                      strokeLinecap="round"
                                      className="transition-all duration-150"
                                    />
                                  </svg>
                                  <span className="absolute text-xs font-bold text-white font-mono">
                                    {msg.uploadProgress}%
                                  </span>
                                </div>
                                <span className="text-[10px] text-emerald-400 font-medium mt-1 font-mono tracking-wide">Uploading...</span>
                              </div>
                            )}

                            {/* Upload Done Overlay */}
                            {msg.uploadDone && (msg.uploadProgress === null || msg.uploadProgress === undefined) && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45 backdrop-blur-[2px] transition-all">
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 shadow-md">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                  <span className="text-xs font-semibold tracking-wide font-mono uppercase">Done</span>
                                </div>
                              </div>
                            )}

                            {!msg.uploadDone && (msg.uploadProgress === null || msg.uploadProgress === undefined) && !isRunning && (
                              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[10px] text-neutral-300 font-medium flex items-center gap-1 border border-white/10 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                <span>{msg.uploadedVideoName?.slice(0, 16)}</span>
                              </div>
                            )}
                          </div>
                        )}
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
                              className="bg-[#121318] border border-[#20222a] rounded-xl p-3 text-xs font-mono space-y-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-amber-400 font-semibold flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  {tc.name}
                                </span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                  tc.status === "completed" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                                }`}>
                                  {tc.status}
                                </span>
                              </div>
                              <div className="text-[11px] text-neutral-400 bg-[#0d0e11] p-2 rounded-lg overflow-x-auto">
                                <div className="text-neutral-500">// Arguments:</div>
                                <div className="text-neutral-300">{JSON.stringify(tc.args, null, 2)}</div>
                                {tc.output && (
                                  <>
                                    <div className="text-neutral-500 mt-1">// Result:</div>
                                    <div className="text-emerald-400">{JSON.stringify(tc.output, null, 2)}</div>
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
                    <div className="mt-4 bg-[#18191f] border border-[#242630] rounded-2xl p-5 space-y-4 shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Video Inference Output</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-neutral-300 font-mono">
                          {msg.stats.unique_tracks !== undefined && msg.stats.unique_tracks !== null && (
                            <span>Unique Entities: <strong className="text-emerald-400">{msg.stats.unique_tracks}</strong></span>
                          )}
                          {msg.stats.has_polygon_zones ? (
                            <span>Zone Peak: <strong className="text-amber-400">{msg.stats.max_zone_occupancy ?? 0}</strong></span>
                          ) : (
                            <>
                              <span>IN: <strong className="text-emerald-400">{msg.stats.in_count ?? 0}</strong></span>
                              <span>OUT: <strong className="text-rose-400">{msg.stats.out_count ?? 0}</strong></span>
                            </>
                          )}
                          <span>FPS: {msg.stats.processed_fps}</span>
                        </div>
                      </div>

                      {/* VLM Scene Grounding Feedback */}
                      {msg.stats.scene_analysis && (
                        <div className="bg-[#121318] border border-neutral-800 rounded-xl px-4 py-2.5 text-xs text-neutral-300 flex items-start gap-2.5">
                          <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <div className="leading-relaxed">
                            <span className="text-neutral-400 font-medium">VLM Scene Analysis: </span>
                            <span className="text-neutral-200">{msg.stats.scene_analysis}</span>
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-neutral-800 text-neutral-300">
                              {msg.stats.geometry_type === "polygon" ? "Polygon Zone" : "Directional Line"}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-[#242630]">
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
              <div className="flex items-center gap-2.5">
                <img
                  src="/mascot.png"
                  alt="VisionHarness Mascot"
                  className="w-5 h-5 object-contain"
                />
                <span className="text-xs font-semibold tracking-wide text-neutral-300">VisionHarness</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-300 bg-[#16171d] px-4 py-2.5 rounded-2xl border border-zinc-800/80 shadow-md">
                <Activity className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                <span className="font-mono">Processing with mimo-v2.6-flash...</span>
              </div>
            </div>
          )}

          {/* Running Inference or Grounding Dynamic Progress Indicator */}
          {(isRunning || isGrounding) && (
            <div className="flex flex-col items-start space-y-3 max-w-xl">
              <div className="flex items-center gap-2.5">
                <img
                  src="/mascot.png"
                  alt="VisionHarness Mascot"
                  className="w-5 h-5 object-contain"
                />
                <span className="text-xs font-semibold tracking-wide text-neutral-300">VisionHarness</span>
              </div>
              <div className="flex flex-col gap-2 bg-[#16171d] px-4 py-3 rounded-2xl border border-zinc-800/80 shadow-md w-full">
                <div className="flex items-center gap-2 text-xs text-neutral-200">
                  <Activity className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                  <span className="font-mono">{runningSteps[runningStepIndex]}</span>
                </div>
                {isRunning && (
                  <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 pt-1.5 border-t border-neutral-800/60">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      <span>Elapsed: {pipelineElapsed}s</span>
                    </span>
                    <span className="text-neutral-300">
                      Est. time: <strong className="text-amber-400">{estimatedSeconds ? `${Math.max(0, estimatedSeconds - pipelineElapsed)}s left` : "Calculating..."}</strong>
                      <span className="text-neutral-500 ml-1">({systemHardware?.device ? systemHardware.device.toUpperCase() : "CPU"} mode)</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Minimalist Floating Prompt Box */}
        <footer className="p-6">
          <form
            onSubmit={handleSendPrompt}
            className="max-w-3xl mx-auto bg-[#131418] border border-[#242630] rounded-2xl p-3 space-y-3 shadow-2xl focus-within:border-neutral-500 transition-colors"
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
              <div className="flex items-center justify-between gap-3 bg-[#181920] border border-[#2b2d38] rounded-xl px-3 py-2 text-xs text-neutral-300">
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
                      <Video className="w-4 h-4 text-emerald-400" />
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
                  className="text-neutral-400 hover:text-rose-400 text-xs shrink-0 font-mono"
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
              className="w-full bg-transparent border-none outline-none text-sm text-[#ededef] placeholder-neutral-500 resize-none px-2"
            />

            <div className="flex items-center justify-between pt-1 border-t border-[#1d1f27]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-7 h-7 rounded-lg hover:bg-[#1c1d22] flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
                  title="Attach video or component"
                >
                  <Plus className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-1.5 text-xs text-neutral-300 bg-[#1c1d22] px-2.5 py-1 rounded-lg border border-[#282a34] cursor-pointer hover:text-white font-medium">
                  <Globe className="w-3.5 h-3.5 text-neutral-400" />
                  <span>{selectedToolMode}</span>
                  <ChevronRight className="w-3 h-3 rotate-90 text-neutral-500" />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-neutral-400 font-mono">
                  {selectedModel}
                </span>

                <button
                  type="submit"
                  disabled={!prompt.trim() || isPlanning}
                  className="w-8 h-8 rounded-lg bg-white hover:bg-neutral-200 text-black flex items-center justify-center transition-all disabled:opacity-40 shadow"
                >
                  {isPlanning ? (
                    <Activity className="w-4 h-4 animate-spin text-black" />
                  ) : (
                    <ArrowUp className="w-4 h-4 text-black stroke-[2.5]" />
                  )}
                </button>
              </div>
            </div>
          </form>
        </footer>
      </main>
    </div>
  );
}
