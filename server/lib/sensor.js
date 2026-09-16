// Sensor bring-up + pairing (M4). For each sensor VM: mint a per-sensor pairing token
// from the Fleet API, then SSH in and add the sensor-stable repo, dnf install
// corelight-sensor (CLI + images as RPMs, so no CCS pull), write corelightctl.yaml
// (license + interfaces + pairing), and `corelightctl sensor deploy` — handling the
// first-deploy "reboot then redeploy" behavior. Sequential for readable logs.
import { readFileSync } from "node:fs";
import { waitForSsh, runScript } from "./ssh.js";
import { login, createSensor } from "./fleetapi.js";

// The sensor-stable dnf repo (token in baseurl, never logged).
function repoFile(token) {
  const base = `https://${token}:@pkgrepos.corelight.cloud/corelight/sensor-stable`;
  return `[corelight_sensor-stable_el_9]
name=corelight_sensor-stable_el_9
baseurl=${base}/el/9/$basearch
repo_gpgcheck=1
gpgcheck=0
enabled=1
gpgkey=${base}/gpgkey https://downloads.corelight.cloud/public/signing/corelight-package-signing-key.asc
sslverify=1
sslcacert=/etc/pki/tls/certs/ca-bundle.crt
metadata_expire=300
[corelight_sensor-stable_any]
name=corelight_sensor-stable_any
baseurl=${base}/rpm_any/rpm_any/$basearch
repo_gpgcheck=1
gpgcheck=0
enabled=1
gpgkey=${base}/gpgkey https://downloads.corelight.cloud/public/signing/corelight-package-signing-key.asc
sslverify=1
sslcacert=/etc/pki/tls/certs/ca-bundle.crt
metadata_expire=300`;
}

// corelightctl.yaml. JSON.stringify each scalar → valid double-quoted YAML (handles any
// characters in the license/token safely).
function corelightctlYaml({ communityString, licenseKey, pairing }) {
  return `sensor:
  api:
    password: ${JSON.stringify(communityString || "corelight")}
  license_key: ${JSON.stringify(licenseKey || "")}
  management_interface:
    - name: "eth0"
  monitoring_interface:
    name: "eth1"
  pairing:
    token: ${JSON.stringify(pairing.token)}
    server_sslname: ${JSON.stringify(pairing.server_sslname)}
    url: ${JSON.stringify(pairing.url)}
    insecure: false
`;
}

// Run `corelightctl sensor deploy`; if the first run applies OS prereqs and asks for a
// reboot (nonzero exit), reboot the VM, wait for SSH, and deploy once more.
async function deployWithReboot(run, emit, sensor, connectSensor) {
  const phase = "sensor";
  const onLog = (l) => emit(run, "log", l);
  let conn = await connectSensor();
  try {
    emit(run, "log", { level: "info", line: `[${sensor.name}] corelightctl sensor deploy (several min)…`, phase });
    let code = await runScript(conn, "set -uo pipefail\ncorelightctl sensor deploy -v", { onLog, phase });
    if (code === 0) return;

    // First deploy commonly exits nonzero after masking cloud units / sysctl — needs a reboot.
    emit(run, "log", { level: "info", line: `[${sensor.name}] deploy requested a reboot — rebooting and retrying…`, phase });
    await reboot(conn);
    try { conn.end(); } catch {}

    conn = await connectSensor();
    code = await runScript(conn, "set -uo pipefail\ncorelightctl sensor deploy -v", { onLog, phase });
    if (code !== 0) throw new Error(`[${sensor.name}] sensor deploy failed after reboot (exit ${code})`);
  } finally {
    try { conn.end(); } catch {}
  }
}

// Issue a reboot; the connection drops, so don't wait on a clean close.
function reboot(conn) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    conn.exec("sudo systemctl reboot", (err, stream) => {
      if (err) return finish();
      stream.on("close", finish);
      stream.on("error", finish);
    });
    setTimeout(finish, 15000); // reboot severs the channel; move on
  });
}

export async function bringUpSensors(run, emit, fleetCtx) {
  const phase = "sensor";
  const onLog = (l) => emit(run, "log", l);
  const sensors = Array.isArray(run.outputs?.sensors) ? run.outputs.sensors : [];
  if (sensors.length === 0) return;

  emit(run, "status", { phase });

  // Fleet API context: base URL + admin creds, plus the private pairing URL.
  const { apiBase, adminUser, adminPass, pairingUrl } = fleetCtx;
  emit(run, "log", { level: "info", line: `Logging in to Fleet API at ${apiBase}…`, phase });
  const cookies = await login(apiBase, adminUser, adminPass);

  const username = run.form.adminUsername || "azureuser";
  const sensorRepoToken = run.secrets?.sensorRepoToken;
  if (!sensorRepoToken) throw new Error("Sensor bring-up requires the sensor (BYOL) repo token");
  const licenseKey = run.secrets?.licensePath ? readFileSync(run.secrets.licensePath, "utf8").trim() : "";
  const communityString = run.secrets?.communityString || "corelight";

  run.sensorResults = [];
  for (const sensor of sensors) {
    emit(run, "log", { level: "info", line: `=== ${sensor.name} (${sensor.public_ip}) ===`, phase });

    // 1. Mint the pairing token on the Fleet.
    emit(run, "log", { level: "info", line: `[${sensor.name}] minting pairing token…`, phase });
    const pairing = await createSensor(apiBase, cookies, sensor.name);
    const yaml = corelightctlYaml({
      communityString,
      licenseKey,
      pairing: { token: pairing.tethering_token, server_sslname: pairing.server_sslname, url: pairingUrl },
    });

    // 2. Connect + install + configure. (deploy uses its own reconnect for the reboot.)
    const connectSensor = () => waitForSsh({ host: sensor.public_ip, username, privateKeyPath: run.privateKeyPath, onLog });
    const conn = await connectSensor();
    try {
      emit(run, "log", { level: "info", line: `[${sensor.name}] installing corelight-sensor (~6 GB, several min)…`, phase });
      const install = `set -euo pipefail
if [ ! -f /etc/yum.repos.d/corelight_sensor-stable.repo ]; then
  tee /etc/yum.repos.d/corelight_sensor-stable.repo >/dev/null <<'REPO'
${repoFile(sensorRepoToken)}
REPO
  dnf -q makecache || true
fi
echo "== dnf install corelight-sensor =="
dnf install -y corelight-sensor
corelightctl version || true
mkdir -p /etc/corelight
cat > /etc/corelight/corelightctl.yaml <<'YAML'
${yaml}YAML
chmod 0600 /etc/corelight/corelightctl.yaml
echo "corelightctl.yaml written"`;
      const code = await runScript(conn, install, { onLog, phase });
      if (code !== 0) throw new Error(`[${sensor.name}] install/config exited ${code}`);
    } finally {
      try { conn.end(); } catch {}
    }

    // 3. Deploy (with the first-run reboot handling).
    await deployWithReboot(run, emit, sensor, connectSensor);

    // 4. Verify status.
    const vconn = await connectSensor();
    try {
      emit(run, "log", { level: "info", line: `[${sensor.name}] sensor status…`, phase });
      await runScript(vconn, "corelightctl sensor status || true", { onLog, phase });
    } finally {
      try { vconn.end(); } catch {}
    }

    run.sensorResults.push({ name: sensor.name, public_ip: sensor.public_ip, uid: pairing.uid, paired: true });
    emit(run, "log", { level: "success", line: `[${sensor.name}] deployed and paired (uid ${pairing.uid}).`, phase });
  }
}
