// The single deploy form. Kept intentionally short — most settings are defaulted.
import React from "react";
import { CLOUD_PROVIDERS, REGIONS, VM_SIZES } from "../constants.js";

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export default function DeployForm({ form, setField, onDeploy, running, azure = { status: "idle" }, onAzureLogin }) {
  const set = (k) => (e) => setField(k, e.target.type === "checkbox" ? e.target.checked : e.target.value);
  const setFile = (k) => (e) => setField(k, e.target.files?.[0] || null);
  const cloud = form.cloud || "azure";
  const isAzure = cloud === "azure";

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (isAzure) onDeploy(); }}>
      <h2>Deploy</h2>

      <Field label="Cloud provider" hint="Where the Fleet Manager and sensors will be deployed.">
        <div className="cloud-tabs">
          {CLOUD_PROVIDERS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`cloud-tab${cloud === c.value ? " active" : ""}${c.enabled ? "" : " disabled"}`}
              aria-pressed={cloud === c.value}
              onClick={() => setField("cloud", c.value)}
            >
              {c.label}
              {c.badge && <span className="pill">{c.badge}</span>}
            </button>
          ))}
        </div>
      </Field>

      {!isAzure && (
        <div className="subpanel aws-facade">
          <p className="muted">🚧 <strong>AWS support is coming in a future release.</strong> Sensor and Fleet deployment into AWS isn’t wired up yet — this option is a placeholder so the workflow is ready for it. For now, choose <strong>Microsoft Azure</strong> above to deploy.</p>
        </div>
      )}

      {isAzure && (<>
      <div className="subpanel">
        <span className="field-label">Azure sign-in</span>
        {azure.status === "authenticated" ? (
          <>
            <p className="muted small">✓ Signed in{azure.user ? <> as <strong>{azure.user}</strong></> : null}. A short-lived service principal is created automatically at deploy time — no Azure CLI needed.</p>
            <Field label="Subscription" hint="Where the Fleet + sensors will be deployed.">
              <select value={form.subscriptionId} onChange={set("subscriptionId")}>
                {(azure.subscriptions || []).map((s) => (
                  <option key={s.subscriptionId} value={s.subscriptionId}>{s.displayName} ({s.subscriptionId})</option>
                ))}
              </select>
            </Field>
          </>
        ) : azure.status === "pending" ? (
          <p className="muted small">
            Open <a href={azure.verificationUri} target="_blank" rel="noreferrer">{azure.verificationUri}</a> and enter code <code>{azure.userCode}</code>, then finish signing in. Waiting…
          </p>
        ) : (
          <>
            <p className="muted small">Sign in with your browser (no <code>az</code> CLI required), or enter a subscription ID below if you already have <code>az login</code> active.</p>
            <button className="btn" type="button" disabled={azure.status === "starting"} onClick={() => onAzureLogin?.()}>
              {azure.status === "starting" ? "Starting…" : "Sign in to Azure"}
            </button>
            {azure.status === "error" && <p className="warn small">⚠ {azure.error}</p>}
            <Field label="Azure subscription ID" hint="Only needed if you're relying on an existing `az login` session.">
              <input value={form.subscriptionId} onChange={set("subscriptionId")} placeholder="00000000-0000-0000-0000-000000000000" />
            </Field>
          </>
        )}
      </div>

      <details className="subpanel">
        <summary>Advanced — use an existing service principal (optional)</summary>
        <p className="muted small">
          Use this if your tenant blocks browser sign-in from creating app registrations
          (a <code>403 Insufficient privileges</code> during deploy). Have an Azure admin create a
          service principal with the <strong>Contributor</strong> role on the subscription, then paste
          its values here. When all three are filled they’re used instead of browser sign-in. Secrets
          stay local and are written only to the gitignored run workspace.
        </p>
        <Field label="Service principal — Client ID (app ID)">
          <input value={form.spClientId} onChange={set("spClientId")} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" />
        </Field>
        <div className="grid2">
          <Field label="Client secret">
            <input value={form.spClientSecret} onChange={set("spClientSecret")} type="password" autoComplete="off" />
          </Field>
          <Field label="Tenant ID">
            <input value={form.spTenantId} onChange={set("spTenantId")} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" />
          </Field>
        </div>
      </details>

      <div className="grid2">
        <Field label="Region">
          <select value={form.region} onChange={set("region")}>
            {REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>

        <Field label="Sensor VM size">
          <select value={form.sensorVmSize} onChange={set("sensorVmSize")}>
            {VM_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Number of sensors">
        <input type="number" min="0" max="20" value={form.sensorCount} onChange={set("sensorCount")} />
      </Field>

      <label className="check">
        <input type="checkbox" checked={form.deployFleet} onChange={set("deployFleet")} />
        <span>Deploy a Fleet Manager server (uncheck to pair sensors to an existing Fleet)</span>
      </label>

      {form.deployFleet ? (
        <>
          <Field label="Fleet VM size" hint="v7 is preferred, but pick a size your subscription has quota for.">
            <select value={form.fleetVmSize} onChange={set("fleetVmSize")}>
              {VM_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
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
          <p className="muted small">Existing Fleet — sensors will pair to it. The pairing address is what the sensors reach (its <code>:1443</code>); the REST API is that host on <code>:443</code>.</p>
          <Field label="Fleet pairing address (host:port)" hint="Must be reachable from the new sensor VNet."><input value={form.existingFleetAddr} onChange={set("existingFleetAddr")} placeholder="10.50.0.x:1443" /></Field>
          <div className="grid2">
            <Field label="Fleet admin user" hint="Auto-mints a token per sensor."><input value={form.existingFleetUser} onChange={set("existingFleetUser")} autoComplete="off" /></Field>
            <Field label="Fleet admin password"><input value={form.existingFleetPass} onChange={set("existingFleetPass")} type="password" autoComplete="off" /></Field>
          </div>
          <p className="muted small">— or, if you can’t share admin creds, paste pre-minted tokens instead —</p>
          <Field label="server_sslname" hint="Required only when pasting tokens."><input value={form.existingFleetSslname} onChange={set("existingFleetSslname")} placeholder="internal.<...>.corelight.io" /></Field>
          <Field label="Pre-minted pairing tokens" hint="One per sensor (newline/comma separated).">
            <textarea rows="3" value={form.existingFleetTokens} onChange={set("existingFleetTokens")} placeholder="token1&#10;token2" />
          </Field>
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
      <p className="muted small">M4 (end-to-end): <strong>Preview</strong> runs <code>terraform plan</code> (safe, no resources). <strong>Deploy</strong> builds the VNet, NSG, Fleet + sensor VMs, brings up the Fleet Manager (install → PEM → start → admin), then for each sensor mints a pairing token, installs corelight-sensor, writes <code>corelightctl.yaml</code>, and deploys + pairs it. Results show the Fleet login and each sensor’s pairing status.</p>
      </>)}
    </form>
  );
}
