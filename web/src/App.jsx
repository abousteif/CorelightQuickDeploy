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
    subscriptionId: "",
    region: DEFAULTS.region,
    vmSize: DEFAULTS.vmSize,
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
  });
  const [lines, setLines] = useState([]);
  const [phase, setPhase] = useState("idle");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

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
          subscriptionId: form.subscriptionId,
          region: form.region,
          vmSize: form.vmSize,
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
          <h1>Corelight Azure Deployer</h1>
          <p className="muted">One-button Fleet Manager + sensor deployment · <span className="badge">M5 · complete</span></p>
        </div>
      </header>

      <main className="layout">
        <div className="col">
          <Preflight data={pf} loading={pfLoading} onRefresh={loadPreflight} />
          <DeployForm form={form} setField={setField} onDeploy={onDeploy} running={running} />
        </div>
        <div className="col">
          <LogPanel lines={lines} phase={phase} running={running} />
          {results && <Results data={results} />}
        </div>
      </main>
    </div>
  );
}
