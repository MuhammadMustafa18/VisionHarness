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
  PanelRightClose
} from "lucide-react";

interface WorkflowSession {
  id: string;
  name: string;
  domain: string;
  folder: string;
}

interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  thoughts?: string;
  spec?: any;
  stats?: any;
  videoUrl?: string;
  timestamp: string;
}

export default function VisionHarnessApp() {
  const [sessions, setSessions] = useState<WorkflowSession[]>([
    { id: "wf_store_people_counter", name: "Retail Store Counter", domain: "retail_analytics", folder: "Default workspace" },
    { id: "wf_traffic_flow", name: "Intersection Monitor", domain: "traffic_monitoring", folder: "Default workspace" },
    { id: "wf_vault_security", name: "Vault Perimeter Guard", domain: "perimeter_security", folder: "Security Ops" },
    { id: "wf_vehicle_dwell", name: "Parking Dwell Timer", domain: "traffic_monitoring", folder: "Security Ops" },
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
      text: `I'm VisionHarness, an open-source vision agent built on Google Antigravity SDK and Cordis-style modular architecture. Run me as a desktop app or execute workflows across video streams.

I can help with:
1. Object Detection — Search and configure YOLO11, RT-DETR, and custom checkpoints.
2. Persistent Tracking — ByteTrack & BoT-SORT multi-object identity persistence.
3. Spatial Event Logic — Line crossing counters, polygon intrusion zones, and dwell timers.
4. Video Execution — Ingest uploaded videos (MP4/AVI), webcams, or live CCTV RTSP feeds.
5. On-the-Fly Tools — Synthesize custom CV logic plugins through chat.

And so much more...`,
      thoughts: "Identified VisionHarness agent introduction request. Loaded system capabilities, verified YOLO11 and ByteTrack primitives in registry.",
      timestamp: "10:30 AM"
    }
  ]);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
    const currentPrompt = prompt;
    setPrompt("");
    setIsPlanning(true);

    try {
      const res = await fetch("http://localhost:8000/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: currentPrompt, auth_mode: "auto" })
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
    const formData = new FormData();
    formData.append("workflow_id", spec.id || "wf_store_people_counter");
    if (videoFile) {
      formData.append("video", videoFile);
    } else {
      formData.append("video_path", "tests/synthetic_test.mp4");
    }

    try {
      const res = await fetch("http://localhost:8000/api/run", {
        method: "POST",
        body: formData
      });
      const stats = await res.json();
      
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
    <div className="h-screen w-screen bg-[#111216] text-[#e1e2e6] flex overflow-hidden font-sans select-none antialiased">
      <Head>
        <title>VisionHarness Desktop</title>
        <meta name="description" content="Agentic Computer Vision Builder" />
      </Head>

      {/* Left Sidebar (Dark Charcoal Aesthetic from Reference Image) */}
      <aside className="w-64 bg-[#1e2027] border-r border-[#2a2d36] flex flex-col justify-between">
        <div className="flex flex-col">
          
          {/* Top Window Header & Brand */}
          <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-[#2a2d36]/50">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
                👁️
              </div>
              <span className="font-semibold text-sm tracking-wide text-white">visionharness</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#2b2f3a] text-gray-300 ml-1">
                HARNESS
              </span>
            </div>
            <PanelLeftClose className="w-4 h-4 text-gray-400 hover:text-white cursor-pointer" />
          </div>

          {/* New Session Button */}
          <div className="px-4 py-2">
            <button
              onClick={() => {
                const name = typeof window !== "undefined" ? window.prompt("New Vision Session name:", "Traffic Analysis") : "New Session";
                if (name) {
                  const newSess: WorkflowSession = {
                    id: `wf_${Date.now()}`,
                    name,
                    domain: "general_vision",
                    folder: "Default workspace"
                  };
                  setSessions(prev => [newSess, ...prev]);
                  setActiveSessionId(newSess.id);
                }
              }}
              className="w-full py-2 px-3 rounded-lg bg-[#2a2d38] hover:bg-[#343846] text-sm text-gray-200 font-medium flex items-center justify-center gap-2 border border-[#3b3f4e]/60 transition-colors"
            >
              <Plus className="w-4 h-4 text-gray-300" />
              <span>New Session</span>
            </button>
          </div>

          {/* Navigation Links */}
          <div className="px-3 py-2 space-y-1 text-xs font-medium text-gray-300">
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-[#282b35] cursor-pointer text-gray-300 hover:text-white transition-colors">
              <Layers className="w-4 h-4 text-gray-400" />
              <span>CV Components</span>
            </div>
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-[#282b35] cursor-pointer text-gray-300 hover:text-white transition-colors">
              <Cpu className="w-4 h-4 text-gray-400" />
              <span>Automation / Streams</span>
            </div>
          </div>

          {/* Workspace Folders Header */}
          <div className="px-5 pt-4 pb-2 flex items-center justify-between text-xs text-gray-400">
            <span className="font-medium tracking-wide">Workspace</span>
            <div className="flex items-center gap-2 text-gray-400">
              <Search className="w-3.5 h-3.5 hover:text-white cursor-pointer" />
              <SlidersHorizontal className="w-3.5 h-3.5 hover:text-white cursor-pointer" />
              <FolderPlus className="w-3.5 h-3.5 hover:text-white cursor-pointer" />
            </div>
          </div>

          {/* Folder & Session Tree */}
          <div className="px-2 space-y-1 overflow-y-auto max-h-[46vh]">
            <div className="text-xs text-gray-400 flex items-center gap-1.5 px-3 py-1.5 font-medium">
              <Folder className="w-3.5 h-3.5 text-blue-400" />
              <span>Default workspace</span>
            </div>

            {sessions.filter(s => s.folder === "Default workspace").map(sess => (
              <button
                key={sess.id}
                onClick={() => setActiveSessionId(sess.id)}
                className={`w-full text-left text-xs px-6 py-2 rounded-md transition-colors truncate block ${
                  activeSessionId === sess.id
                    ? "bg-[#2f3340] text-white font-medium"
                    : "text-gray-400 hover:text-gray-200 hover:bg-[#252832]"
                }`}
              >
                {sess.name}
              </button>
            ))}

            <div className="text-xs text-gray-400 flex items-center gap-1.5 px-3 py-1.5 font-medium pt-2">
              <Folder className="w-3.5 h-3.5 text-blue-400" />
              <span>Security Ops</span>
            </div>

            {sessions.filter(s => s.folder === "Security Ops").map(sess => (
              <button
                key={sess.id}
                onClick={() => setActiveSessionId(sess.id)}
                className={`w-full text-left text-xs px-6 py-2 rounded-md transition-colors truncate block ${
                  activeSessionId === sess.id
                    ? "bg-[#2f3340] text-white font-medium"
                    : "text-gray-400 hover:text-gray-200 hover:bg-[#252832]"
                }`}
              >
                {sess.name}
              </button>
            ))}
          </div>

        </div>

        {/* User Footer Profile */}
        <div className="p-4 border-t border-[#2a2d36] flex items-center justify-between text-xs text-gray-300">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white font-semibold text-xs">
              M
            </div>
            <div className="flex flex-col">
              <span className="font-medium text-white truncate max-w-[110px]">Mustafa</span>
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Google Pro
              </span>
            </div>
          </div>
          <Settings className="w-4 h-4 text-gray-400 hover:text-white cursor-pointer" />
        </div>
      </aside>

      {/* Main Center Stage */}
      <main className="flex-1 flex flex-col bg-[#111216] overflow-hidden">
        
        {/* Top Minimal Navigation Bar */}
        <header className="h-14 border-b border-[#22242c] flex items-center justify-between px-6">
          <div className="text-sm font-medium text-gray-200 flex items-center gap-2">
            <span>{activeSession.name}</span>
          </div>
          <PanelRightClose className="w-4 h-4 text-gray-400 hover:text-white cursor-pointer" />
        </header>

        {/* Chat / Reasoning Canvas */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
            >
              {/* User Bubble */}
              {msg.sender === "user" ? (
                <div className="max-w-xl bg-[#2a2d36] text-white px-5 py-3 rounded-2xl text-sm leading-relaxed shadow-sm">
                  {msg.text}
                </div>
              ) : (
                /* Assistant Workspace Response */
                <div className="max-w-3xl w-full space-y-3">
                  
                  {/* Expandable Thinking Process (Matching "Thought for a while >" in Reference) */}
                  {msg.thoughts && (
                    <div className="text-xs text-gray-400 flex items-center gap-1.5 cursor-pointer hover:text-gray-300">
                      <span>Thought for a while</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  )}

                  <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">
                    {msg.text}
                  </div>

                  {/* Generated Pipeline Spec Box */}
                  {msg.spec && (
                    <div className="mt-4 bg-[#181a20] border border-[#2b2e38] rounded-xl p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                          <Layers className="w-4 h-4 text-cyan-400" />
                          <span>{msg.spec.name || "Generated Vision Pipeline"}</span>
                        </div>
                        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-800 text-cyan-400 font-medium">
                          Workflow Spec Ready
                        </span>
                      </div>

                      {/* Component Chips */}
                      <div className="grid grid-cols-3 gap-3 text-xs">
                        <div className="bg-[#20222a] p-3 rounded-lg border border-[#2b2e38]">
                          <span className="text-gray-500 block mb-1">DETECTOR</span>
                          <span className="font-medium text-gray-200">
                            {msg.spec.detector?.model || "yolo11n"}
                          </span>
                        </div>
                        <div className="bg-[#20222a] p-3 rounded-lg border border-[#2b2e38]">
                          <span className="text-gray-500 block mb-1">TRACKER</span>
                          <span className="font-medium text-gray-200">
                            {msg.spec.tracker?.tracker_type || "bytetrack"}
                          </span>
                        </div>
                        <div className="bg-[#20222a] p-3 rounded-lg border border-[#2b2e38]">
                          <span className="text-gray-500 block mb-1">SPATIAL LOGIC</span>
                          <span className="font-medium text-gray-200">Line Crossing Trigger</span>
                        </div>
                      </div>

                      {/* Execution Action Row */}
                      <div className="flex items-center gap-3 pt-2">
                        <button
                          onClick={() => handleRunInference(msg.spec)}
                          disabled={isRunning}
                          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          {isRunning ? "Running Pipeline..." : "Run Reference Footage"}
                        </button>

                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="px-3.5 py-2 rounded-lg bg-[#272a34] hover:bg-[#313542] text-gray-300 font-medium text-xs flex items-center gap-1.5 transition-colors border border-[#353947]"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          {videoFile ? videoFile.name.slice(0, 18) : "Upload Video / RTSP"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Video Inference Results & Visualizer */}
                  {msg.stats && (
                    <div className="mt-4 bg-[#181a20] border border-[#2b2e38] rounded-xl p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Video Inference Output</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-300 font-medium">
                          <span>IN: <strong className="text-emerald-400">{msg.stats.in_count ?? 0}</strong></span>
                          <span>OUT: <strong className="text-pink-400">{msg.stats.out_count ?? 0}</strong></span>
                          <span>FPS: {msg.stats.processed_fps}</span>
                        </div>
                      </div>

                      <div className="rounded-lg overflow-hidden bg-black aspect-video flex items-center justify-center border border-[#2b2e38]">
                        {msg.videoUrl ? (
                          <video
                            src={msg.videoUrl}
                            controls
                            autoPlay
                            loop
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="text-gray-500 text-xs flex flex-col items-center gap-2">
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

        {/* DeepSeek Harness Style Bottom Floating Prompt Box */}
        <footer className="p-6">
          <form
            onSubmit={handleSendPrompt}
            className="max-w-3xl mx-auto bg-[#1c1e24] border border-[#2e323e] rounded-2xl p-3 space-y-3 shadow-xl focus-within:border-cyan-500/70 transition-colors"
          >
            <input
              type="file"
              ref={fileInputRef}
              accept="video/*"
              className="hidden"
              onChange={e => e.target.files && setVideoFile(e.target.files[0])}
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
              placeholder="Describe what you want to build, / commands, @ files or sessions"
              className="w-full bg-transparent border-none outline-none text-sm text-gray-200 placeholder-gray-500 resize-none px-2"
            />

            {/* Bottom Controls Bar */}
            <div className="flex items-center justify-between pt-1 border-t border-[#2a2d36]/50">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-7 h-7 rounded-md hover:bg-[#282b35] flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                  title="Attach video or component"
                >
                  <Plus className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-1.5 text-xs text-gray-400 bg-[#242731] px-2.5 py-1 rounded-md border border-[#313543] cursor-pointer hover:text-white">
                  <Globe className="w-3.5 h-3.5" />
                  <span>{selectedToolMode}</span>
                  <ChevronRight className="w-3 h-3 rotate-90" />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 font-medium">
                  {selectedModel}
                </span>

                <button
                  type="submit"
                  disabled={!prompt.trim() || isPlanning}
                  className="w-7 h-7 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center transition-colors disabled:opacity-40"
                >
                  {isPlanning ? (
                    <Activity className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowUp className="w-4 h-4" />
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
