"use client";
/**
 * /incident — AETHERIS v2 Incident Command Center
 *
 * Provides high-severity asset response console when critical anomalies or
 * threshold breaches are detected.
 */
import React, { useEffect, useState } from "react";
import Link from "next/link";
import IncidentCommand from "@/components/IncidentCommand";
import type { IncidentState } from "@/core/controlplane/incident/command";

export default function IncidentPage() {
  const [incident, setIncident] = useState<IncidentState | null>(null);

  const loadIncident = async () => {
    try {
      const res = await fetch("/api/incident");
      if (res.ok) {
        const data = await res.json();
        setIncident(data.incident);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void loadIncident();
  }, []);

  return (
    <div className="incident-page">
      <header className="incident-page-head">
        <div>
          <h1>🚨 Incident Command Center</h1>
          <p>
            Emergency supervisory console for high-severity turbine anomalies, bearing defects,
            and safety interlock events.
          </p>
        </div>
        <div>
          <Link href="/control-plane" className="incident-back-btn">← Outer Control Plane</Link>
        </div>
      </header>

      {incident ? (
        <IncidentCommand incident={incident} onDispatchAction={() => void loadIncident()} />
      ) : (
        <div className="incident-empty-state">
          <p>✓ All assets operating within normal nominal bounds. No active incidents.</p>
        </div>
      )}
    </div>
  );
}
