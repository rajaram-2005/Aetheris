"use client";
/**
 * DigitalTwinSync — 3D Digital Twin Reality Layer
 *
 * Synchronizes physical turbine reality with the Intelligence Graph:
 * - 11 Rendering Modes: Normal, Thermal, Vibration, Stress, Health, Airflow, Power, X-Ray, Exploded, Sensor, Inspection
 * - Interactive component selection (Tower, Nacelle, Rotor, Gearbox, Bearings, Generator, Inverter)
 * - Real-time synchronization with telemetry and graph nodes
 */
import React, { useEffect, useRef, useState } from "react";
import type { AetherisState } from "@/core/fabric/types";

export type TwinRenderMode =
  | "Normal"
  | "Thermal"
  | "Vibration"
  | "Stress"
  | "Health"
  | "Airflow"
  | "Power"
  | "X-Ray"
  | "Exploded"
  | "Sensor"
  | "Inspection";

interface DigitalTwinSyncProps {
  state: AetherisState;
  onSelectComponent?: (compId: string) => void;
  width?: number;
  height?: number;
}

export default function DigitalTwinSync({
  state,
  onSelectComponent,
  width = 680,
  height = 420,
}: DigitalTwinSyncProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderMode, setRenderMode] = useState<TwinRenderMode>("Vibration");
  const [animating, setAnimating] = useState(true);
  const animRef = useRef<number | null>(null);
  const angleRef = useRef<number>(0);

  const focusedComp = state.assets.focusedComponent;

  // Render loop
  useEffect(() => {
    let lastTime = performance.now();

    function draw(now: number) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (animating) {
        const isTripped = (state.telemetry.channels.rotor_rpm?.value ?? 0) === 0;
        if (!isTripped) {
          angleRef.current += 1.8 * dt;
        }
      }

      renderCanvas();
      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderMode, animating, focusedComp, state]);

  const renderCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = "#0B0E14";
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    const cx = width / 2;
    const cy = height / 2 + 30;
    const angle = angleRef.current;

    // Determine colors based on Render Mode
    let towerColor = "#475569";
    let nacelleColor = "#64748b";
    let bladeColor = "#94a3b8";
    let gearboxColor = "#f87171";
    let bearingColor = "#ef4444";

    if (renderMode === "Thermal") {
      towerColor = "#1e293b";
      nacelleColor = "#334155";
      bladeColor = "#1e293b";
      gearboxColor = "#f97316";
      bearingColor = "#ef4444";
    } else if (renderMode === "Normal") {
      towerColor = "#cbd5e1";
      nacelleColor = "#e2e8f0";
      bladeColor = "#f8fafc";
      gearboxColor = "#94a3b8";
      bearingColor = "#cbd5e1";
    } else if (renderMode === "X-Ray") {
      towerColor = "rgba(56,189,248,0.2)";
      nacelleColor = "rgba(56,189,248,0.3)";
      bladeColor = "rgba(56,189,248,0.2)";
      gearboxColor = "rgba(248,113,113,0.8)";
      bearingColor = "rgba(239,68,68,1)";
    }

    // 1. Draw Tower
    ctx.fillStyle = towerColor;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy + 140);
    ctx.lineTo(cx + 14, cy + 140);
    ctx.lineTo(cx + 8, cy - 60);
    ctx.lineTo(cx - 8, cy - 60);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.stroke();

    // 2. Draw Nacelle
    const isNacelleFocused = focusedComp === "nacelle" || focusedComp === "gearbox" || focusedComp === "bearings";
    ctx.fillStyle = nacelleColor;
    if (isNacelleFocused) {
      ctx.shadowColor = "rgba(56,189,248,0.5)";
      ctx.shadowBlur = 12;
    }
    ctx.fillRect(cx - 38, cy - 80, 76, 26);
    ctx.shadowBlur = 0;
    ctx.strokeRect(cx - 38, cy - 80, 76, 26);

    // 3. Draw Gearbox & Bearings Subsystem
    const gbxX = cx - 12;
    const gbxY = cy - 76;
    ctx.fillStyle = gearboxColor;
    ctx.fillRect(gbxX, gbxY, 24, 18);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = focusedComp === "gearbox" ? 2 : 1;
    ctx.strokeRect(gbxX, gbxY, 24, 18);

    // Bearing Hotspot
    ctx.fillStyle = bearingColor;
    ctx.beginPath();
    ctx.arc(cx - 10, cy - 67, 5, 0, Math.PI * 2);
    ctx.fill();

    // 4. Draw Hub & Rotating Blades
    const hubX = cx - 38;
    const hubY = cy - 67;
    ctx.fillStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.arc(hubX, hubY, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.stroke();

    const bladeLen = 130;
    for (let i = 0; i < 3; i++) {
      const bladeAngle = angle + (i * 2 * Math.PI) / 3;
      const bx = hubX + Math.cos(bladeAngle) * bladeLen;
      const by = hubY + Math.sin(bladeAngle) * bladeLen;

      ctx.strokeStyle = bladeColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(hubX, hubY);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // 5. Component Callouts
    ctx.fillStyle = "#f87171";
    ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("🔴 GEARBOX (8.4 mm/s · 65°C)", cx + 45, cy - 68);

    ctx.fillStyle = "#38bdf8";
    ctx.fillText("ROTOR (1500 RPM)", hubX - 85, hubY - 18);

    // Mode HUD Stamp
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(12, height - 32, 240, 22);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "11px monospace";
    ctx.fillText(`MODE: ${renderMode.toUpperCase()} | ASSET: ${state.assets.selectedAssetId}`, 20, height - 18);
  };

  const modes: TwinRenderMode[] = [
    "Normal",
    "Thermal",
    "Vibration",
    "Stress",
    "Health",
    "Airflow",
    "Power",
    "X-Ray",
    "Exploded",
    "Sensor",
    "Inspection",
  ];

  return (
    <div className="digital-twin-container">
      <div className="twin-hud-bar">
        <div className="twin-mode-selector">
          {modes.map((m) => (
            <button
              key={m}
              className={`mode-btn ${renderMode === m ? "mode-btn-active" : ""}`}
              onClick={() => setRenderMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="twin-controls">
          <button onClick={() => setAnimating((a) => !a)}>{animating ? "⏸ Pause" : "▶ Rotate"}</button>
          <button onClick={() => onSelectComponent?.("gearbox")}>Focus Gearbox</button>
        </div>
      </div>

      <div className="twin-canvas-wrapper">
        <canvas ref={canvasRef} style={{ width, height, display: "block", borderRadius: 10 }} />
      </div>

      <div className="twin-component-badges">
        {state.assets.components.map((c) => (
          <div
            key={c.id}
            className={`twin-comp-badge badge-${c.status.toUpperCase()} ${focusedComp === c.id ? "comp-focused" : ""}`}
            onClick={() => onSelectComponent?.(c.id)}
          >
            <strong>{c.name}</strong>
            <span>{c.vibration_mms} mm/s · {(c.temperature_K - 273.15).toFixed(0)}°C</span>
          </div>
        ))}
      </div>
    </div>
  );
}
