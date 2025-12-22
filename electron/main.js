const { app, BrowserWindow, Menu, ipcMain, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let pyProc = null;

function isDev() {
  return !app.isPackaged;
}

function log(...args) {
  console.log("[main]", ...args);
}

function startPythonApi() {
  try {
    const apiDir = path.join(__dirname, "..", "api");

    // NOTE: This assumes Python is installed on the machine and `python` is in PATH.
    // If coworkers don't have Python, you’ll need to bundle Python later.
    pyProc = spawn("python", ["-m", "uvicorn", "app:app", "--port", "8000"], {
      cwd: apiDir,
      stdio: "inherit",
      windowsHide: true,
    });

    pyProc.on("error", (err) => {
      log("Python spawn error:", err);
    });

    pyProc.on("exit", (code) => {
      log("Python exited with code:", code);
      pyProc = null;
    });

    log("Python API started");
  } catch (e) {
    log("Failed to start Python API:", e);
  }
}

function stopPythonApi() {
  if (pyProc) {
    try {
      pyProc.kill();
    } catch (_) {}
    pyProc = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Stalliant Live",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev()) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // Load the built Vite app
    const indexPath = path.join(__dirname, "..", "web", "dist", "index.html");
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forcereload" },
        { role: "toggledevtools" },
        { type: "separator" },
        { role: "resetzoom" },
        { role: "zoomin" },
        { role: "zoomout" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates",
          click: async () => {
            try {
              autoUpdater.checkForUpdatesAndNotify();
              dialog.showMessageBox({
                type: "info",
                message: "Checking for updates…",
              });
            } catch (e) {
              dialog.showMessageBox({
                type: "error",
                message: `Update check failed: ${e?.message || e}`,
              });
            }
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function wireAutoUpdates() {
  // Optional: reduce noise
  autoUpdater.autoDownload = true;

  autoUpdater.on("checking-for-update", () => log("checking-for-update"));
  autoUpdater.on("update-available", () => log("update-available"));
  autoUpdater.on("update-not-available", () => log("update-not-available"));
  autoUpdater.on("error", (err) => log("autoUpdater error:", err));
  autoUpdater.on("download-progress", (p) => log("download-progress", p.percent));
  autoUpdater.on("update-downloaded", () => {
    log("update-downloaded");
    // You can choose to auto-install or prompt. For now we'll prompt from the renderer.
    if (mainWindow) {
      mainWindow.webContents.send("update-downloaded");
    }
  });

  // Allow renderer button to trigger a manual check
  ipcMain.handle("updates:check", async () => {
    autoUpdater.checkForUpdatesAndNotify();
    return true;
  });

  // Allow renderer button to install update
  ipcMain.handle("updates:install", async () => {
    autoUpdater.quitAndInstall();
    return true;
  });

  // Kick an automatic check on launch (packaged only)
  if (!isDev()) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

app.whenReady().then(() => {
  buildMenu();
  wireAutoUpdates();
  startPythonApi();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopPythonApi();
  if (process.platform !== "darwin") app.quit();
});
