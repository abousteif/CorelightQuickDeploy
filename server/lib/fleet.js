// Fleet Manager bring-up (M3). After Terraform creates the Fleet VM, SSH in and:
//   1. add the corelight fleet-stable dnf repo
//   2. dnf install corelight-fleet
//   3. set messaging.community-string
//   4. upload + install the product PEM (cert + license) — Fleet won't start without it
//   5. systemctl enable --now corelight-fleetd
//   6. create the admin user and set a known password
// Mirrors the proven manual flow (fleet-manager-tf finish-fleet.sh + repo stanza).
import { randomBytes } from "node:crypto";
import { waitForSsh, runScript, putFile } from "./ssh.js";

// Strong-ish password with mixed case + digits, no shell-special characters.
function genPassword() {
  return `Cqd${randomBytes(6).toString("hex")}Aa9`;
}

// The dnf repo file, token injected into the baseurl (never logged — we only stream
// command output, not the script text).
function repoFile(token) {
  const base = `https://${token}:@pkgrepos.corelight.cloud/corelight/fleet-stable`;
  return `[corelight_fleet-stable_el_9]
name=corelight_fleet-stable_el_9
baseurl=${base}/el/9/$basearch
repo_gpgcheck=1
gpgcheck=0
enabled=1
gpgkey=${base}/gpgkey https://downloads.corelight.cloud/public/signing/corelight-package-signing-key.asc
sslverify=1
sslcacert=/etc/pki/tls/certs/ca-bundle.crt
metadata_expire=300
[corelight_fleet-stable_any]
name=corelight_fleet-stable_any
baseurl=${base}/rpm_any/rpm_any/$basearch
repo_gpgcheck=1
gpgcheck=0
enabled=1
gpgkey=${base}/gpgkey https://downloads.corelight.cloud/public/signing/corelight-package-signing-key.asc
sslverify=1
sslcacert=/etc/pki/tls/certs/ca-bundle.crt
metadata_expire=300`;
}

export async function bringUpFleet(run, emit) {
  const host = run.outputs?.fleet_public_ip;
  const username = run.form.adminUsername || "azureuser";
  const { fleetRepoToken, communityString, pemPath } = run.secrets || {};
  const onLog = (l) => emit(run, "log", l);
  const phase = "fleet";

  emit(run, "status", { phase });
  if (!host) throw new Error("Fleet bring-up: no fleet_public_ip in outputs");
  if (!pemPath) throw new Error("Fleet bring-up: no Fleet PEM was provided (required to start Fleet)");
  if (!fleetRepoToken) throw new Error("Fleet bring-up: no Fleet repo token was provided");

  emit(run, "log", { level: "info", line: `Connecting to Fleet VM ${host}…`, phase });
  const conn = await waitForSsh({ host, username, privateKeyPath: run.privateKeyPath, onLog });

  try {
    // 1–3: repo + install + community-string. `enabled` disabled here; start after PEM.
    emit(run, "log", { level: "info", line: "Installing corelight-fleet (repo + dnf, ~a few min)…", phase });
    const community = JSON.stringify(communityString || "corelight");
    const install = `set -euo pipefail
if [ ! -f /etc/yum.repos.d/corelight_fleet-stable.repo ]; then
  tee /etc/yum.repos.d/corelight_fleet-stable.repo >/dev/null <<'REPO'
${repoFile(fleetRepoToken)}
REPO
  dnf -q makecache || true
fi
echo "== dnf install corelight-fleet =="
dnf install -y corelight-fleet || true
rpm -q corelight-fleet
python3 - <<PY
import json
p='/etc/corelight-fleetd.conf'
d=json.load(open(p))
d.setdefault('messaging',{})['community-string']=${community}
json.dump(d,open(p,'w'),indent=2)
print('community-string set')
PY`;
    let code = await runScript(conn, install, { onLog, phase });
    if (code !== 0) throw new Error(`Fleet package install exited ${code}`);

    // 4: upload + install PEM (owner corelight-fleetd, mode 400).
    emit(run, "log", { level: "info", line: "Uploading product PEM…", phase });
    await putFile(conn, pemPath, "/tmp/corelight-fleetd.pem");
    code = await runScript(
      conn,
      `set -euo pipefail
install -o corelight-fleetd -g corelight-fleetd -m 400 /tmp/corelight-fleetd.pem /etc/corelight-fleetd.pem
rm -f /tmp/corelight-fleetd.pem
ls -l /etc/corelight-fleetd.pem`,
      { onLog, phase }
    );
    if (code !== 0) throw new Error(`PEM install exited ${code}`);

    // 5: start the service.
    emit(run, "log", { level: "info", line: "Starting corelight-fleetd…", phase });
    code = await runScript(
      conn,
      `set -euo pipefail
systemctl enable --now corelight-fleetd
sleep 4
systemctl is-active corelight-fleetd`,
      { onLog, phase }
    );
    if (code !== 0) throw new Error(`corelight-fleetd failed to start (exit ${code})`);

    // 6: create admin + set a known password (clears the require-password-change flag).
    const adminPw = genPassword();
    emit(run, "log", { level: "info", line: "Creating admin user…", phase });
    const fleetd = "/usr/bin/corelight-fleetd -c /etc/corelight-fleetd.conf";
    code = await runScript(
      conn,
      `set -uo pipefail
# create-user is idempotent-ish: if admin exists it fails, which is fine — we reset next.
sudo -u corelight-fleetd ${fleetd} create-user -a admin || echo "NOTE: admin may already exist; resetting password."
# reset-password reads the new password twice from stdin (fed after this script).
${fleetd} reset-password -p admin`,
      { onLog, phase, input: `${adminPw}\n${adminPw}\n` }
    );
    if (code !== 0) throw new Error(`admin user setup exited ${code}`);

    // Surface credentials in the results (user authorized storing Fleet admin passwords).
    run.fleetAdmin = { user: "admin", password: adminPw };
    emit(run, "log", { level: "success", line: "Fleet Manager is up — admin user ready.", phase });
  } finally {
    try { conn.end(); } catch {}
  }
}
