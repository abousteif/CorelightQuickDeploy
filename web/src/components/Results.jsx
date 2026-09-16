// Results card — rendered after a successful apply from terraform outputs.
import React from "react";

export default function Results({ data }) {
  if (!data) return null;
  const sensors = Array.isArray(data.sensors) ? data.sensors : [];
  return (
    <section className="card">
      <h2>Deployed</h2>
      <p className="muted small">Resource group <code>{data.resource_group_name}</code> — delete it to tear everything down.</p>

      {data.fleet_deployed && (
        <div className="result-block">
          <h3>Fleet Manager</h3>
          <ul className="kv">
            {data.fleet_ui_url && <li><span>UI</span><a href={data.fleet_ui_url} target="_blank" rel="noreferrer">{data.fleet_ui_url}</a></li>}
            <li><span>Public IP</span><code>{data.fleet_public_ip}</code></li>
            <li><span>Private IP</span><code>{data.fleet_private_ip}</code></li>
          </ul>
        </div>
      )}

      {sensors.length > 0 && (
        <div className="result-block">
          <h3>Sensors ({sensors.length})</h3>
          {sensors.map((s) => (
            <ul className="kv" key={s.name}>
              <li><span>{s.name}</span><code>ssh {data.admin_username}@{s.public_ip}</code></li>
              <li><span>mgmt / monitor</span><code>{s.mgmt_private_ip} / {s.monitor_private_ip}</code></li>
            </ul>
          ))}
        </div>
      )}
    </section>
  );
}
