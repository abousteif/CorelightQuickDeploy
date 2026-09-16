// Deploy runner — owns a per-run workspace and streams Terraform output.
// M2 scope: create a runs/<id>/ workspace, copy the Terraform module in, generate a
// per-run SSH keypair, render tfvars from the form, then run `terraform init` + apply
// (or plan, when dryRun) and stream every line to attached SSE listeners.
// The Corelight-specific bring-up (Fleet install, token minting, sensor pairing) lands
// in M3/M4 and will hook into the same run lifecycle after apply succeeds.
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, cpSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import readline from "node:readline";
import { bringUpFleet } from "./fleet.js";
import { bringUpSensors } from "./sensor.js";

const WIN = process.platform === "win32";
const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = dirname(__dirname);
const appRoot = dirname(serverRoot);
const TF_MODULE = join(appRoot, "terraform");
const RUNS_DIR = join(appRoot, "runs");

// In-memory registry of runs for this process. A run outlives the POST that creates it;
// the SSE GET attaches to it and triggers execution.
const runs = new Map();

function newId() {
  return randomBytes(4).toString("hex"); // 8 hex chars → cqd-xxxxxxxx
}

// ssh-keygen ships with OpenSSH on macOS, Linux, and Windows 10+.
function generateKeypair(dir) {
  const keyPath = join(dir, "id_ed25519");
  return new Promise((resolve, reject) => {
    execFile(
      "ssh-keygen",
      ["-t", "ed25519", "-N", "", "-C", "corelight-quick-deploy", "-f", keyPath],
      { shell: WIN, windowsHide: true, timeout: 20000 },
      (err) => {
        if (err) return reject(new Error(`ssh-keygen failed: ${err.message}`));
        try {
          resolve({ privateKeyPath: keyPath, publicKey: readFileSync(`${keyPath}.pub`, "utf8").trim() });
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

// Build the tfvars object the module expects from the validated form.
function toTfvars(form, publicKey) {
  const cidrs = (form.adminSourceCidrs && form.adminSourceCidrs.length)
    ? form.adminSourceCidrs
    : (form.publicIp ? [`${form.publicIp}/32`] : []);
  return {
    subscription_id: form.subscriptionId,
    location: form.region,
    name_prefix: form.namePrefix,
    admin_username: form.adminUsername || "azureuser",
    ssh_public_key: publicKey,
    admin_source_cidrs: cidrs,
    vnet_cidr: form.vnetCidr || "10.50.0.0/16",
    subnet_cidr: form.subnetCidr || "10.50.0.0/24",
    vm_size: form.vmSize || "Standard_D4s_v3",
    deploy_fleet: form.deployFleet !== false,
    sensor_count: Number(form.sensorCount || 1),
    fleet_dns_label: form.deployFleet !== false ? `${form.namePrefix}-fleet` : "",
  };
}

export function createRun(form) {
  const id = newId();
  const namePrefix = `cqd-${id}`;
  const dir = join(RUNS_DIR, id);
  const tfDir = join(dir, "tf");
  const sshDir = join(dir, "ssh");
  mkdirSync(tfDir, { recursive: true });
  mkdirSync(sshDir, { recursive: true });

  // Secrets go to the gitignored run dir, never into logs. PEM (base64) → fleet.pem.
  const secrets = {
    fleetRepoToken: form.fleetRepoToken || "",
    communityString: form.communityString || "corelight",
    sensorRepoToken: form.sensorRepoToken || "",
    pemPath: null,
    licensePath: null,
  };
  if (form.fleetPemB64) {
    secrets.pemPath = join(dir, "fleet.pem");
    writeFileSync(secrets.pemPath, Buffer.from(form.fleetPemB64, "base64"));
  }
  if (form.sensorLicenseB64) {
    secrets.licensePath = join(dir, "sensor.license");
    writeFileSync(secrets.licensePath, Buffer.from(form.sensorLicenseB64, "base64"));
  }

  // Keep the base64 blobs out of the retained form (large + sensitive).
  const { fleetPemB64, sensorLicenseB64, ...formRest } = form;
  const run = {
    id,
    namePrefix,
    dir,
    tfDir,
    sshDir,
    secrets,
    form: { ...formRest, namePrefix },
    dryRun: !!form.dryRun,
    status: "created",
    started: false,
    buffer: [], // replay for late subscribers
    listeners: new Set(),
    outputs: null,
  };
  runs.set(id, run);
  return { id, namePrefix };
}

export function getRun(id) {
  return runs.get(id);
}

function emit(run, event, data) {
  const rec = { event, data };
  run.buffer.push(rec);
  for (const res of run.listeners) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // listener gone; will be cleaned up on close
    }
  }
}

// Run one terraform subcommand, streaming stdout+stderr line-by-line. Resolves exit code.
function runTerraform(run, args, phase) {
  return new Promise((resolve) => {
    emit(run, "log", { level: "info", line: `$ terraform ${args.join(" ")}` });
    const child = spawn("terraform", args, {
      cwd: run.tfDir,
      shell: WIN,
      windowsHide: true,
      env: { ...process.env, TF_IN_AUTOMATION: "1" },
    });
    const pipe = (stream, level) => {
      const rl = readline.createInterface({ input: stream });
      rl.on("line", (line) => emit(run, "log", { level, line, phase }));
    };
    pipe(child.stdout, "info");
    pipe(child.stderr, "warn");
    child.on("error", (err) => {
      emit(run, "log", { level: "error", line: `failed to launch terraform: ${err.message}` });
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function execute(run) {
  try {
    run.status = "running";

    // 1. Materialize the workspace: copy module + generate keypair + render tfvars.
    emit(run, "status", { phase: "prepare" });
    emit(run, "log", { level: "info", line: `Preparing workspace runs/${run.id}/ ...` });
    // Copy only the module source — never a stray .terraform/ (provider binaries) or state.
    cpSync(TF_MODULE, run.tfDir, {
      recursive: true,
      filter: (src) => !/[\\/](\.terraform|\.terraform\.lock\.hcl|terraform\.tfstate.*)$/.test(src),
    });

    emit(run, "log", { level: "info", line: "Generating per-run SSH keypair (ed25519)..." });
    const { publicKey, privateKeyPath } = await generateKeypair(run.sshDir);
    run.privateKeyPath = privateKeyPath;

    const tfvars = toTfvars(run.form, publicKey);
    writeFileSync(join(run.tfDir, "terraform.tfvars.json"), JSON.stringify(tfvars, null, 2));
    emit(run, "log", {
      level: "info",
      line: `Plan: ${tfvars.deploy_fleet ? "1 Fleet + " : "no Fleet, "}${tfvars.sensor_count} sensor(s) in new VNet ${tfvars.vnet_cidr} (${run.namePrefix}-rg, ${tfvars.location}).`,
    });

    // 2. terraform init
    emit(run, "status", { phase: "init" });
    let code = await runTerraform(run, ["init", "-no-color", "-input=false"], "init");
    if (code !== 0) throw new Error(`terraform init exited ${code}`);

    // 3. plan or apply
    if (run.dryRun) {
      emit(run, "status", { phase: "plan" });
      code = await runTerraform(run, ["plan", "-no-color", "-input=false"], "plan");
      if (code !== 0) throw new Error(`terraform plan exited ${code}`);
      emit(run, "log", { level: "success", line: "Dry run complete — plan only, no resources created." });
      run.status = "complete";
      emit(run, "status", { phase: "complete" });
      return;
    }

    emit(run, "status", { phase: "apply" });
    emit(run, "log", { level: "info", line: "Applying — this creates real Azure resources and can take 10–30 min." });
    code = await runTerraform(run, ["apply", "-no-color", "-input=false", "-auto-approve"], "apply");
    if (code !== 0) throw new Error(`terraform apply exited ${code}`);

    // 4. capture outputs
    run.outputs = await readOutputs(run);
    emit(run, "log", { level: "success", line: "Infrastructure ready." });

    // 5. Fleet bring-up (M3): install + PEM + start + admin, over SSH.
    if (run.form.deployFleet !== false) {
      await bringUpFleet(run, emit);
    } else {
      emit(run, "log", { level: "info", line: "Skipping Fleet bring-up (using an existing Fleet)." });
    }

    // 6. Sensor bring-up + pairing (M4). Only the deploy-Fleet path is wired here; the
    // existing-Fleet path (operator-supplied address + creds) lands in M5.
    const sensorCount = Array.isArray(run.outputs?.sensors) ? run.outputs.sensors.length : 0;
    if (sensorCount > 0) {
      if (run.form.deployFleet !== false && run.fleetAdmin) {
        await bringUpSensors(run, emit, {
          apiBase: `https://${run.outputs.fleet_public_ip}`,
          adminUser: run.fleetAdmin.user,
          adminPass: run.fleetAdmin.password,
          pairingUrl: `https://${run.outputs.fleet_private_ip}:1443/fleet/v1/internal/softsensor/websocket`,
        });
      } else {
        emit(run, "log", { level: "info", line: "Sensor VMs created; automatic pairing to an existing Fleet arrives in M5." });
      }
    }

    // Build results: outputs + Fleet admin creds + per-sensor pairing status.
    const results = { ...(run.outputs || {}) };
    if (run.fleetAdmin) {
      results.fleet_admin_user = run.fleetAdmin.user;
      results.fleet_admin_password = run.fleetAdmin.password;
    }
    if (Array.isArray(run.sensorResults) && Array.isArray(results.sensors)) {
      const byName = new Map(run.sensorResults.map((s) => [s.name, s]));
      results.sensors = results.sensors.map((s) => ({ ...s, ...(byName.get(s.name) || {}) }));
    }
    emit(run, "results", results);
    run.status = "complete";
    emit(run, "status", { phase: "complete" });
  } catch (e) {
    run.status = "error";
    emit(run, "log", { level: "error", line: String(e?.message || e) });
    emit(run, "status", { phase: "error" });
  } finally {
    emit(run, "end", { status: run.status });
    for (const res of run.listeners) {
      try { res.end(); } catch {}
    }
    run.listeners.clear();
  }
}

function readOutputs(run) {
  return new Promise((resolve) => {
    execFile("terraform", ["output", "-json"], { cwd: run.tfDir, shell: WIN, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const raw = JSON.parse(stdout);
        const flat = {};
        for (const [k, v] of Object.entries(raw)) flat[k] = v.value;
        resolve(flat);
      } catch {
        resolve(null);
      }
    });
  });
}

// Attach an SSE response to a run. Starts execution on first attach.
export function attach(run, res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  res.write(`event: log\ndata: ${JSON.stringify({ level: "info", line: `Attached to run ${run.id}.` })}\n\n`);

  // Replay anything already emitted (covers reconnects and the POST→GET gap).
  for (const rec of run.buffer) {
    res.write(`event: ${rec.event}\ndata: ${JSON.stringify(rec.data)}\n\n`);
  }
  run.listeners.add(res);
  res.on("close", () => run.listeners.delete(res));

  if (!run.started) {
    run.started = true;
    execute(run); // fire and forget; streams via emit()
  } else if (run.status === "complete" || run.status === "error") {
    try { res.end(); } catch {}
  }
}

export function hasSshKeygen() {
  return new Promise((resolve) => {
    execFile("ssh-keygen", ["-A", "-?"], { shell: WIN, windowsHide: true, timeout: 5000 }, (err, _o, stderr) => {
      // ssh-keygen prints usage to stderr and exits nonzero for bad flags; presence is what matters.
      resolve(!/ENOENT|not found|not recognized/i.test((err && err.message) || stderr || "") || !err);
    });
  });
}
