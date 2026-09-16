// Live streaming log panel — renders SSE lines, auto-scrolls, shows the current phase.
import React, { useEffect, useRef } from "react";

export default function LogPanel({ lines, phase, running }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  return (
    <div className="card log-card">
      <div className="card-head">
        <h2>Deployment log</h2>
        <span className={`phase ${running ? "running" : ""}`}>{phase || "idle"}</span>
      </div>
      <div className="log">
        {lines.length === 0 && <div className="muted">No output yet. Fill the form and click Deploy.</div>}
        {lines.map((l, i) => (
          <div key={i} className={`log-line ${l.level || "info"}`}>
            <span className="ts">{l.ts}</span>
            <span className="txt">{l.line}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
