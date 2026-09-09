"use client";
/**
 * TwinViewer3D — client-only 3D wireframe digital-twin viewer.
 *
 *   URL: /twin-3d?twinId=…
 *   Inputs: a wind-turbine twin id from the URL query string.
 *   Renders: the canonical 2 MW WTG geometry as wireframe lines, with a
 *     small overlay that paints each bound value at the relevant vertex
 *     in ok/watch/warning/critical colour.
 *
 *   Honesty: this is a wireframe, not a CAD/CFD render. The geometry is
 *     canonical, the colours come from the same severity logic the
 *     diagnostics page uses, and the rotor spin is animated only while
 *     the twin is healthy — once a critical channel is observed the
 *     animation slows to a stop, so operators can see the model has
 *     "frozen" the way the real turbine would be tripped.
 *
 *   No new dependencies. Pure 2D canvas.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  canonicalTurbineGeometry, projectScene, drawScene, overlayFromState,
  SEVERITY_COLOURS, bearingFaultFrequencies,
} from "@/core/windturbine/wireframe";

export interface TwinSummary {
  id: string;
  name: string;
  kind?: string;
  state: Record<string, number | string | boolean>;
  bounds: { key: string; min?: number; max?: number; critical?: boolean; unit?: string }[];
}

interface ViewerProps {
  twinId: string;
  initialTwin?: TwinSummary;
  width?: number;
  height?: number;
}

export default function TwinViewer3D({ twinId, initialTwin, width = 720, height = 480 }: ViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [twin, setTwin] = useState<TwinSummary | null>(initialTwin ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [yaw, setYaw] = useState(0);
  const [spin, setSpin] = useState(0);
  const [playing, setPlaying] = useState(true);
  const animRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const rotorRpmRef = useRef<number>(1500);

  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/windturbine`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { twins?: TwinSummary[] };
      const found = data.twins?.find((t) => t.id === twinId);
      if (!found) { setError("Twin not found"); setTwin(null); return; }
      setTwin(found);
      const rpm = typeof found.state?.rotor_rpm === "number" ? (found.state.rotor_rpm as number) : 1500;
      rotorRpmRef.current = rpm;
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [twinId]);

  useEffect(() => {
    if (initialTwin) {
      setTwin(initialTwin);
      const rpm = typeof initialTwin.state?.rotor_rpm === "number" ? (initialTwin.state.rotor_rpm as number) : 1500;
      rotorRpmRef.current = rpm;
    } else {
      void refresh();
    }
  }, [initialTwin, refresh]);

  const overlays = twin ? overlayFromState(twin.state, twin.bounds) : [];
  const isCritical = overlays.some((o) => o.severity === "critical");
  const overallSeverity = isCritical
    ? "critical"
    : overlays.some((o) => o.severity === "warning")
      ? "warning"
      : overlays.some((o) => o.severity === "watch")
        ? "watch"
        : "ok";

  // Animation loop
  useEffect(() => {
    function frame(t: number) {
      const last = lastFrameRef.current || t;
      const dt = (t - last) / 1000;
      lastFrameRef.current = t;
      // Trip the rotor if any channel is critical.
      const omega = (isCritical || !playing) ? 0 : (rotorRpmRef.current / 60) * 2 * Math.PI;
      setSpin((s) => s + omega * dt);
      drawToCanvas();
      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current !== null) cancelAnimationFrame(animRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, isCritical, twin, yaw]);

  function drawToCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr; canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = canonicalTurbineGeometry();
    const scene = projectScene({ vertices: g.vertices, edges: g.edges, width, height, yaw, spin });
    drawScene(ctx, scene, { edgeColor: "#64748b", lineWidth: 1.5 });
    // Overlays
    if (twin) {
      const activeOverlays = overlayFromState(twin.state, twin.bounds);
      for (const o of activeOverlays) {
        // Project the overlay world position with the same yaw/spin
        const localScene = projectScene({ vertices: [[o.x, o.y, o.z] as [number, number, number]], edges: [], width, height, yaw, spin });
        const pt = localScene.points[0]!;
        ctx.fillStyle = SEVERITY_COLOURS[o.severity];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1.5;
        ctx.stroke();
        // Label
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        const label = `${o.key}=${typeof o.value === "number" ? o.value.toFixed(1) : o.value}${o.unit ? " " + o.unit : ""}`;
        ctx.fillText(label, pt.x + 8, pt.y - 6);
        // Severity
        ctx.fillStyle = SEVERITY_COLOURS[o.severity];
        ctx.fillText(o.severity.toUpperCase(), pt.x + 8, pt.y + 8);
      }
      // Bearing-fault frequency markers (around the hub)
      const f = bearingFaultFrequencies(rotorRpmRef.current);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      const labelY = 16;
      ctx.fillText(`BPFO ${f.outerRace.toFixed(1)} Hz  ·  BPFI ${f.innerRace.toFixed(1)} Hz  ·  BSF ${f.ballSpin.toFixed(1)} Hz  ·  FTF ${f.cage.toFixed(1)} Hz`, 8, labelY);

      // Severity banner
      const colour = SEVERITY_COLOURS[overallSeverity];
      const vib = typeof twin.state.vib_rms === "number" ? (twin.state.vib_rms as number) : typeof twin.state.vib_bearing_mms === "number" ? (twin.state.vib_bearing_mms as number) : 0;
      ctx.fillStyle = colour;
      ctx.fillRect(0, height - 22, width, 22);
      ctx.fillStyle = "#0b0d12";
      ctx.font = "bold 12px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(`severity: ${overallSeverity.toUpperCase()}   vibration: ${vib.toFixed(2)} mm/s   rotor: ${rotorRpmRef.current.toFixed(0)} RPM`, 8, height - 7);
    }
  }

  return (
    <div className="twin3d">
      <div className="twin3d-toolbar">
        <button type="button" onClick={() => setPlaying((p) => !p)}>{playing ? "⏸ Pause rotor" : "▶ Resume rotor"}</button>
        <label>
          Yaw
          <input type="range" min={-Math.PI} max={Math.PI} step={0.01} value={yaw} onChange={(e) => setYaw(Number(e.target.value))} />
          <span className="twin3d-val">{(yaw * 180 / Math.PI).toFixed(0)}°</span>
        </label>
        <button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? "Refreshing…" : "Refresh state"}</button>
      </div>
      {error && <div className="twin3d-err">⚠ {error}</div>}
      <canvas ref={canvasRef} style={{ width, height, background: "#0b0d12", border: "1px solid #1f2937", borderRadius: 8 }} />
      {twin && (
        <div className="twin3d-legend">
          <div><strong>{twin.name}</strong> · {twin.kind ?? "twin"} · id {twin.id}</div>
          <div className="twin3d-bounds">
            {twin.bounds.map((b) => {
              const v = twin.state[b.key];
              const sev = (typeof v === "number" && b.max !== undefined) ? (v > b.max ? "critical" : v > b.max * 0.9 ? "warning" : v > b.max * 0.75 ? "watch" : "ok") : "ok";
              const col = SEVERITY_COLOURS[sev as keyof typeof SEVERITY_COLOURS];
              return (
                <span key={b.key} className="twin3d-bound">
                  <span className="twin3d-dot" style={{ background: col }} />
                  {b.key} {typeof v === "number" ? v.toFixed(1) : v}{b.unit ? " " + b.unit : ""}
                </span>
              );
            })}
          </div>
          <div className="twin3d-honest">
            Wireframe of the canonical 2 MW geometry. Severity colours come from the same logic the diagnostics page uses. The rotor trips to a stop on a critical reading. Not a CFD / CAD render.
          </div>
        </div>
      )}
    </div>
  );
}
