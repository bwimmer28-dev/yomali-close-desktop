const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");
const ExcelJS = require("exceljs");

const isDev = !app.isPackaged;

const store = new Store({
  name: "stalliant-live-settings",
  defaults: {
    brandTitle: "Stalliant Live",
    merchantOutputRoot: path.join(app.getPath("Documents"), "StalliantLive", "Outputs", "Merchant"),
    balanceSheetOutputRoot: path.join(app.getPath("Documents"), "StalliantLive", "Outputs", "BalanceSheet"),
    cadence: { enabled: false, frequency: "daily", timeET: "23:00" }, // future auto-run
    lastPeriod: currentPeriod(),
  },
});

let mainWindow;

function currentPeriod() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`; // YYYY-MM
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function parseTimeET(timeET) {
  // expects "HH:MM"
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeET || "");
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

async function createWorkbookForMerchantReport({ entity, period, processor, summary, exceptions }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Stalliant Live";
  wb.created = new Date();

  const ws1 = wb.addWorksheet("Summary");
  ws1.addRow(["Entity", entity]);
  ws1.addRow(["Period", period]);
  ws1.addRow(["Processor", processor]);
  ws1.addRow(["Generated At", new Date().toLocaleString()]);
  ws1.addRow([]);
  ws1.addRow(["Metric", "Value"]);
  for (const [k, v] of Object.entries(summary || {})) {
    ws1.addRow([k, v]);
  }

  const ws2 = wb.addWorksheet("Exceptions");
  ws2.addRow(["ticket_id", "severity", "issue_code", "message", "amount", "reference"]);
  (exceptions || []).forEach((x) => {
    ws2.addRow([
      x.ticket_id || "",
      x.severity || "Medium",
      x.issue_code || "",
      x.message || "",
      typeof x.amount === "number" ? x.amount : "",
      x.reference || "",
    ]);
  });

  ws2.columns.forEach((c) => (c.width = 28));
  return wb;
}

async function createWorkbookForBalanceSheetReport({ entity, period, reconName, notes }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Stalliant Live";
  wb.created = new Date();

  const ws = wb.addWorksheet("Balance Sheet Rec");
  ws.addRow(["Entity", entity]);
  ws.addRow(["Period", period]);
  ws.addRow(["Reconciliation", reconName]);
  ws.addRow(["Generated At", new Date().toLocaleString()]);
  ws.addRow([]);
  ws.addRow(["Notes"]);
  ws.addRow([notes || "Placeholder / to be populated by reconciliation template."]);

  ws.columns.forEach((c) => (c.width = 36));
  return wb;
}

function resolveMerchantOutputPath({ merchantOutputRoot, processor, period }) {
  // Merchant > Paypal > 2025-10
  const p = ensureDir(path.join(merchantOutputRoot, processor, period));
  return p;
}

function resolveBSOutputPath({ balanceSheetOutputRoot, entity, period }) {
  // BalanceSheet > ClickCRM > 2025-10
  const p = ensureDir(path.join(balanceSheetOutputRoot, entity, period));
  return p;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1250,
    height: 820,
    backgroundColor: "#0B1020",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(__dirname, "..", "web", "dist", "index.html");
    mainWindow.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// -----------------------------
// IPC: Settings
// -----------------------------
ipcMain.handle("settings:get", async () => {
  return store.store;
});

ipcMain.handle("settings:set", async (_evt, patch) => {
  const next = { ...store.store, ...(patch || {}) };
  store.store = next;
  return store.store;
});

ipcMain.handle("dialog:pickFolder", async () => {
  const r = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths?.[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle("dialog:pickFiles", async (_evt, { title, filters, multi } = {}) => {
  const r = await dialog.showOpenDialog({
    title: title || "Select file(s)",
    properties: multi ? ["openFile", "multiSelections"] : ["openFile"],
    filters: filters || [{ name: "Excel/CSV", extensions: ["xlsx", "xls", "csv"] }],
  });
  if (r.canceled) return [];
  return r.filePaths || [];
});

ipcMain.handle("file:openPath", async (_evt, filePath) => {
  if (!filePath) return { ok: false, error: "Missing path" };
  const result = await shell.openPath(filePath);
  if (result) return { ok: false, error: result };
  return { ok: true };
});

// -----------------------------
// Merchant: Reconcile Now (Phase 1)
// -----------------------------
ipcMain.handle("merchant:reconcileNow", async (_evt, payload) => {
  const {
    entity,
    period,
    processor, // "PayPal" | "Braintree" | "Stripe" etc
    crmFiles = [],
    bankFiles = [],
    merchantFiles = [],
  } = payload || {};

  const settings = store.store;
  const merchantOutputRoot = settings.merchantOutputRoot;

  // TODO: Replace this stub with your real engine. For now we simulate:
  const exceptions = [];
  if ((crmFiles.length + bankFiles.length + merchantFiles.length) === 0) {
    exceptions.push({
      ticket_id: `TKT-${Date.now()}`,
      severity: "High",
      issue_code: "MISSING_INPUTS",
      message: "No input files selected.",
      amount: null,
      reference: null,
    });
  } else {
    // Simulate occasional “can’t reconcile”
    exceptions.push({
      ticket_id: `TKT-${Date.now()}`,
      severity: "Medium",
      issue_code: "AMOUNT_MISMATCH",
      message: "Example discrepancy: net settlement differs from ERP clearing.",
      amount: 125.43,
      reference: processor || "Merchant",
    });
  }

  const summary = {
    "CRM Files": crmFiles.length,
    "Bank Files": bankFiles.length,
    "Merchant Files": merchantFiles.length,
    "Exceptions Found": exceptions.length,
  };

  const outDir = resolveMerchantOutputPath({ merchantOutputRoot, processor, period });
  const outFile = path.join(outDir, `${entity} - ${processor} - ${period} - Merchant Recon.xlsx`);

  const wb = await createWorkbookForMerchantReport({
    entity,
    period,
    processor,
    summary,
    exceptions,
  });
  await wb.xlsx.writeFile(outFile);

  // Return: report path + tickets for Dev tab
  return {
    ok: true,
    reportPath: outFile,
    tickets: exceptions.map((x) => ({
      ticket_id: x.ticket_id,
      entity,
      period,
      source: "Merchant",
      processor,
      severity: x.severity,
      issue_code: x.issue_code,
      message: x.message,
      amount: x.amount,
      reference: x.reference,
      status: "New",
      created_at: new Date().toLocaleString(),
    })),
  };
});

// -----------------------------
// Balance Sheet: Save report (Phase 1)
// -----------------------------
ipcMain.handle("bs:saveReport", async (_evt, payload) => {
  const { entity, period, reconName, notes } = payload || {};
  const settings = store.store;
  const outDir = resolveBSOutputPath({ balanceSheetOutputRoot: settings.balanceSheetOutputRoot, entity, period });
  const outFile = path.join(outDir, `${entity} - ${reconName} - ${period}.xlsx`);
  const wb = await createWorkbookForBalanceSheetReport({ entity, period, reconName, notes });
  await wb.xlsx.writeFile(outFile);
  return { ok: true, reportPath: outFile };
});
