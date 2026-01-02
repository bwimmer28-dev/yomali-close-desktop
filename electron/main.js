/* electron/main.js (CommonJS)
   - Starts FastAPI/Uvicorn backend automatically
   - Restarts backend if it crashes/exits
   - Waits for /health before loading the UI (optional but recommended)
*/

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let pyProc = null;
let isQuitting = false;

const isDev =
  !app.isPackaged ||
  process.env.NODE_ENV === "development" ||
  process.env.ELECTRON_START_URL?.includes("localhost");

function log(...args) {
  console.log("[main]", ...args);
}
function warn(...args) {
  console.warn("[main]", ...args);
}
function err(...args) {
  console.error("[main]", ...args);
}

/** -------- Backend config -------- */
const API_HOST = process.env.RECON_HOST || "127.0.0.1";
const API_PORT = process.env.RECON_PORT || "8000";
const HEALTH_URL = `http://${API_HOST}:${API_PORT}/health`;

const BACKEND_IMPORT = process.env.RECON_BACKEND_IMPORT || "recon_backend.api_app:app";
const BACKEND_HOST = process.env.RECON_BACKEND_HOST || API_HOST;
const BACKEND_PORT = process.env.RECON_BACKEND_PORT || API_PORT;

// How often we ping /health once running
const HEALTH_PING_MS = Number(process.env.RECON_HEALTH_PING_MS || 15000);

// Restart backoff (ms)
const RESTART_BASE_DELAY_MS = Number(process.env.RECON_RESTART_BASE_MS || 2000);
const RESTART_MAX_DELAY_MS = Number(process.env.RECON_RESTART_MAX_MS || 60000);

/**
 * Where to run the backend from.
 * - In dev, assume repo root is one level up from /electron
 * - In prod, you may need to ship the backend inside resources and point this there.
 */
function getBackendCwd() {
  if (!app.isPackaged) {
    // electron/.. (repo root)
    return path.join(__dirname, "..");
  }
  // When packaged: <app>/resources/app.asar (or unpacked)
  // If you ship backend alongside, adjust this path.
  // Default: run from resourcesPath (unpacked) or from app.getAppPath().
  return process.env.RECON_BACKEND_CWD || app.getAppPath();
}

/**
 * Choose python executable.
 * - Prefer explicit env var if set (useful if you bundle python later)
 * - Else try "python" and fallback to "py" on Windows
 */
function getPythonCommand() {
  if (process.env.RECON_PYTHON) return process.env.RECON_PYTHON;
  if (process.platform === "win32") return "python"; // "py" fallback handled at spawn error
  return "python3";
}

function spawnBackend(pythonCmd) {
  const cwd = getBackendCwd();

  const args = [
    "-m",
    "uvicorn",
    BACKEND_IMPORT,
    "--host",
    String(BACKEND_HOST),
    "--port",
    String(BACKEND_PORT),
  ];

  // If you want live reload in dev, uncomment:
  // if (!app.isPackaged) args.push("--reload");

  log("Starting backend:", pythonCmd, args.join(" "), "cwd=", cwd);

  const child = spawn(pythonCmd, args, {
    cwd,
    env: {
      ...process.env,
      // Ensure unbuffered logs so we can see output in real time
      PYTHONUNBUFFERED: "1",
    },
    windowsHide: true,
  });

  child.stdout.on("data", (d) => log(String(d).trimEnd()));
  child.stderr.on("data", (d) => warn(String(d).trimEnd()));

  child.on("error", (e) => {
    err("Backend spawn error:", e?.message || e);
  });

  return child;
}

/** -------- Health check helpers -------- */
async function fetchHealth() {
  // Use global fetch (Node 18+). Electron recent versions include it.
  const res = await fetch(HEALTH_URL, { method: "GET" });
  if (!res.ok) throw new Error(`Health not OK: ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return body;
}

async function waitForHealth({ timeoutMs = 30000, intervalMs = 500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetchHealth();
      return true;
    } catch (_) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return false;
}

/** -------- Restart loop -------- */
let restartDelay = RESTART_BASE_DELAY_MS;
let healthPingTimer = null;

function clearHealthPing() {
  if (healthPingTimer) {
    clearInterval(healthPingTimer);
    healthPingTimer = null;
  }
}

function startHealthPing() {
  clearHealthPing();
  healthPingTimer = setInterval(async () => {
    try {
      await fetchHealth();
    } catch (e) {
      warn("Health ping failed; backend may be down. Scheduling restart.", e?.message || e);
      scheduleBackendRestart("health_ping_failed");
    }
  }, HEALTH_PING_MS);
}

function scheduleBackendRestart(reason) {
  if (isQuitting) return;

  // Avoid piling up restarts if we already have a running process
  if (pyProc && !pyProc.killed) {
    try {
      pyProc.kill();
    } catch (_) {}
  }

  const delay = Math.min(restartDelay, RESTART_MAX_DELAY_MS);
  warn(`Restarting backend in ${Math.round(delay / 1000)}s (reason=${reason})`);
  setTimeout(() => startPythonBackend({ resetBackoff: false }), delay);
  restartDelay = Math.min(restartDelay * 1.5, RESTART_MAX_DELAY_MS);
}

async function startPythonBackend({ resetBackoff = true } = {}) {
  if (isQuitting) return;

  // If already running, don't start again
  if (pyProc && !pyProc.killed) {
    return;
  }

  if (resetBackoff) restartDelay = RESTART_BASE_DELAY_MS;

  clearHealthPing();

  // Try python then fallback to py on Windows if spawn fails quickly
  const tryCmds = [];
  const primary = getPythonCommand();
  tryCmds.push(primary);
  if (process.platform === "win32" && primary !== "py") tryCmds.push("py");

  let started = false;
  for (const cmd of tryCmds) {
    try {
      pyProc = spawnBackend(cmd);
      started = true;
      break;
    } catch (e) {
      err("Failed to spawn backend with", cmd, e?.message || e);
      pyProc = null;
    }
  }
  if (!started || !pyProc) {
    scheduleBackendRestart("spawn_failed");
    return;
  }

  pyProc.on("exit", (code, signal) => {
    clearHealthPing();
    pyProc = null;
    if (isQuitting) return;
    warn("Backend exited:", { code, signal });
    scheduleBackendRestart("process_exit");
  });

  // Optional: wait for health before proceeding
  const ok = await waitForHealth({ timeoutMs: 45000, intervalMs: 750 });
  if (!ok) {
    warn("Backend did not become healthy in time; restarting.");
    scheduleBackendRestart("health_timeout");
    return;
  }

  log("Backend healthy:", HEALTH_URL);
  startHealthPing();
}

/** -------- Window creation -------- */
async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (isDev && process.env.ELECTRON_START_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_START_URL);
  } else {
    // Adjust if your build output differs
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/** -------- App lifecycle -------- */
app.on("before-quit", () => {
  isQuitting = true;
  clearHealthPing();
  if (pyProc && !pyProc.killed) {
    try {
      pyProc.kill();
    } catch (_) {}
  }
});

app.whenReady().then(async () => {
  // 1) Ensure backend is running (and will auto-restart)
  await startPythonBackend({ resetBackoff: true });

  // 2) Create window
  await createMainWindow();
});

app.on("window-all-closed", () => {
  // On macOS, apps typically stay open until Cmd+Q.
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});

/** -------- Optional IPC helpers (if you want UI to query backend URL) -------- */
ipcMain.handle("recon:getBaseUrl", async () => {
  return `http://${API_HOST}:${API_PORT}`;
});
