// The single deploy form. Kept intentionally short — most settings are defaulted.
import React from "react";
import { REGIONS, VM_SIZES } from "../constants.js";

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export default function DeployForm({ form, setField, onDeploy, running }) {
  const size = VM_SIZES.find((s) => s.value === form.vmSize);
  const set = (k) => (e) => setField(k, e.target.type === "checkbox" ? e.target.checked : e.target.value);
  const setFile = (k) => (e) => setField(k, e.target.files?.[0] || null);

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onDeploy(); }}>
      <h2>Deploy</h2>

      <Field label="Azure subscription ID" hint="Uses your existing `az login` session.">
        <input value={form.subscriptionId} onChange={set("subscriptionId")} placeholder="00000000-0000-0000-0000-000000000000" required />
      </Field>

      <div className="grid2">
        <Field label="Region">
          <select value={form.region} onChange={set("region")}>
            {REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>

        <Field label="VM size">
          <select value={form.vmSize} onChange={set("vmSize")}>
            {VM_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
      </div>
      {size?.mlWarn && <p className="warn small">⚠ {size.label} is below the 8 vCPU / 32 GiB needed for ML / Anomaly Engine — those features will be disabled on sensors.</p>}

      <Field label="Number of sensors">
        <input type="number" min="0" max="20" value={form.sensorCount} onChange={set("sensorCount")} />
      </Field>

      <label className="check">
        <input type="checkbox" checked={form.deployFleet} onChange={set("deployFleet")} />
        <span>Deploy a Fleet Manager server (uncheck to pair sensors to an existing Fleet)</span>
      </label>

      {form.deployFleet ? (
        <>
          <Field label="Fleet repo token" hint="Your Corelight fleet-stable pull token.">
            <input value={form.fleetRepoToken} onChange={set("fleetRepoToken")} type="password" autoComplete="off" />
          </Field>
          <Field label="Fleet PEM (cert + license)" hint="Combined PEM. Installed on the Fleet VM; never leaves your machine except onto your Azure VM.">
            <input type="file" accept=".pem,.crt,.cer" onChange={setFile("fleetPem")} />
          </Field>
          <Field label="Community string">
            <input value={form.communityString} onChange={set("communityString")} />
          </Field>
        </>
      ) : (
        <div className="subpanel">
          <p className="muted small">Existing Fleet — sensors will pair to it.</p>
          <Field label="Fleet pairing address (host:port)"><input value={form.existingFleetAddr} onChange={set("existingFleetAddr")} placeholder="10.50.0.x:1443" /></Field>
          <Field label="Fleet server_sslname"><input value={form.existingFleetSslname} onChange={set("existingFleetSslname")} placeholder="internal.<...>.corelight.io" /></Field>
          <div className="grid2">
            <Field label="Fleet admin user" hint="Used to auto-mint per-sensor tokens."><input value={form.existingFleetUser} onChange={set("existingFleetUser")} autoComplete="off" /></Field>
            <Field label="Fleet admin password"><input value={form.existingFleetPass} onChange={set("existingFleetPass")} type="password" autoComplete="off" /></Field>
          </div>
        </div>
      )}

      <Field label="Sensor BYOL repo token" hint="Your Corelight sensor-stable pull token.">
        <input value={form.sensorRepoToken} onChange={set("sensorRepoToken")} type="password" autoComplete="off" />
      </Field>
      <Field label="Sensor license" hint="Applied to each sensor.">
        <input type="file" accept=".lic,.license,.txt,.json" onChange={setFile("sensorLicense")} />
      </Field>

      <div className="grid2">
        <button className="btn" type="button" disabled={running} onClick={() => onDeploy(true)}>
          Preview (plan)
        </button>
        <button className="btn primary" type="submit" disabled={running}>
          {running ? "Working…" : "Deploy"}
        </button>
      </div>
      <p className="muted small">M2: <strong>Preview</strong> runs <code>terraform plan</code> (safe, no resources). <strong>Deploy</strong> builds the VNet, NSG, optional Fleet VM and sensor VMs in Azure. Fleet install + sensor pairing arrive in M3/M4; the PEM, tokens and license fields aren’t used yet.</p>
    </form>
  );
}
