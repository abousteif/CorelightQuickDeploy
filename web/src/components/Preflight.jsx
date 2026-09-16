// Shows machine readiness: Azure login, Terraform, detected public IP.
import React from "react";

function Row({ label, ok, children }) {
  return (
    <div className="pf-row">
      <span className={`pf-dot ${ok ? "ok" : "bad"}`} />
      <span className="pf-label">{label}</span>
      <span className="pf-detail">{children}</span>
    </div>
  );
}

export default function Preflight({ data, loading, onRefresh }) {
  if (loading && !data) return <div className="card"><h2>Preflight</h2><p className="muted">Checking your machine…</p></div>;
  if (!data) return null;

  const { terraform, azure, publicIp, platform } = data;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Preflight</h2>
        <button className="btn ghost" onClick={onRefresh} disabled={loading}>
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>

      <Row label="Azure CLI (optional)" ok={true}>
        {azure.loggedIn
          ? <>Logged in — <strong>{azure.subscriptionName}</strong> <span className="muted">({azure.subscriptionId})</span></>
          : <span className="muted">not logged in — sign in from the form instead (no CLI needed)</span>}
      </Row>

      <Row label="Terraform" ok={terraform.installed}>
        {terraform.installed
          ? <>v{terraform.version} {terraform.bundled ? <span className="muted">— bundled</span> : <span className="muted">— from PATH</span>}</>
          : <span className="bad-text">{terraform.error}</span>}
      </Row>

      <Row label="Your public IP" ok={!!publicIp.ip}>
        {publicIp.ip
          ? <>{publicIp.ip} <span className="muted">— will be allowed for SSH/UI</span></>
          : <span className="bad-text">{publicIp.error || "could not detect"}</span>}
      </Row>

      <p className="muted small">Platform: {platform}</p>
    </div>
  );
}
