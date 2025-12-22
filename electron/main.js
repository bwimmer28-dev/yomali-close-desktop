const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let pyProc = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadURL("http://localhost:5173");
}

function startPythonApi() {
  const apiDir = path.join(__dirname, "..", "api");

  pyProc = spawn("python", ["-m", "uvicorn", "app:app", "--port", "8000"], {
    cwd: apiDir,
    stdio: "inherit",
  });
}

app.whenReady().then(() => {
  startPythonApi();
  createWindow();
});

app.on("window-all-closed", () => {
  if (pyProc) pyProc.kill();
  if (process.platform !== "darwin") app.quit();
});
