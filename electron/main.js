/* electron/main.js (CommonJS)
   - Starts FastAPI/Uvicorn backend automatically
   - Checks if backend is already running before starting
   - Restarts backend if it crashes/exits
   - Waits for /health before loading the UI
*/

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let pyProc = null;
let isQuitting = false;
let backendStartedByUs = false; // Track if WE started the backend

const isDev =
  !app.isPackaged ||
  process.env.NODE_ENV === "development" ||
  process.env.ELECTRON_START_URL?.includes("localhost");

// FIXED: Use port 8080 to match the backend configuration
const API_HOST = "127.0.0.1";
const API_PORT = 8080;

const HEALTH_URL = `http://${API_HOST}:${API_PORT}/health`;
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_INTERVAL_MS = 500;

const RESTART_BASE_DELAY_MS = 2000;
const RESTART_MAX_DELAY_MS = 15_000;

/** -------- Small helper logger -------- */
function log(...args) {
  console.log("[main]", ...args);
}

/** -------- Check if backend is already running -------- */
async function isBackendRunning() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(t);
    return res.ok;
  } catch (_) {
    return false;
  }
}

/** -------- Backend spawn / restart -------- */
async function startBackend() {
  // First check if backend is already running (e.g., from npm run dev)
  const alreadyRunning = await isBackendRunning();
  if (alreadyRunning) {
    log("Backend already running on port", API_PORT, "- not starting another instance");
    backendStartedByUs = false;
    return true;
  }

  if (pyProc) {
    log("Backend process already exists");
    return true;
  }

  // Determine the correct backend directory
  // In dev: __dirname is electron/, so parent is project root
  // In production (packaged): app.getAppPath() returns the .asar, 
  // but we need the unpacked resources
  let backendDir;
  if (app.isPackaged) {
    // In packaged app, resources are in resources/app.asar.unpacked or next to the exe
    // Try multiple possible locations
    const possiblePaths = [
      path.join(process.resourcesPath, 'app.asar.unpacked'),
      path.join(process.resourcesPath, 'app'),
      path.dirname(app.getPath('exe')),
      path.join(path.dirname(app.getPath('exe')), 'resources', 'app.asar.unpacked'),
    ];
    
    for (const p of possiblePaths) {
      const testPath = path.join(p, 'recon_backend', 'api_app.py');
      log("Checking for backend at:", testPath);
      try {
        require('fs').accessSync(testPath);
        backendDir = p;
        log("Found backend at:", backendDir);
        break;
      } catch (_) {
        // Continue to next path
      }
    }
    
    if (!backendDir) {
      log("ERROR: Could not find recon_backend in any expected location");
      log("Searched paths:", possiblePaths);
      return false;
    }
  } else {
    // Development mode - use parent of electron/ directory
    backendDir = path.join(__dirname, "..");
  }

  const pythonCmd = process.env.YOMALI_PYTHON || "python";
  const args = ["-m", "uvicorn", "recon_backend.api_app:app", "--host", API_HOST, "--port", String(API_PORT)];

  log("Starting backend:", pythonCmd, args.join(" "), "cwd=", backendDir);

  try {
    pyProc = spawn(pythonCmd, args, {
      cwd: backendDir,
      stdio: "pipe",
      windowsHide: true,
      // Ensure Python can find modules
      env: { ...process.env, PYTHONPATH: backendDir },
    });

    backendStartedByUs = true;

    pyProc.stdout.on("data", (d) => process.stdout.write(String(d)));
    pyProc.stderr.on("data", (d) => process.stderr.write(String(d)));

    pyProc.on("error", (err) => {
      log("Backend spawn error:", err.message);
      pyProc = null;
      backendStartedByUs = false;
    });

    pyProc.on("exit", (code, signal) => {
      log("Backend exited:", { code, signal });
      pyProc = null;

      if (isQuitting) return;

      // Only restart if we started it and it wasn't a clean exit
      if (backendStartedByUs && code !== 0) {
        setTimeout(async () => {
          restartDelay = Math.min(restartDelay * 1.5, RESTART_MAX_DELAY_MS);
          await startBackend();
        }, restartDelay);
      }
    });

    return true;
  } catch (err) {
    log("Failed to start backend:", err.message);
    return false;
  }
}

/** -------- Health check -------- */
async function fetchHealth() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`Health not ok: ${res.status}`);
    return true;
  } catch (err) {
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function waitForHealth(timeoutMs = HEALTH_TIMEOUT_MS, intervalMs = HEALTH_INTERVAL_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetchHealth();
      log("Backend is healthy!");
      return true;
    } catch (_) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  log("Backend health check timed out after", timeoutMs, "ms");
  return false;
}

/** -------- Restart loop -------- */
let restartDelay = RESTART_BASE_DELAY_MS;
let healthPingTimer = null;

function startHealthPinger() {
  if (healthPingTimer) clearInterval(healthPingTimer);
  healthPingTimer = setInterval(async () => {
    try {
      await fetchHealth();
      restartDelay = RESTART_BASE_DELAY_MS; // reset backoff when healthy
    } catch (e) {
      log("Health ping failed:", String(e));
      // If backend died and we started it, try to restart
      if (backendStartedByUs && !pyProc && !isQuitting) {
        log("Attempting to restart backend...");
        await startBackend();
      }
    }
  }, 10000); // Check every 10 seconds
}

/** -------- Window creation -------- */
async function createMainWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, "..", "build", "stalliant.ico"),
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (isDev) {
    // In dev, load Vite dev server
    const url = process.env.ELECTRON_START_URL || "http://localhost:5173";
    log("Loading dev URL:", url);
    await mainWindow.loadURL(url);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // In prod, ensure backend is up before loading local UI
    const ok = await waitForHealth();
    if (!ok) {
      dialog.showErrorBox(
        "Backend did not start",
        `Could not reach ${HEALTH_URL}.\n\nPlease ensure Python is installed and the backend dependencies are available.\n\nCheck the console for error details.`
      );
    }
    await mainWindow.loadFile(path.join(__dirname, "..", "web", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/** -------- App lifecycle -------- */
app.on("ready", async () => {
  log("App ready, isDev:", isDev);
  
  // Start or connect to backend
  await startBackend();
  
  // Wait for backend to be healthy before showing window
  const healthy = await waitForHealth();
  if (!healthy) {
    log("Warning: Backend not healthy, but continuing anyway...");
  }
  
  startHealthPinger();
  await createMainWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (healthPingTimer) clearInterval(healthPingTimer);
  
  // Only kill the backend if we started it
  if (backendStartedByUs && pyProc) {
    log("Stopping backend process we started...");
    try {
      pyProc.kill();
    } catch (_) {}
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});

/** -------- Optional IPC helpers -------- */
ipcMain.handle("recon:getBaseUrl", async () => {
  return `http://${API_HOST}:${API_PORT}`;
});

/** -------- Folder picker IPC handler -------- */
ipcMain.handle("dialog:openDirectory", async (event, options = {}) => {
  const { title = "Select Folder" } = options;
  
  const result = await dialog.showOpenDialog({
    title,
    properties: ["openDirectory", "createDirectory"],
  });
  
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  
  return result.filePaths[0];
});