// Corelight Azure Deployer — backend.
// Binds to 127.0.0.1 ONLY (never exposed). Serves the API and, in production, the built UI.
// M1 scope: preflight endpoint + an SSE deploy channel that streams a stubbed run so the
// UI's live-log pipe is proven end-to-end. Real orchestration lands in M2–M4.
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { runPreflight } from "./lib/preflight.js";

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

// SSE deploy stream (M1 STUB). Later this drives terraform + the Corelight orchestrator.
// Query params carry a summary of the form so we can echo it back for now.
app.get("/api/deploy/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const sensors = Number(req.query.sensors || 1);
  const fleet = req.query.deployFleet !== "false";

  const steps = [
    ["preflight", "Re-checking az login / terraform / uploads..."],
    ["plan", `Planning: ${fleet ? "1 Fleet + " : "no Fleet, "}${sensors} sensor(s) in a new VNet (10.50.0.0/16)`],
    ["stub", "M1 scaffold: orchestration not wired yet — this is a demo of the live-log channel."],
    ["stub", "M2 will run `terraform apply` here and stream its output line by line."],
    ["done", "Demo stream complete."],
  ];

  let i = 0;
  send("log", { level: "info", line: "Connected to deploy stream." });
  const timer = setInterval(() => {
    if (i >= steps.length) {
      send("status", { phase: "complete" });
      clearInterval(timer);
      res.end();
      return;
    }
    const [phase, line] = steps[i++];
    send("log", { level: phase === "done" ? "success" : "info", line });
    send("status", { phase });
  }, 700);

  req.on("close", () => clearInterval(timer));
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
