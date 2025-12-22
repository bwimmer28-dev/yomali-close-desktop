const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");

let pyProc = null;

function isDev() {
  return !app.isPackaged;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (isDev()) {
    // Dev: Vite dev server
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Prod: load the built React app from /web/dist
    const indexPath = path.join(__dirname, "..", "web", "dist", "index.html");
    win.loadFile(indexPath);
  }
}

function startPythonApi() {
  const apiDir = path.join(__dirname, "..", "api");

  // NOTE: This requires "python" to exist on the coworker machine PATH.
  // We'll deal with bundling Python later—this at least prevents a crash loop.
  pyProc = spawn("python", ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8000"], {
    cwd: apiDir,
    stdio: "ignore", // change to "inherit" if you want to see logs locally
    windowsHide: true,
  });

  pyProc.on("exit", (code) => {
    // optional: log to a file later
    // console.log("Python API exited:", code);
  });

  pyProc.on("error", (err) => {
    // optional: log to a file later
    // console.error("Python API failed to start:", err);
  });
}

function wireAutoUpdates() {
  // Good defaults for your tester flow
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    // IMPORTANT: your screenshot showed a broken logger line (e.log...)
    // If you want logging later, we can add electron-log.
    // console.error("[updater] error", err);
  });

  // This checks GitHub Releases for updates
  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  if (!isDev()) {
    wireAutoUpdates();
  }
  startPythonApi();
  createWindow();
});

app.on("window-all-closed", () => {
  if (pyProc) pyProc.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});