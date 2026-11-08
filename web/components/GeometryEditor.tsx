import React, { useState, useRef, useEffect, useCallback } from "react";
import { Edit2, Check, RotateCcw, Split, Square, Trash2, Plus } from "lucide-react";

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
  const [isEditing, setIsEditing] = useState(false);
  const [mode, setMode] = useState<"polygon" | "line">("polygon");

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

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync when props change
  useEffect(() => {
    if (initialZones.length > 0) {
      setZones(initialZones);
      setMode("polygon");
    } else if (initialLines.length > 0) {
      setLines(initialLines);
      setMode("line");
    }
  }, [initialZones, initialLines]);

  const handlePointerDown = (
    e: React.PointerEvent,
    target: { type: "vertex" | "line-endpoint"; zoneIdx?: number; pointIdx?: number; endpoint?: "start" | "end" }
  ) => {
    if (!isEditing) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragState(target);
  };

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const rawX = (e.clientX - rect.left) / rect.width;
      const rawY = (e.clientY - rect.top) / rect.height;

      // Clamp between 0.0 and 1.0
      const clampedX = Math.max(0.01, Math.min(0.99, Number(rawX.toFixed(3))));
      const clampedY = Math.max(0.01, Math.min(0.99, Number(rawY.toFixed(3))));

      if (dragState.type === "vertex" && dragState.zoneIdx !== undefined && dragState.pointIdx !== undefined) {
        setZones(prev => {
          const next = [...prev];
          const targetZone = { ...next[dragState.zoneIdx!] };
          const targetPoly = [...targetZone.polygon];
          targetPoly[dragState.pointIdx!] = { x: clampedX, y: clampedY };
          targetZone.polygon = targetPoly;
          next[dragState.zoneIdx!] = targetZone;
          return next;
        });
      } else if (dragState.type === "line-endpoint" && dragState.endpoint) {
        setLines(prev => {
          const next = [...prev];
          const targetLine = { ...next[0] };
          targetLine[dragState.endpoint!] = { x: clampedX, y: clampedY };
          next[0] = targetLine;
          return next;
        });
      }
    },
    [dragState]
  );

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragState) {
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {}
      setDragState(null);
      // Auto-notify parent on modification
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
        className={`relative w-80 h-44 rounded-xl overflow-hidden bg-black shadow-xl select-none group border ${
          isEditing ? "border-emerald-500/60 ring-2 ring-emerald-500/20" : "border-white/10"
        }`}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          controls={!isEditing}
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
        />

        {/* SVG Drawing Canvas Layer */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
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
                    className="transition-all"
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
                          strokeWidth="6"
                          className="pointer-events-auto cursor-copy hover:stroke-white/40 transition-colors"
                          onClick={e => handleAddVertex(e, zIdx, pIdx)}
                        />
                      );
                    })}

                  {/* Vertices handles */}
                  {poly.map((pt, pIdx) => (
                    <circle
                      key={`v-${pIdx}`}
                      cx={pt.x * 100}
                      cy={pt.y * 100}
                      r={isEditing ? 2.6 : 1.3}
                      fill={isEditing ? "#ffffff" : "#ffffff"}
                      stroke="#10b981"
                      strokeWidth={isEditing ? 1.2 : 0.8}
                      className={isEditing ? "pointer-events-auto cursor-grab active:cursor-grabbing hover:scale-125 transition-transform" : "pointer-events-none"}
                      onPointerDown={e => handlePointerDown(e, { type: "vertex", zoneIdx: zIdx, pointIdx: pIdx })}
                      onDoubleClick={e => handleDeleteVertex(e, zIdx, pIdx)}
                    />
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
              />

              {/* Start Handle */}
              <circle
                cx={activeLine.start.x * 100}
                cy={activeLine.start.y * 100}
                r={isEditing ? 3.0 : 1.8}
                fill="#ffffff"
                stroke="#f59e0b"
                strokeWidth={1.5}
                className={isEditing ? "pointer-events-auto cursor-grab active:cursor-grabbing" : "pointer-events-none"}
                onPointerDown={e => handlePointerDown(e, { type: "line-endpoint", endpoint: "start" })}
              />

              {/* End Handle */}
              <circle
                cx={activeLine.end.x * 100}
                cy={activeLine.end.y * 100}
                r={isEditing ? 3.0 : 1.8}
                fill="#ffffff"
                stroke="#f59e0b"
                strokeWidth={1.5}
                className={isEditing ? "pointer-events-auto cursor-grab active:cursor-grabbing" : "pointer-events-none"}
                onPointerDown={e => handlePointerDown(e, { type: "line-endpoint", endpoint: "end" })}
              />
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
      </div>
    </div>
  );
};

export default GeometryEditor;
