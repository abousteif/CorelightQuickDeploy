// Electron main process (P4 zero-prereq packaging).
// We keep the existing Express + SSE server exactly as-is and simply run it inside Electron,
// then point a BrowserWindow at http://127.0.0.1:PORT. This reuses the whole app (API, SSE,
// static UI) with no rewrite. Electron carries its own Node runtime, and Terraform + the
// module source ship as unpacked resources — so a packaged build needs nothing preinstalled.
const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const url = require("node:url");
const http = require("node:http");

const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";

// Tell the server where its resources and writable workspace live when packaged (the code
// itself is read-only inside app.asar). In dev these stay unset → repo-root paths.
if (app.isPackaged) {
  process.env.CQD_RESOURCES_PATH = process.resourcesPath;
  process.env.CQD_TF_MODULE = path.join(process.resourcesPath, "terraform");
  process.env.CQD_RUNS_DIR = path.join(app.getPath("userData"), "runs");
}
process.env.SERVE_STATIC = "1";
process.env.PORT = String(PORT);

function serverEntry() {
  const base = app.isPackaged ? app.getAppPath() : path.join(__dirname, "..");
  return path.join(base, "server", "index.js");
}

// The server is ESM; import it (its module side-effect starts listening).
function startServer() {
  return import(url.pathToFileURL(serverEntry()).href);
}

function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: HOST, port: PORT, path: "/api/health" }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on("error", retry);
    };
    const retry = () => (Date.now() > deadline ? reject(new Error("server did not become healthy")) : setTimeout(tryOnce, 300));
    tryOnce();
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 920,
    title: "Corelight Azure Deployer",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Open external links (e.g. the Azure device-login page) in the system browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
  await win.loadURL(`http://${HOST}:${PORT}/`);
}

app.whenReady().then(async () => {
  await startServer();
  await waitForHealth();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
