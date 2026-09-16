import React, { useCallback, useEffect, useState } from "react";
import Preflight from "./components/Preflight.jsx";
import DeployForm from "./components/DeployForm.jsx";
import LogPanel from "./components/LogPanel.jsx";
import Results from "./components/Results.jsx";
import { DEFAULTS } from "./constants.js";

const now = () => new Date().toLocaleTimeString();

export default function App() {
  const [pf, setPf] = useState(null);
  const [pfLoading, setPfLoading] = useState(true);
  const [form, setForm] = useState({
    cloud: DEFAULTS.cloud,
    subscriptionId: "",
    region: DEFAULTS.region,
    fleetVmSize: DEFAULTS.fleetVmSize,
    sensorVmSize: DEFAULTS.sensorVmSize,
    sensorCount: DEFAULTS.sensorCount,
    deployFleet: DEFAULTS.deployFleet,
    communityString: DEFAULTS.communityString,
    fleetRepoToken: "",
    sensorRepoToken: "",
    fleetPem: null,
    sensorLicense: null,
    existingFleetAddr: "",
    existingFleetSslname: "",
    existingFleetUser: "",
    existingFleetPass: "",
    existingFleetTokens: "",
    azureSessionId: "",
  });
  const [lines, setLines] = useState([]);
  const [phase, setPhase] = useState("idle");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  // In-app Azure sign-in (device code) — replaces the az CLI dependency.
  const [azure, setAzure] = useState({ status: "idle", sessionId: null, userCode: null, verificationUri: null, message: null, user: null, subscriptions: [], error: null });

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Kick off a device-code sign-in; the polling effect below drives it to completion.
  const startAzureLogin = useCallback(async () => {
    setAzure((a) => ({ ...a, status: "starting", error: null }));
    try {
      const r = await fetch("/api/azure/login/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setAzure((a) => ({ ...a, status: "pending", sessionId: data.sessionId, userCode: data.userCode, verificationUri: data.verificationUri, message: data.message }));
    } catch (e) {
      setAzure((a) => ({ ...a, status: "error", error: e.message }));
    }
  }, []);

  // Poll sign-in status while pending; on success, load subscriptions and record the session.
  useEffect(() => {
    if (azure.status !== "pending" || !azure.sessionId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/azure/login/status?sessionId=${encodeURIComponent(azure.sessionId)}`);
        const st = await r.json();
        if (stop) return;
        if (st.status === "authenticated") {
          const sr = await fetch(`/api/azure/subscriptions?sessionId=${encodeURIComponent(azure.sessionId)}`);
          const sd = await sr.json();
          const subs = sd.subscriptions || [];
          setAzure((a) => ({ ...a, status: "authenticated", user: st.user, subscriptions: subs }));
          setForm((f) => ({ ...f, azureSessionId: azure.sessionId, subscriptionId: f.subscriptionId || subs[0]?.subscriptionId || "" }));
        } else if (st.status === "error" || st.status === "unknown") {
          setAzure((a) => ({ ...a, status: "error", error: st.error || "sign-in failed" }));
        }
      } catch { /* transient; keep polling */ }
    };
    const iv = setInterval(tick, 2500);
    tick();
    return () => { stop = true; clearInterval(iv); };
  }, [azure.status, azure.sessionId]);

  const loadPreflight = useCallback(async () => {
    setPfLoading(true);
    try {
      const r = await fetch("/api/preflight");
      const data = await r.json();
      setPf(data);
      // Prefill subscription from the logged-in az session if the field is empty.
      setForm((f) => (f.subscriptionId || !data?.azure?.subscriptionId ? f : { ...f, subscriptionId: data.azure.subscriptionId }));
    } catch (e) {
      setPf({ ready: false, terraform: { installed: false, error: String(e) }, azure: { loggedIn: false }, publicIp: {} });
    } finally {
      setPfLoading(false);
    }
  }, []);

  useEffect(() => { loadPreflight(); }, [loadPreflight]);

  const addLine = (l) => setLines((prev) => [...prev, { ts: now(), ...l }]);

  // Read a File as base64 (no data: prefix) for JSON upload.
  const fileToB64 = (file) =>
    new Promise((resolve) => {
      if (!file) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] || null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(file);
    });

  // dryRun=true → terraform plan only (safe preview, no resources created).
  const onDeploy = async (dryRun = false) => {
    setLines([]);
    setResults(null);
    setRunning(true);
    setPhase("starting");
    addLine({ level: "info", line: dryRun ? "Starting preview (terraform plan)…" : "Starting deployment…" });

    // 1. POST the form to create a run. Uploads travel as base64 (plan skips them).
    let runId;
    try {
      const [fleetPemB64, sensorLicenseB64] = dryRun
        ? [null, null]
        : await Promise.all([fileToB64(form.fleetPem), fileToB64(form.sensorLicense)]);
      const r = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloud: form.cloud,
          subscriptionId: form.subscriptionId,
          region: form.region,
          fleetVmSize: form.fleetVmSize,
          sensorVmSize: form.sensorVmSize,
          sensorCount: Number(form.sensorCount),
          deployFleet: form.deployFleet,
          communityString: form.communityString,
          fleetRepoToken: form.fleetRepoToken,
          sensorRepoToken: form.sensorRepoToken,
          fleetPemB64,
          sensorLicenseB64,
          existingFleetAddr: form.existingFleetAddr,
          existingFleetSslname: form.existingFleetSslname,
          existingFleetUser: form.existingFleetUser,
          existingFleetPass: form.existingFleetPass,
          existingFleetTokens: form.existingFleetTokens,
          azureSessionId: form.azureSessionId,
          publicIp: pf?.publicIp?.ip || null,
          dryRun,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      runId = data.runId;
    } catch (e) {
      addLine({ level: "error", line: `Could not start run: ${e.message}` });
      setRunning(false);
      setPhase("error");
      return;
    }

    // 2. Attach to the SSE stream for that run.
    const es = new EventSource(`/api/deploy/stream?runId=${encodeURIComponent(runId)}`);
    es.addEventListener("log", (e) => addLine(JSON.parse(e.data)));
    es.addEventListener("status", (e) => setPhase(JSON.parse(e.data).phase));
    es.addEventListener("results", (e) => setResults(JSON.parse(e.data)));
    es.addEventListener("end", () => { es.close(); setRunning(false); });
    es.onerror = () => { es.close(); setRunning(false); };
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Corelight Quick Deploy</h1>
          <p className="muted">
            One-button Fleet Manager + sensor deployment ·{" "}
            <span className="badge" title={`Built ${new Date(__BUILD_TIME__).toLocaleString()}`}>
              v{__APP_VERSION__} · built {new Date(__BUILD_TIME__).toLocaleDateString()} {new Date(__BUILD_TIME__).toLocaleTimeString()}
            </span>
          </p>
        </div>
      </header>

      <main className="layout">
        <div className="col">
          <Preflight data={pf} loading={pfLoading} onRefresh={loadPreflight} />
          <DeployForm form={form} setField={setField} onDeploy={onDeploy} running={running} azure={azure} onAzureLogin={startAzureLogin} />
        </div>
        <div className="col">
          <LogPanel lines={lines} phase={phase} running={running} />
          {results && <Results data={results} />}
        </div>
      </main>
    </div>
  );
}
