import React, { useCallback, useEffect, useState } from "react";
import Preflight from "./components/Preflight.jsx";
import DeployForm from "./components/DeployForm.jsx";
import LogPanel from "./components/LogPanel.jsx";
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
  });
  const [lines, setLines] = useState([]);
  const [phase, setPhase] = useState("idle");
  const [running, setRunning] = useState(false);

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

  const onDeploy = () => {
    setLines([]);
    setRunning(true);
    setPhase("starting");
    const qs = new URLSearchParams({ sensors: String(form.sensorCount), deployFleet: String(form.deployFleet) });
    const es = new EventSource(`/api/deploy/stream?${qs}`);
    es.addEventListener("log", (e) => addLine(JSON.parse(e.data)));
    es.addEventListener("status", (e) => setPhase(JSON.parse(e.data).phase));
    es.addEventListener("error", () => { es.close(); setRunning(false); });
    // Server ends the stream on completion; EventSource fires onerror on close.
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Corelight Azure Deployer</h1>
          <p className="muted">One-button Fleet Manager + sensor deployment · <span className="badge">M1 scaffold</span></p>
        </div>
      </header>

      <main className="layout">
        <div className="col">
          <Preflight data={pf} loading={pfLoading} onRefresh={loadPreflight} />
          <DeployForm form={form} setField={setField} onDeploy={onDeploy} running={running} />
        </div>
        <div className="col">
          <LogPanel lines={lines} phase={phase} running={running} />
        </div>
      </main>
    </div>
  );
}
