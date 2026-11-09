import React, { useState, useRef, useEffect, useCallback } from "react";
import { Edit2, Check, RotateCcw, Split, Square, Play, Pause, Maximize2, Minimize2 } from "lucide-react";

export interface Point {
  x: number;
  y: number;
}

export interface Zone {
  name: string;
  polygon: Point[];
}

export interface LineCrossing {
  name: string;
  start: Point;
  end: Point;
  trigger_in?: boolean;
  trigger_out?: boolean;
}

interface GeometryEditorProps {
  videoUrl: string;
  initialZones?: Zone[];
  initialLines?: LineCrossing[];
  onSave?: (geometry: { geometry_type: "polygon" | "line"; zones: Zone[]; lines: LineCrossing[] }) => void;
  className?: string;
}

export const GeometryEditor: React.FC<GeometryEditorProps> = ({
  videoUrl,
  initialZones = [],
  initialLines = [],
  onSave,
  className = ""
}) => {
  const [isEditing, setIsEditing] = useState(true);
  const [mode, setMode] = useState<"polygon" | "line">(() => (initialLines.length > 0 && initialZones.length === 0 ? "line" : "polygon"));

  // Normalized zones state (0.0 to 1.0)
  const [zones, setZones] = useState<Zone[]>(() => {
    if (initialZones.length > 0) return initialZones;
    return [
      {
        name: "active_zone",
        polygon: [
          { x: 0.1, y: 0.25 },
          { x: 0.9, y: 0.25 },
          { x: 0.9, y: 0.95 },
          { x: 0.1, y: 0.95 }
        ]
      }
    ];
  });

  // Normalized lines state
  const [lines, setLines] = useState<LineCrossing[]>(() => {
    if (initialLines.length > 0) return initialLines;
    return [
      {
        name: "crossing_line",
        start: { x: 0.15, y: 0.65 },
        end: { x: 0.85, y: 0.65 },
        trigger_in: true,
        trigger_out: true
      }
    ];
  });

  // Backup for Reset
  const initialBackupRef = useRef({ zones, lines, mode });

  // Dragging interaction state
  const [dragState, setDragState] = useState<{
    type: "vertex" | "line-endpoint";
    zoneIdx?: number;
    pointIdx?: number;
    endpoint?: "start" | "end";
  } | null>(null);

  // Playback & Fullscreen state
  const [isPlaying, setIsPlaying] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeDragRef = useRef<typeof dragState>(null);
  activeDragRef.current = dragState;

  // Track fullscreen changes from ESC or native events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen request error:", err);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  // Sync when initialZones or initialLines change, but only if not currently actively editing/dragging
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;

  useEffect(() => {
    if (isEditingRef.current) return; // Don't wipe out user's active edits when props re-render
    if (initialZones.length > 0) {
      setZones(initialZones);
      setMode("polygon");
    } else if (initialLines.length > 0) {
      setLines(initialLines);
      setMode("line");
    }
  }, [initialZones, initialLines]);

  const updateCoordinates = useCallback(
    (clientX: number, clientY: number) => {
      const currentDrag = activeDragRef.current;
      if (!currentDrag || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const rawX = (clientX - rect.left) / rect.width;
      const rawY = (clientY - rect.top) / rect.height;

      // Clamp between 0.0 and 1.0
      const clampedX = Math.max(0.01, Math.min(0.99, Number(rawX.toFixed(3))));
      const clampedY = Math.max(0.01, Math.min(0.99, Number(rawY.toFixed(3))));

      if (currentDrag.type === "vertex" && currentDrag.zoneIdx !== undefined && currentDrag.pointIdx !== undefined) {
        setZones(prev => {
          const next = [...prev];
          const targetZone = { ...next[currentDrag.zoneIdx!] };
          const targetPoly = [...targetZone.polygon];
          targetPoly[currentDrag.pointIdx!] = { x: clampedX, y: clampedY };
          targetZone.polygon = targetPoly;
          next[currentDrag.zoneIdx!] = targetZone;
          return next;
        });
      } else if (currentDrag.type === "line-endpoint" && currentDrag.endpoint) {
        setLines(prev => {
          const next = [...prev];
          const targetLine = { ...next[0] };
          targetLine[currentDrag.endpoint!] = { x: clampedX, y: clampedY };
          next[0] = targetLine;
          return next;
        });
      }
    },
    []
  );

  // Global window listeners while dragging to guarantee smooth tracking
  useEffect(() => {
    if (!dragState) return;

    const onGlobalPointerMove = (e: PointerEvent) => {
      e.preventDefault();
      updateCoordinates(e.clientX, e.clientY);
    };

    const onGlobalPointerUp = (e: PointerEvent) => {
      setDragState(null);
      activeDragRef.current = null;
      if (onSave) {
        onSave({
          geometry_type: mode,
          zones: mode === "polygon" ? zones : [],
          lines: mode === "line" ? lines : []
        });
      }
    };

    window.addEventListener("pointermove", onGlobalPointerMove, { passive: false });
    window.addEventListener("pointerup", onGlobalPointerUp);
    window.addEventListener("pointercancel", onGlobalPointerUp);

    return () => {
      window.removeEventListener("pointermove", onGlobalPointerMove);
      window.removeEventListener("pointerup", onGlobalPointerUp);
      window.removeEventListener("pointercancel", onGlobalPointerUp);
    };
  }, [dragState, mode, zones, lines, onSave, updateCoordinates]);

  const handlePointerDown = (
    e: React.PointerEvent,
    target: { type: "vertex" | "line-endpoint"; zoneIdx?: number; pointIdx?: number; endpoint?: "start" | "end" }
  ) => {
    if (!isEditing) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {}
    setDragState(target);
    activeDragRef.current = target;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activeDragRef.current) {
      updateCoordinates(e.clientX, e.clientY);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (activeDragRef.current) {
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {}
      setDragState(null);
      activeDragRef.current = null;
      if (onSave) {
        onSave({
          geometry_type: mode,
          zones: mode === "polygon" ? zones : [],
          lines: mode === "line" ? lines : []
        });
      }
    }
  };

  // Add vertex on segment click
  const handleAddVertex = (e: React.MouseEvent, zoneIdx: number, edgeIdx: number) => {
    if (!isEditing || mode !== "polygon" || !containerRef.current) return;
    e.stopPropagation();
    e.preventDefault();

    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0.02, Math.min(0.98, Number(((e.clientX - rect.left) / rect.width).toFixed(3))));
    const y = Math.max(0.02, Math.min(0.98, Number(((e.clientY - rect.top) / rect.height).toFixed(3))));

    setZones(prev => {
      const next = [...prev];
      const z = { ...next[zoneIdx] };
      const poly = [...z.polygon];
      poly.splice(edgeIdx + 1, 0, { x, y });
      z.polygon = poly;
      next[zoneIdx] = z;
      return next;
    });
  };

  // Double click vertex to delete
  const handleDeleteVertex = (e: React.MouseEvent, zoneIdx: number, pointIdx: number) => {
    if (!isEditing || mode !== "polygon") return;
    e.stopPropagation();
    e.preventDefault();

    setZones(prev => {
      const z = prev[zoneIdx];
      if (z.polygon.length <= 3) {
        return prev; // keep at least a triangle
      }
      const next = [...prev];
      const targetZ = { ...z };
      targetZ.polygon = targetZ.polygon.filter((_, idx) => idx !== pointIdx);
      next[zoneIdx] = targetZ;
      return next;
    });
  };

  // Preset Bounding Box Crop (Reset to nice central box)
  const handlePresetCrop = () => {
    setZones([
      {
        name: "active_zone",
        polygon: [
          { x: 0.15, y: 0.2 },
          { x: 0.85, y: 0.2 },
          { x: 0.85, y: 0.85 },
          { x: 0.15, y: 0.85 }
        ]
      }
    ]);
  };

  const handleReset = () => {
    setZones(initialBackupRef.current.zones);
    setLines(initialBackupRef.current.lines);
    setMode(initialBackupRef.current.mode);
    if (onSave) {
      onSave({
        geometry_type: initialBackupRef.current.mode,
        zones: initialBackupRef.current.zones,
        lines: initialBackupRef.current.lines
      });
    }
  };

  const handleToggleEditing = () => {
    const nextState = !isEditing;
    setIsEditing(nextState);
    if (!nextState && onSave) {
      onSave({
        geometry_type: mode,
        zones: mode === "polygon" ? zones : [],
        lines: mode === "line" ? lines : []
      });
    }
  };

  const activeZone = zones[0] || { name: "active_zone", polygon: [] };
  const activeLine = lines[0] || { start: { x: 0.1, y: 0.5 }, end: { x: 0.9, y: 0.5 } };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Top Visual Editor Toolbar */}
      <div className="flex items-center justify-between gap-2 px-1 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleEditing}
            className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-medium flex items-center gap-1.5 transition-all shadow-sm ${
              isEditing
                ? "bg-emerald-500 text-black font-semibold ring-2 ring-emerald-400/40"
                : "bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 border border-white/10"
            }`}
          >
            {isEditing ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : <Edit2 className="w-3.5 h-3.5" />}
            <span>{isEditing ? "Done Editing" : "Edit Geometry"}</span>
          </button>

          {isEditing && (
            <div className="flex items-center gap-1 bg-black/60 p-0.5 rounded-lg border border-white/10 text-[11px] font-mono">
              <button
                type="button"
                onClick={() => {
                  setMode("polygon");
                  if (onSave) onSave({ geometry_type: "polygon", zones, lines: [] });
                }}
                className={`px-2 py-0.5 rounded flex items-center gap-1 transition-all ${
                  mode === "polygon" ? "bg-emerald-500/25 text-emerald-300 font-semibold" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Square className="w-3 h-3" />
                <span>Zone</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("line");
                  if (onSave) onSave({ geometry_type: "line", zones: [], lines });
                }}
                className={`px-2 py-0.5 rounded flex items-center gap-1 transition-all ${
                  mode === "line" ? "bg-amber-500/25 text-amber-300 font-semibold" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Split className="w-3 h-3 rotate-45" />
                <span>Line</span>
              </button>
            </div>
          )}
        </div>

        {isEditing && (
          <div className="flex items-center gap-1.5">
            {mode === "polygon" && (
              <button
                type="button"
                onClick={handlePresetCrop}
                title="Reset to 4-corner crop box"
                className="px-2 py-0.5 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-white/10 text-[10px] font-mono flex items-center gap-1 transition-colors"
              >
                <span>Box Crop</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleReset}
              title="Reset to VLM Suggestion"
              className="p-1 rounded-lg bg-zinc-800/60 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
              {mode === "polygon" ? "Drag handles · Click edge to add point" : "Drag endpoints"}
            </span>
          </div>
        )}
      </div>

      {/* Video Container with Interactive SVG Canvas Overlay */}
      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`relative rounded-xl overflow-hidden bg-black shadow-xl select-none group border touch-none transition-all ${
          isFullscreen ? "w-full h-full max-h-screen" : "w-80 h-48"
        } ${isEditing ? "border-emerald-500/60 ring-2 ring-emerald-500/20 cursor-crosshair" : "border-white/10"}`}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          className="w-full h-full object-cover select-none pointer-events-none"
        />

        {/* SVG Drawing Canvas Layer */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ pointerEvents: isEditing ? "auto" : "none" }}
        >
          {/* 1. Polygon Zone Mode */}
          {mode === "polygon" &&
            zones.map((zone, zIdx) => {
              const poly = zone.polygon || [];
              if (poly.length < 3) return null;
              const pointsStr = poly.map(pt => `${pt.x * 100},${pt.y * 100}`).join(" ");

              return (
                <g key={zIdx}>
                  {/* Semi-transparent fill */}
                  <polygon
                    points={pointsStr}
                    fill="#10b981"
                    fillOpacity={isEditing ? 0.35 : 0.22}
                    stroke="#10b981"
                    strokeWidth={isEditing ? 2.4 : 1.8}
                    strokeLinejoin="round"
                    className="pointer-events-none"
                  />

                  {/* Edge segments (clickable to add vertex when editing) */}
                  {isEditing &&
                    poly.map((pt, pIdx) => {
                      const nextPt = poly[(pIdx + 1) % poly.length];
                      return (
                        <line
                          key={`edge-${pIdx}`}
                          x1={pt.x * 100}
                          y1={pt.y * 100}
                          x2={nextPt.x * 100}
                          y2={nextPt.y * 100}
                          stroke="transparent"
                          strokeWidth="8"
                          className="cursor-copy hover:stroke-white/50 transition-colors pointer-events-auto"
                          onClick={e => handleAddVertex(e, zIdx, pIdx)}
                        />
                      );
                    })}

                  {/* Vertices handles with generous transparent hit-box */}
                  {poly.map((pt, pIdx) => (
                    <g key={`v-group-${pIdx}`} className={isEditing ? "pointer-events-auto" : "pointer-events-none"}>
                      {/* Generous invisible target to make clicking/touch effortless */}
                      {isEditing && (
                        <circle
                          cx={pt.x * 100}
                          cy={pt.y * 100}
                          r={8}
                          fill="transparent"
                          className="cursor-grab active:cursor-grabbing pointer-events-auto"
                          onPointerDown={e => handlePointerDown(e, { type: "vertex", zoneIdx: zIdx, pointIdx: pIdx })}
                          onDoubleClick={e => handleDeleteVertex(e, zIdx, pIdx)}
                        />
                      )}
                      {/* Visible styled handle */}
                      <circle
                        cx={pt.x * 100}
                        cy={pt.y * 100}
                        r={isEditing ? 3.2 : 1.4}
                        fill="#ffffff"
                        stroke="#10b981"
                        strokeWidth={isEditing ? 1.8 : 0.8}
                        className={`pointer-events-none drop-shadow-md transition-transform ${
                          isEditing ? "ring-2 ring-emerald-400" : ""
                        }`}
                      />
                    </g>
                  ))}
                </g>
              );
            })}

          {/* 2. Line Crossing Mode */}
          {mode === "line" && (
            <g>
              {/* Background Glow */}
              <line
                x1={activeLine.start.x * 100}
                y1={activeLine.start.y * 100}
                x2={activeLine.end.x * 100}
                y2={activeLine.end.y * 100}
                stroke="#f59e0b"
                strokeWidth={isEditing ? 3.5 : 2.5}
                strokeDasharray="4 2"
                strokeLinecap="round"
                className="pointer-events-none"
              />

              {/* Start Handle */}
              <g className={isEditing ? "pointer-events-auto" : "pointer-events-none"}>
                {isEditing && (
                  <circle
                    cx={activeLine.start.x * 100}
                    cy={activeLine.start.y * 100}
                    r={9}
                    fill="transparent"
                    className="cursor-grab active:cursor-grabbing pointer-events-auto"
                    onPointerDown={e => handlePointerDown(e, { type: "line-endpoint", endpoint: "start" })}
                  />
                )}
                <circle
                  cx={activeLine.start.x * 100}
                  cy={activeLine.start.y * 100}
                  r={isEditing ? 3.6 : 1.8}
                  fill="#ffffff"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  className="pointer-events-none drop-shadow-md"
                />
              </g>

              {/* End Handle */}
              <g className={isEditing ? "pointer-events-auto" : "pointer-events-none"}>
                {isEditing && (
                  <circle
                    cx={activeLine.end.x * 100}
                    cy={activeLine.end.y * 100}
                    r={9}
                    fill="transparent"
                    className="cursor-grab active:cursor-grabbing pointer-events-auto"
                    onPointerDown={e => handlePointerDown(e, { type: "line-endpoint", endpoint: "end" })}
                  />
                )}
                <circle
                  cx={activeLine.end.x * 100}
                  cy={activeLine.end.y * 100}
                  r={isEditing ? 3.6 : 1.8}
                  fill="#ffffff"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  className="pointer-events-none drop-shadow-md"
                />
              </g>
            </g>
          )}
        </svg>

        {/* Live Pill Badge on Top Left */}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[10px] font-mono font-medium flex items-center gap-1.5 border border-white/10 pointer-events-none z-20">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              mode === "polygon" ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-pulse"
            }`}
          />
          <span className={mode === "polygon" ? "text-emerald-300" : "text-amber-300"}>
            {mode === "polygon" ? activeZone.name || "active_zone" : activeLine.name || "crossing_line"}
          </span>
          {isEditing && <span className="text-white/60 text-[9px]">(Editing)</span>}
        </div>

        {/* Video HUD Controls Overlay (Play/Pause, Fullscreen toggle) */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5 z-20">
          <button
            type="button"
            onClick={togglePlay}
            title={isPlaying ? "Pause video" : "Play video"}
            className="p-1.5 rounded-lg bg-black/70 hover:bg-black/90 backdrop-blur-sm text-zinc-300 hover:text-white border border-white/10 transition-colors pointer-events-auto"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Editor"}
            className="p-1.5 rounded-lg bg-black/70 hover:bg-black/90 backdrop-blur-sm text-zinc-300 hover:text-white border border-white/10 transition-colors pointer-events-auto"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GeometryEditor;
