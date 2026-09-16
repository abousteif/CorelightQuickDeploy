// Production launcher: build the web UI (if needed), start the backend, open the browser.
// Cross-platform (no shell built-ins). `npm start` -> this.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import open from "open";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || 8787;

async function main() {
  // Ensure the web build exists; if not, build it first.
  if (!existsSync(join(root, "web", "dist", "index.html"))) {
    console.log("No web build found — building UI (one-time)...");
    await run("npm", ["--prefix", "web", "run", "build"]);
  }

  console.log(`Starting Corelight Azure Deployer on http://127.0.0.1:${PORT} ...`);
  const server = spawn("node", [join("server", "index.js")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: String(PORT), SERVE_STATIC: "1" },
    shell: false,
  });

  // Give the server a moment, then open the browser.
  setTimeout(() => open(`http://127.0.0.1:${PORT}`).catch(() => {}), 1200);

  const stop = () => server.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("exit", (code) => process.exit(code ?? 0));
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}`))));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
