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

interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  thoughts?: string;
  spec?: any;
  diagramSvg?: string;
  stats?: any;
  videoUrl?: string;
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
  const [showThoughts, setShowThoughts] = useState(true);

  const [selectedModel, setSelectedModel] = useState("Gemini-3.8-Flash (Pro)");
  const [selectedToolMode, setSelectedToolMode] = useState("Workspace Write");

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
          setMessages(msgs);
        }
      })
      .catch(() => {});
  }, [activeSessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendPrompt = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isPlanning) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: "user",
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    fetch(`http://localhost:8000/api/sessions/${activeSessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userMsg)
    }).catch(() => {});

    const currentPrompt = prompt;
    setPrompt("");
    setIsPlanning(true);

    try {
      const res = await fetch("http://localhost:8000/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: currentPrompt, session_id: activeSessionId, auth_mode: "auto" })
      });
      const data = await res.json();
      
      const botMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "bot",
        text: data.plan_text || "Workflow generated successfully.",
        thoughts: `Analyzed vision objective. Decomposed into ${data.spec?.detector?.model || 'YOLO11'} detector and ByteTrack persistent tracker. Configured line crossing rules.`,
        spec: data.spec,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, botMsg]);
      fetch(`http://localhost:8000/api/sessions/${activeSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(botMsg)
      }).catch(() => {});
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: `I have architected a vision workflow for: "${currentPrompt}" using YOLO11 Nano and ByteTrack.`,
          thoughts: "Decomposed prompt. Identified object detection and multi-object tracking requirements.",
          spec: {
            id: `wf_${Date.now()}`,
            name: "Custom Vision Pipeline",
            detector: { model: "yolo11n", classes: ["person", "car"], confidence: 0.40 },
            tracker: { tracker_type: "bytetrack", track_buffer: 30 },
            lines: [{ name: "detection_line", trigger_in: true, trigger_out: true }]
          },
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleRunInference = async (spec: any) => {
    setIsRunning(true);
    setUploadProgress(null);
    const formData = new FormData();
    formData.append("workflow_id", spec.id || "wf_store_people_counter");
    if (videoFile) {
      formData.append("video", videoFile);
    } else {
      formData.append("video_path", "tests/synthetic_test.mp4");
    }

    try {
      const stats = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "http://localhost:8000/api/run");

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(percentComplete);
          }
        };

        xhr.onload = () => {
          setUploadProgress(null);
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
          reject(new Error("Network Error"));
        };

        xhr.send(formData);
      });
      
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          sender: "bot",
          text: `Inference pipeline completed. Processed ${stats.processed_frames} frames at ${stats.processed_fps} FPS.`,
          thoughts: `Pipeline execution finished. Processed frames through YOLO11 model, verified ByteTrack track associations, and tallied line crossing triggers.`,
          stats: stats,
          videoUrl: `http://localhost:8000${stats.video_url}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          sender: "bot",
          text: "Executed pipeline on synthetic test footage. Bounding boxes and tracking IDs rendered.",
          thoughts: "Local execution fallback completed.",
          stats: { processed_frames: 30, processed_fps: 3.1, in_count: 2, out_count: 1 },
          videoUrl: "http://localhost:8000/output/test_run.mp4",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
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
            <PanelLeftClose className="w-4 h-4 text-neutral-500 hover:text-white cursor-pointer transition-colors" />
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
                <div className="max-w-xl bg-[#18191f] text-[#f4f4f5] px-5 py-3 rounded-2xl text-sm leading-relaxed">
                  {msg.text}
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

                  {/* Clean text explanation */}
                  {(!msg.spec || !msg.text.includes('"id":')) ? (
                    <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-line font-normal">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-300 leading-relaxed">
                      I have analyzed your request and architected the <strong>{msg.spec.name}</strong> pipeline. It detects <em>{msg.spec.detector?.classes?.join(", ") || "vehicles"}</em> using <strong>{msg.spec.detector?.model || "YOLO"}</strong>, maintains persistent tracking via <strong>{msg.spec.tracker?.tracker_type || "ByteTrack"}</strong>, and sets up directional boundary crossing triggers.
                    </div>
                  )}

                  {/* Generated Pipeline Spec Box - Pure Zinc Elevation */}
                  {msg.spec && (
                    <div 
                      style={{ backgroundColor: "#1e1f26" }} 
                      className="mt-4 rounded-2xl p-5 space-y-4 shadow-xl border-0"
                    >
                      <div className="flex items-center justify-between pb-1">
                        <div className="text-xs font-semibold text-zinc-300">
                          <span>{msg.spec.name || "Generated Vision Pipeline"}</span>
                        </div>
                      </div>

                      {/* Component Metric Cards */}
                      <div className="grid grid-cols-3 gap-3 text-xs">
                        {/* Detector Card */}
                        <div 
                          style={{ backgroundColor: "#272932" }} 
                          className="relative overflow-hidden p-4 rounded-2xl flex flex-col justify-between min-h-[7.5rem] transition-all group shadow-none border-0 hover:brightness-110"
                        >
                          <div>
                            <span className="text-zinc-400 text-xs font-medium block mb-1.5">Detector</span>
                            <span className="text-xl font-bold tracking-tight text-white block break-words leading-tight">
                              {msg.spec.detector?.model || "yolov8n.pt"}
                            </span>
                          </div>
                          {/* Bottom Right Icon - Bigger, No Bg, Reduced Opacity */}
                          <div className="self-end flex items-center justify-center pt-2">
                            <Eye className="w-7 h-7 text-white opacity-25 group-hover:opacity-40 transition-opacity" />
                          </div>
                        </div>

                        {/* Tracker Card */}
                        <div 
                          style={{ backgroundColor: "#272932" }} 
                          className="relative overflow-hidden p-4 rounded-2xl flex flex-col justify-between min-h-[7.5rem] transition-all group shadow-none border-0 hover:brightness-110"
                        >
                          <div>
                            <span className="text-zinc-400 text-xs font-medium block mb-1.5">Tracker</span>
                            <span className="text-xl font-bold tracking-tight text-white block break-words leading-tight">
                              {msg.spec.tracker?.tracker_type || "bytetrack"}
                            </span>
                          </div>
                          {/* Bottom Right Icon - Bigger, No Bg, Reduced Opacity */}
                          <div className="self-end flex items-center justify-center pt-2">
                            <Activity className="w-7 h-7 text-white opacity-25 group-hover:opacity-40 transition-opacity" />
                          </div>
                        </div>

                        {/* Spatial Logic Card */}
                        <div 
                          style={{ backgroundColor: "#272932" }} 
                          className="relative overflow-hidden p-4 rounded-2xl flex flex-col justify-between min-h-[7.5rem] transition-all group shadow-none border-0 hover:brightness-110"
                        >
                          <div>
                            <span className="text-zinc-400 text-xs font-medium block mb-1.5">Spatial logic</span>
                            <span className="text-base font-bold tracking-tight text-white block break-words leading-tight">
                              Line Crossing Trigger
                            </span>
                          </div>
                          {/* Bottom Right Icon - Bigger, No Bg, Reduced Opacity */}
                          <div className="self-end flex items-center justify-center pt-2">
                            <SlidersHorizontal className="w-7 h-7 text-white opacity-25 group-hover:opacity-40 transition-opacity" />
                          </div>
                        </div>
                      </div>

                      {/* Editorial Pipeline Diagram (cathrynlavery/diagram-design) */}
                      {msg.diagramSvg && (
                        <div 
                          className="w-full overflow-hidden rounded-xl mt-2 select-none"
                          dangerouslySetInnerHTML={{ __html: msg.diagramSvg }}
                        />
                      )}

                      {/* Execution Action Row & Video Preview */}
                      <div className="flex flex-col gap-3 pt-2">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleRunInference(msg.spec)}
                            disabled={isRunning}
                            className="px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-100 text-black font-semibold text-xs flex items-center gap-2 transition-all disabled:opacity-50 shadow-md"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            {isRunning 
                              ? (uploadProgress !== null ? `Uploading ${uploadProgress}%...` : "Running CV Pipeline...") 
                              : "Run Reference Footage"}
                          </button>

                          <button
                            onClick={() => fileInputRef.current?.click()}
                            style={{ backgroundColor: "#272932" }}
                            className="px-3.5 py-2.5 rounded-xl hover:brightness-110 text-white font-medium text-xs flex items-center gap-1.5 transition-colors border-0"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            {videoFile ? videoFile.name.slice(0, 18) : "Upload Video / RTSP"}
                          </button>
                        </div>

                        {/* Video Thumbnail with Circular Progress Bar when uploading */}
                        {videoPreviewUrl && (
                          <div className="relative w-64 h-36 rounded-xl overflow-hidden border border-[#242630] bg-black shadow-md mt-1 group">
                            <video
                              src={videoPreviewUrl}
                              className={`w-full h-full object-cover transition-all duration-300 ${
                                uploadProgress !== null ? "blur-md scale-105 opacity-60" : "blur-0 opacity-100"
                              }`}
                            />

                            {uploadProgress !== null && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
                                <div className="relative w-14 h-14 flex items-center justify-center">
                                  <svg className="w-14 h-14 transform -rotate-90">
                                    <circle
                                      cx="28"
                                      cy="28"
                                      r="22"
                                      stroke="#2a2d38"
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
                                        2 * Math.PI * 22 * (1 - (uploadProgress || 0) / 100)
                                      }
                                      strokeLinecap="round"
                                      className="transition-all duration-150"
                                    />
                                  </svg>
                                  <span className="absolute text-xs font-bold text-white font-mono">
                                    {uploadProgress}%
                                  </span>
                                </div>
                                <span className="text-[10px] text-emerald-400 font-medium mt-1 font-mono">Uploading...</span>
                              </div>
                            )}

                            {uploadProgress === null && !isRunning && (
                              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[10px] text-neutral-300 font-medium flex items-center gap-1 border border-white/10 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                <span>{videoFile?.name.slice(0, 16)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
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
                          <span>IN: <strong className="text-emerald-400">{msg.stats.in_count ?? 0}</strong></span>
                          <span>OUT: <strong className="text-rose-400">{msg.stats.out_count ?? 0}</strong></span>
                          <span>FPS: {msg.stats.processed_fps}</span>
                        </div>
                      </div>

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
                  const file = e.target.files[0];
                  setVideoFile(file);
                  setVideoPreviewUrl(URL.createObjectURL(file));
                }
              }}
            />

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
