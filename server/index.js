// Corelight Azure Deployer — backend.
// Binds to 127.0.0.1 ONLY (never exposed). Serves the API and, in production, the built UI.
// M2 scope: preflight + a real deploy pipeline. POST /api/deploy creates a per-run
// workspace from the form; GET /api/deploy/stream?runId attaches an SSE channel that
// runs `terraform init` + apply (or plan on dryRun) and streams output live. The
// Corelight bring-up (Fleet install, token minting, sensor pairing) lands in M3/M4.
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { runPreflight } from "./lib/preflight.js";
import { createRun, getRun, attach } from "./lib/runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1"; // localhost only — security requirement.

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "corelight-azure-deployer", version: "0.1.0" }));

app.get("/api/preflight", async (_req, res) => {
  try {
    res.json(await runPreflight());
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Create a deploy run from the submitted form. Returns a runId; the client then opens
// the SSE stream below to drive and watch it. `dryRun: true` runs `terraform plan` only.
app.post("/api/deploy", (req, res) => {
  const form = req.body || {};
  if (!form.subscriptionId) return res.status(400).json({ error: "subscriptionId is required" });
  const n = Number(form.sensorCount);
  if (!Number.isInteger(n) || n < 0 || n > 50) return res.status(400).json({ error: "sensorCount must be 0–50" });
  if (form.deployFleet === false && n === 0) return res.status(400).json({ error: "Nothing to deploy: no Fleet and 0 sensors" });
  try {
    const { id, namePrefix } = createRun(form);
    res.json({ runId: id, namePrefix });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// SSE deploy stream. Attaching starts (or resumes watching) the run's terraform execution.
app.get("/api/deploy/stream", (req, res) => {
  const run = getRun(String(req.query.runId || ""));
  if (!run) {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(`event: log\ndata: ${JSON.stringify({ level: "error", line: "Unknown or expired runId." })}\n\n`);
    res.write(`event: end\ndata: ${JSON.stringify({ status: "error" })}\n\n`);
    return res.end();
  }
  attach(run, res);
});

// Serve the built UI in production (npm start sets SERVE_STATIC=1).
if (process.env.SERVE_STATIC === "1") {
  const dist = join(root, "web", "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(join(dist, "index.html")));
  } else {
    app.get("*", (_req, res) => res.status(503).send("UI not built yet. Run `npm run build`."));
  }
}

app.listen(PORT, HOST, () => {
  console.log(`[corelight-azure-deployer] API listening on http://${HOST}:${PORT}`);
  if (process.env.SERVE_STATIC !== "1") console.log("[dev] UI served by Vite on http://127.0.0.1:5173 (proxying /api here)");
});
