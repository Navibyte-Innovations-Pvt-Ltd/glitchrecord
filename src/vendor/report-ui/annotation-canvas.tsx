// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
"use client";

import { useEffect, useRef, useState } from "react";
import { encodeScreenshot } from "./image-encode";

type Point = { x: number; y: number };

type Stroke =
  | { type: "freehand"; color: string; width: number; points: Point[] }
  | { type: "circle"; color: string; width: number; cx: number; cy: number; r: number };

const PALETTE = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"];

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.type === "freehand") {
    if (s.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

interface AnnotationCanvasProps {
  imageSrc: string;
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}

/** Freehand + circle annotation overlay for a screenshot preview — draws directly on a canvas sized to the image's natural resolution, composited on save. */
export function AnnotationCanvas({ imageSrc, onSave, onCancel }: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<"pen" | "circle">("pen");
  const [color, setColor] = useState(PALETTE[0]);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      setReady(true);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(ctx, s);
    if (currentStroke) drawStroke(ctx, currentStroke);
  }, [ready, strokes, currentStroke]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = getPos(e);
    setCurrentStroke(
      tool === "pen"
        ? { type: "freehand", color, width: strokeWidth, points: [{ x, y }] }
        : { type: "circle", color, width: strokeWidth, cx: x, cy: y, r: 0 },
    );
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentStroke) return;
    const { x, y } = getPos(e);
    setCurrentStroke((prev) => {
      if (!prev) return prev;
      if (prev.type === "freehand") return { ...prev, points: [...prev.points, { x, y }] };
      return { ...prev, r: Math.hypot(x - prev.cx, y - prev.cy) };
    });
  };

  const handlePointerUp = () => {
    setCurrentStroke((prev) => {
      if (prev) setStrokes((s) => [...s, prev]);
      return null;
    });
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Annotating re-encodes an already-JPEG image, so quality is chosen by the
    // shared budget ladder rather than a fixed low value — a second lossy pass
    // at 0.85 was visibly degrading text.
    onSave(encodeScreenshot(canvas));
  };

  const iconBtn = (active = false): React.CSSProperties => ({
    width: "30px",
    height: "30px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "6px",
    border: `1.5px solid ${active ? "#22d3ee" : "rgba(255,255,255,0.15)"}`,
    background: active ? "rgba(34,211,238,0.15)" : "transparent",
    color: "#fff",
    cursor: "pointer",
    padding: 0,
  });

  return (
    <div
      data-glitchgrab-layer=""
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        backgroundColor: "rgba(0,0,0,0.9)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          maxWidth: "100%",
          maxHeight: "calc(100vh - 140px)",
          borderRadius: "8px",
          touchAction: "none",
          cursor: "crosshair",
          display: "block",
        }}
      />

      <div
        style={{
          marginTop: "14px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: "100%",
        }}
      >
        <button type="button" onClick={() => setTool("pen")} style={iconBtn(tool === "pen")} title="Freehand" aria-label="Freehand tool">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" onClick={() => setTool("circle")} style={iconBtn(tool === "circle")} title="Circle" aria-label="Circle tool">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>

        <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.15)" }} />

        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Color ${c}`}
            style={{
              width: "22px",
              height: "22px",
              borderRadius: "50%",
              background: c,
              border: color === c ? "2px solid #22d3ee" : "2px solid rgba(255,255,255,0.3)",
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          title="Custom color"
          aria-label="Custom color"
          style={{
            width: "22px",
            height: "22px",
            padding: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
          }}
        />

        <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.15)" }} />

        <input
          type="range"
          min={2}
          max={12}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          title="Stroke width"
          aria-label="Stroke width"
          style={{ width: "70px" }}
        />

        <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.15)" }} />

        <button
          type="button"
          onClick={() => setStrokes((s) => s.slice(0, -1))}
          disabled={strokes.length === 0}
          style={{ ...iconBtn(), opacity: strokes.length === 0 ? 0.35 : 1 }}
          title="Undo"
          aria-label="Undo"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setStrokes([])}
          disabled={strokes.length === 0}
          style={{ ...iconBtn(), opacity: strokes.length === 0 ? 0.35 : 1 }}
          title="Clear all"
          aria-label="Clear all"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6h12z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: "1.5px solid rgba(255,255,255,0.2)",
            background: "transparent",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: "none",
            background: "#22d3ee",
            color: "#09090b",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Save annotation
        </button>
      </div>
    </div>
  );
}
