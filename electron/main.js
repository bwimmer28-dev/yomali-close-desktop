
  process.env.NODE_ENV === "development";

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Stalliant Live",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    // Dev: Vite dev server
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Prod: load the packaged Vite build output
    // Your electron-builder "files" includes web/dist/**/*, so this will exist in app.asar resources.
    const indexHtml = path.join(__dirname, "..", "web", "dist", "index.html");
    win.loadFile(indexHtml);
  }

  return win;
}

function startPythonApi() {
  try {
    const apiDir = path.join(__dirname, "..", "api");
    pyProc = spawn("python", ["-m", "uvicorn", "app:app", "--port", "8000"], {
      cwd: apiDir,
      stdio: "inherit",
      windowsHide: true,
    });

    pyProc.on("error", (err) => {
      console.error("[python] failed to start:", err);
    });
  } catch (err) {
    console.error("[python] exception:", err);
  }
}

function wireAutoUpdates() {
  // Only run updater in packaged builds
  if (isDev) return;

  autoUpdater.logger = console;
  autoUpdater.on("checking-for-update", () => console.log("[updater] checking..."));
  autoUpdater.on("update-available", () => console.log("[updater] update available"));
  autoUpdater.on("update-not-available", () => console.log("[updater] no update"));
  autoUpdater.on("error", (err) => console.error("[updater] error", err));
  autoUpdater.on("download-progress", (p) =>
    console.log(`[updater] ${Math.round(p.percent)}%`)
  );
  autoUpdater.on("update-downloaded", () => {
    console.log("[updater] update downloaded; will install on quit");
    // common behavior: install when the user closes the app
    // autoUpdater.quitAndInstall(); // (optional if you want immediate install)
  });

  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  wireAutoUpdates();
  startPythonApi();
  createWindow();
});

app.on("window-all-closed", () => {
  if (pyProc) {
    try {
      pyProc.kill();
    } catch (_) {}
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});