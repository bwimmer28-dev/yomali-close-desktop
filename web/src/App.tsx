// web/src/App.tsx
import React, { useMemo, useState, useEffect } from "react";
import MerchantReconciliation from "./MerchantReconciliation";
import { health, apiStatus, updateSettings, type StatusResponse } from "./lib/reconApi";

type TabKey = "dashboard" | "balance" | "merchant" | "settings" | "help";

type TaskStatus = "Not Started" | "In Progress" | "Complete";

type ChecklistTask = {
  id: string;
  name: string;
  status: TaskStatus;
};

type EntityChecklist = {
  entityId: string;
  period: string;
  tasks: ChecklistTask[];
};

type Entity = {
  id: string;
  name: string;
  erp: "Microsoft Dynamics";
  merchants: string[];
};

type SettingsState = {
  balanceSheetOutputDir: string;
  merchantReconOutputDir: string;
};

const ENTITIES: Entity[] = [
  { id: "clickcrm", name: "ClickCRM", erp: "Microsoft Dynamics", merchants: ["PayPal", "Stripe"] },
  { id: "helpgrid", name: "Helpgrid Inc", erp: "Microsoft Dynamics", merchants: ["Braintree"] },
  { id: "maxweb", name: "Maxweb Inc", erp: "Microsoft Dynamics", merchants: ["PayPal"] },
  { id: "getpayment", name: "GetPayment", erp: "Microsoft Dynamics", merchants: ["Stripe", "Adyen"] },
  { id: "smartfluent", name: "SmartFluent", erp: "Microsoft Dynamics", merchants: ["Stripe"] },
  { id: "yomali-holdings", name: "Yomali Holdings", erp: "Microsoft Dynamics", merchants: ["PayPal", "Braintree"] },
  { id: "yomali-labs", name: "Yomali Labs", erp: "Microsoft Dynamics", merchants: ["Stripe", "PayPal"] },
];

const DEFAULT_CHECKLIST_TASKS = [
  "Review and reconcile bank accounts",
  "Reconcile credit card accounts",
  "Review accounts receivable aging",
  "Review accounts payable aging",
  "Accrue unbilled revenue",
  "Accrue expenses",
  "Review prepaid expenses and amortize",
  "Review deferred revenue",
  "Calculate and record depreciation",
  "Review inventory and record adjustments",
  "Reconcile payroll liabilities",
  "Review and accrue bonuses",
  "Reconcile intercompany accounts",
  "Review fixed assets and record additions/disposals",
  "Calculate and record accrued interest",
  "Review loan balances and schedules",
  "Prepare journal entries for month-end adjustments",
  "Review trial balance for unusual items",
  "Prepare management reports",
  "Review and finalize close checklist"
];

const STORAGE_KEY = "yomali_close_settings_v1";
const CHECKLIST_STORAGE_KEY = "yomali_close_checklists_v1";

declare global {
  interface Window {
    electronAPI?: {
      pickFolder?: (opts?: { title?: string }) => Promise<string | null>;
    };
  }
}

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { balanceSheetOutputDir: "", merchantReconOutputDir: "" };
    const parsed = JSON.parse(raw);
    return {
      balanceSheetOutputDir: String(parsed.balanceSheetOutputDir || ""),
      merchantReconOutputDir: String(parsed.merchantReconOutputDir || ""),
    };
  } catch {
    return { balanceSheetOutputDir: "", merchantReconOutputDir: "" };
  }
}

function saveSettings(s: SettingsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function loadChecklists(): EntityChecklist[] {
  try {
    const raw = localStorage.getItem(CHECKLIST_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as EntityChecklist[];
  } catch {
    return [];
  }
}

function saveChecklists(checklists: EntityChecklist[]) {
  localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(checklists));
}

function taskStatusColor(status: TaskStatus): string {
  switch (status) {
    case "Complete": return "#10b981";
    case "In Progress": return "#f59e0b";
    default: return "#6b7280";
  }
}

function getCurrentPeriod(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}`;
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [activeEntityId, setActiveEntityId] = useState<string>(ENTITIES[0].id);
  const [entitySearch, setEntitySearch] = useState("");
  const [settings, setSettings] = useState<SettingsState>(() => loadSettings());
  
  const [checklists, setChecklists] = useState<EntityChecklist[]>(() => loadChecklists());
  const [selectedPeriod, setSelectedPeriod] = useState<string>(getCurrentPeriod());
  
  const [engineStatus, setEngineStatus] = useState<"Unknown" | "Running" | "Down">("Unknown");
  const [backendStatus, setBackendStatus] = useState<StatusResponse | null>(null);

  const activeEntity = useMemo(
    () => ENTITIES.find((e) => e.id === activeEntityId) || ENTITIES[0],
    [activeEntityId]
  );

  const filteredEntities = useMemo(() => {
    const q = entitySearch.trim().toLowerCase();
    if (!q) return ENTITIES;
    return ENTITIES.filter((e) => e.name.toLowerCase().includes(q));
  }, [entitySearch]);

  const breadcrumbTitle = useMemo(() => {
    switch (tab) {
      case "dashboard": return "Dashboard";
      case "balance": return "Balance Sheet Reconciliation";
      case "merchant": return "Merchant Reconciliation";
      case "settings": return "Settings";
      case "help": return "Help";
      default: return "Dashboard";
    }
  }, [tab]);

  const breadcrumbMeta = useMemo(() => {
    if (tab === "settings" || tab === "help") return "Yomali Close Desktop • Close + Reconciliation Console";
    return `Active entity: ${activeEntity.name} • ERP: ${activeEntity.erp}`;
  }, [tab, activeEntity]);

  // Check backend engine status
  useEffect(() => {
    async function checkEngine() {
      try {
        await health();
        setEngineStatus("Running");
        const status = await apiStatus();
        setBackendStatus(status);
      } catch {
        setEngineStatus("Down");
      }
    }
    checkEngine();
    const interval = setInterval(checkEngine, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Sync local settings to backend on startup
  useEffect(() => {
    async function syncSettingsToBackend() {
      if (settings.merchantReconOutputDir) {
        try {
          await updateSettings({ output_dir: settings.merchantReconOutputDir });
          console.log("[Settings] Synced output_dir to backend:", settings.merchantReconOutputDir);
        } catch (err) {
          console.error("[Settings] Failed to sync settings to backend:", err);
        }
      }
    }
    // Only sync after engine is confirmed running
    if (engineStatus === "Running") {
      syncSettingsToBackend();
    }
  }, [engineStatus, settings.merchantReconOutputDir]);

  // Get or create checklist for current entity and period
  const currentChecklist = useMemo(() => {
    const existing = checklists.find(
      (c) => c.entityId === activeEntityId && c.period === selectedPeriod
    );
    if (existing) return existing;
    
    // Create new checklist with default tasks
    const newChecklist: EntityChecklist = {
      entityId: activeEntityId,
      period: selectedPeriod,
      tasks: DEFAULT_CHECKLIST_TASKS.map((name, idx) => ({
        id: `task-${idx}`,
        name,
        status: "Not Started" as TaskStatus,
      })),
    };
    return newChecklist;
  }, [checklists, activeEntityId, selectedPeriod]);

  // Calculate checklist progress for all entities
  const checklistProgress = useMemo(() => {
    return ENTITIES.map((entity) => {
      const checklist = checklists.find(
        (c) => c.entityId === entity.id && c.period === selectedPeriod
      );
      if (!checklist) {
        return { entity: entity.name, total: DEFAULT_CHECKLIST_TASKS.length, complete: 0, inProgress: 0 };
      }
      const complete = checklist.tasks.filter((t) => t.status === "Complete").length;
      const inProgress = checklist.tasks.filter((t) => t.status === "In Progress").length;
      return { entity: entity.name, total: checklist.tasks.length, complete, inProgress };
    });
  }, [checklists, selectedPeriod]);

  function updateTaskStatus(taskId: string, newStatus: TaskStatus) {
    const updatedChecklists = [...checklists];
    const checklistIndex = updatedChecklists.findIndex(
      (c) => c.entityId === activeEntityId && c.period === selectedPeriod
    );

    if (checklistIndex >= 0) {
      const taskIndex = updatedChecklists[checklistIndex].tasks.findIndex((t) => t.id === taskId);
      if (taskIndex >= 0) {
        updatedChecklists[checklistIndex].tasks[taskIndex].status = newStatus;
      }
    } else {
      // Create new checklist
      const newChecklist = { ...currentChecklist };
      const taskIndex = newChecklist.tasks.findIndex((t) => t.id === taskId);
      if (taskIndex >= 0) {
        newChecklist.tasks[taskIndex].status = newStatus;
      }
      updatedChecklists.push(newChecklist);
    }

    setChecklists(updatedChecklists);
    saveChecklists(updatedChecklists);
  }

  async function chooseFolder(which: "balance" | "merchant") {
    const picker = window.electronAPI?.pickFolder;
    if (!picker) {
      // Fallback to simple prompt if electron API not available
      const path = prompt(`Enter ${which === "balance" ? "Balance Sheet" : "Merchant Reconciliation"} output folder path:`);
      if (!path) return;
      
      const next: SettingsState =
        which === "balance"
          ? { ...settings, balanceSheetOutputDir: path }
          : { ...settings, merchantReconOutputDir: path };

      setSettings(next);
      saveSettings(next);
      
      // Update backend settings for merchant recon output
      if (which === "merchant") {
        try {
          await updateSettings({ output_dir: path });
          console.log("[Settings] Updated backend output_dir to:", path);
        } catch (err) {
          console.error("[Settings] Failed to update backend:", err);
        }
      }
      return;
    }
    
    const picked = await picker({ title: "Select output folder" });
    if (!picked) return;

    const next: SettingsState =
      which === "balance"
        ? { ...settings, balanceSheetOutputDir: picked }
        : { ...settings, merchantReconOutputDir: picked };

    setSettings(next);
    saveSettings(next);
    
    // Update backend settings for merchant recon output
    if (which === "merchant") {
      try {
        await updateSettings({ output_dir: picked });
        console.log("[Settings] Updated backend output_dir to:", picked);
      } catch (err) {
        console.error("[Settings] Failed to update backend:", err);
      }
    }
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandTitle">Yomali Close</div>
          <div className="brandSub">Close + Reconciliation Console</div>
        </div>

        <div className="nav">
          <div className="navLabel">NAVIGATION</div>

          <button className={`navBtn ${tab === "dashboard" ? "navBtnActive" : ""}`} onClick={() => setTab("dashboard")}>
            <span>Dashboard</span>
            <span className="navHint">Overview</span>
          </button>

          <button className={`navBtn ${tab === "balance" ? "navBtnActive" : ""}`} onClick={() => setTab("balance")}>
            <span>Balance Sheet</span>
            <span className="navHint">Recon</span>
          </button>

          <button className={`navBtn ${tab === "merchant" ? "navBtnActive" : ""}`} onClick={() => setTab("merchant")}>
            <span>Merchant Reconciliation</span>
            <span className="navHint">PSP vs ERP</span>
          </button>

          <button className={`navBtn ${tab === "settings" ? "navBtnActive" : ""}`} onClick={() => setTab("settings")}>
            <span>Settings</span>
            <span className="navHint">Paths</span>
          </button>

          <button className={`navBtn ${tab === "help" ? "navBtnActive" : ""}`} onClick={() => setTab("help")}>
            <span>Help</span>
            <span className="navHint">FAQs</span>
          </button>
        </div>

        <div className="entityPanel">
          <div className="entityHeader">
            <h4>ENTITIES</h4>
          </div>

          <input
            className="searchInput"
            placeholder="Search entities…"
            value={entitySearch}
            onChange={(e) => setEntitySearch(e.target.value)}
          />

          <div className="entityChips">
            {filteredEntities.map((e) => (
              <button
                key={e.id}
                className={`chip ${e.id === activeEntityId ? "chipActive" : ""}`}
                onClick={() => setActiveEntityId(e.id)}
                title={`${e.name} • ${e.erp} • ${e.merchants.join(", ")}`}
              >
                <span>{e.name}</span>
              </button>
            ))}
          </div>

          <div className="hr" />
          <div className="smallNote">
            <div>
              <span className="badge">{activeEntity.erp}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              Merchants: <span style={{ color: "var(--muted)" }}>{activeEntity.merchants.join(" • ")}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <div className="breadcrumbTitle">{breadcrumbTitle}</div>
            <div className="breadcrumbMeta">{breadcrumbMeta}</div>
          </div>
        </header>

        <section className="content">
          {tab === "dashboard" && (
            <div className="grid2">
              <div className="card">
                <div className="cardHeader">
                  <div>
                    <h3 className="cardTitle">Month-End Close Snapshot</h3>
                    <p className="cardSub">High-level readiness across entities</p>
                  </div>
                </div>

                <div className="cardBody">
                  <div className="kpiRow">
                    <div className="kpi">
                      <div className="kpiLabel">Entities Covered</div>
                      <div className="kpiValue">{ENTITIES.length}</div>
                      <div className="kpiNote">Balance sheet + merchant workflow</div>
                    </div>
                    <div className="kpi">
                      <div className="kpiLabel">Recon Modules</div>
                      <div className="kpiValue">2</div>
                      <div className="kpiNote">Balance sheet + merchant</div>
                    </div>
                  </div>

                  <div className="hr" />

                  <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="smallNote" style={{ fontWeight: 600 }}>Close Checklist Progress ({selectedPeriod})</div>
                    <input
                      type="month"
                      className="field"
                      value={selectedPeriod}
                      onChange={(e) => setSelectedPeriod(e.target.value)}
                      style={{ maxWidth: 160 }}
                    />
                  </div>

                  <table className="table">
                    <thead>
                      <tr>
                        <th>Entity</th>
                        <th>Complete</th>
                        <th>In Progress</th>
                        <th>Total Tasks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checklistProgress.map((prog, idx) => {
                        const entity = ENTITIES[idx];
                        const percentComplete = Math.round((prog.complete / prog.total) * 100);
                        return (
                          <tr key={entity.id}>
                            <td style={{ fontWeight: 600 }}>{prog.entity}</td>
                            <td>
                              <span className="badge" style={{ background: "#10b981", color: "#fff" }}>
                                {prog.complete} ({percentComplete}%)
                              </span>
                            </td>
                            <td>
                              <span className="badge" style={{ background: "#f59e0b", color: "#fff" }}>
                                {prog.inProgress}
                              </span>
                            </td>
                            <td>{prog.total}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="hr" />
                  <div className="smallNote">
                    The reconciliation engine runs automatically each night at 2:30 AM EST. Use the Balance Sheet tab to manage close checklists and the Merchant Reconciliation tab to trigger manual runs or download results.
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="cardHeader">
                  <div>
                    <h3 className="cardTitle">What&apos;s in this build</h3>
                    <p className="cardSub">Current focus areas</p>
                  </div>
                </div>
                <div className="cardBody">
                  <div className="smallNote">
                    <div className="badge">Always-on engine</div> Windows service (NSSM) keeps the backend running
                    <div style={{ height: 10 }} />
                    <div className="badge">Merchant dashboard</div> Status + Run Now + Download XLSX
                    <div style={{ height: 10 }} />
                    <div className="badge">Auto-updater</div> GitHub releases via electron-builder
                    <div style={{ height: 10 }} />
                    <div className="badge">Entity selector</div> Sidebar entity list restored
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "balance" && (
            <div className="card">
              <div className="cardHeader">
                <div>
                  <h3 className="cardTitle">Balance Sheet Reconciliation</h3>
                  <p className="cardSub">Close checklist for {activeEntity.name}</p>
                </div>
              </div>
              <div className="cardBody">
                <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="smallNote" style={{ fontWeight: 600 }}>Period:</div>
                  <input
                    type="month"
                    className="field"
                    value={selectedPeriod}
                    onChange={(e) => setSelectedPeriod(e.target.value)}
                    style={{ maxWidth: 160 }}
                  />
                  <div className="smallNote" style={{ marginLeft: "auto" }}>
                    {currentChecklist.tasks.filter(t => t.status === "Complete").length} / {currentChecklist.tasks.length} Complete
                  </div>
                </div>

                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: "60%" }}>Task</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentChecklist.tasks.map((task) => (
                      <tr key={task.id}>
                        <td>{task.name}</td>
                        <td>
                          <span 
                            className="badge" 
                            style={{ 
                              background: taskStatusColor(task.status),
                              color: "#fff"
                            }}
                          >
                            {task.status}
                          </span>
                        </td>
                        <td>
                          <select
                            className="field"
                            value={task.status}
                            onChange={(e) => updateTaskStatus(task.id, e.target.value as TaskStatus)}
                            style={{ maxWidth: 160 }}
                          >
                            <option value="Not Started">Not Started</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Complete">Complete</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="hr" />
                <div className="smallNote">
                  Use the dropdowns to update task status. Progress is saved automatically and displayed on the Dashboard.
                </div>
              </div>
            </div>
          )}

          {tab === "merchant" && (
            <div className="card">
              <div className="cardHeader">
                <div>
                  <h3 className="cardTitle">Merchant Reconciliation</h3>
                  <p className="cardSub">Automated reconciliation engine (backend integration)</p>
                </div>
              </div>

              <div className="cardBody">
                <MerchantReconciliation />
              </div>
            </div>
          )}

          {tab === "settings" && (
            <div className="grid2">
              <div className="card">
                <div className="cardHeader">
                  <div>
                    <h3 className="cardTitle">Backend Engine Status</h3>
                    <p className="cardSub">Reconciliation engine health monitor</p>
                  </div>
                  <span 
                    className="badge" 
                    style={{ 
                      background: engineStatus === "Running" ? "#10b981" : engineStatus === "Down" ? "#ef4444" : "#6b7280",
                      color: "#fff"
                    }}
                  >
                    {engineStatus}
                  </span>
                </div>
                <div className="cardBody">
                  <div className="kpiRow">
                    <div className="kpi">
                      <div className="kpiLabel">Service Status</div>
                      <div className="kpiValue" style={{ fontSize: 18 }}>{engineStatus}</div>
                      <div className="kpiNote">Health check runs every 30s</div>
                    </div>
                    <div className="kpi">
                      <div className="kpiLabel">Auto-run Time</div>
                      <div className="kpiValue" style={{ fontSize: 18 }}>
                        {backendStatus?.settings?.auto_time_et || "2:30 AM ET"}
                      </div>
                      <div className="kpiNote">Daily reconciliation</div>
                    </div>
                    <div className="kpi">
                      <div className="kpiLabel">Lookback Days</div>
                      <div className="kpiValue" style={{ fontSize: 18 }}>
                        {backendStatus?.settings?.lookback_business_days ?? "3"}
                      </div>
                      <div className="kpiNote">Business days</div>
                    </div>
                  </div>

                  <div className="hr" />

                  <div className="smallNote" style={{ marginBottom: 8 }}>
                    <b>Input Files Location</b>
                  </div>
                  <div className="smallNote" style={{ 
                    color: "var(--muted)", 
                    lineHeight: 1.6,
                    fontFamily: "monospace",
                    background: "rgba(0,0,0,0.3)",
                    padding: 12,
                    borderRadius: 6,
                    marginBottom: 12
                  }}>
                    {backendStatus?.settings?.input_root || "Not configured"}
                  </div>
                  
                  <div className="smallNote" style={{ marginBottom: 12, lineHeight: 1.6 }}>
                    The reconciliation engine automatically pulls files from this directory structure each night at 2:30 AM EST. 
                    Files should be organized as: <strong>[Entity]/[Processor_Folder]/</strong> for processors 
                    and <strong>[Entity]/[CRM_Folder]/</strong> for CRM files.
                  </div>

                  <div className="smallNote" style={{ marginBottom: 8 }}>
                    <b>Expected Folder Structure</b>
                  </div>
                  <div style={{
                    fontFamily: "monospace",
                    fontSize: 11,
                    background: "rgba(0,0,0,0.3)",
                    padding: 12,
                    borderRadius: 6,
                    lineHeight: 1.8,
                    color: "var(--muted)"
                  }}>
                    {ENTITIES.map((entity, idx) => (
                      <div key={entity.id} style={{ marginBottom: idx < ENTITIES.length - 1 ? 12 : 0 }}>
                        <div style={{ color: "#10b981", fontWeight: 600 }}>📁 {entity.name}/</div>
                        <div style={{ paddingLeft: 20 }}>
                          <div style={{ color: "#f59e0b" }}>📁 CRM/</div>
                          {entity.merchants.map(m => (
                            <div key={m} style={{ color: "#60a5fa" }}>📁 {m}/</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {engineStatus === "Down" && (
                    <>
                      <div className="hr" />
                      <div className="smallNote" style={{ color: "#ef4444" }}>
                        <b>⚠️ Engine is Down</b> - The backend reconciliation service is not responding. Please check that the Windows service (NSSM) is running.
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="cardHeader">
                  <div>
                    <h3 className="cardTitle">Output Paths</h3>
                    <p className="cardSub">One folder for each module, organized by date</p>
                  </div>
                </div>
                <div className="cardBody">
                  <div className="formRow">
                    <input className="field" value={settings.balanceSheetOutputDir} placeholder="Balance sheet output folder…" readOnly />
                    <button className="btn btnPrimary" onClick={() => chooseFolder("balance")}>Choose</button>
                  </div>

                  <div className="formRow">
                    <input className="field" value={settings.merchantReconOutputDir} placeholder="Merchant recon output folder…" readOnly />
                    <button className="btn btnPrimary" onClick={() => chooseFolder("merchant")}>Choose</button>
                  </div>

                  <div className="smallNote">
                    Tip: create subfolders like:
                    <div style={{ marginTop: 8, color: "var(--muted)" }}>
                      • BalanceSheet/YYYY-MM-DD/<br />
                      • MerchantRecon/YYYY-MM-DD/
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "help" && (
            <div className="card">
              <div className="cardHeader">
                <div>
                  <h3 className="cardTitle">Help & FAQs</h3>
                  <p className="cardSub">Quick answers + escalation</p>
                </div>
                <a className="btn btnPrimary" href="mailto:brent.wimmer@stalliant.com?subject=Yomali%20Close%20Support">
                  Email Support
                </a>
              </div>
              <div className="cardBody">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: "35%" }}>Question</th>
                      <th>Answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Where do reconciliation outputs go?</td>
                      <td>Set output folders in <b>Settings</b>. The engine saves daily reconciliation files to the configured Merchant Recon output folder with naming format: <code>entityid_daily_recon_YYYY-MM-DD.xlsx</code></td>
                    </tr>
                    <tr>
                      <td>How do I manage the close checklist?</td>
                      <td>Go to <b>Balance Sheet</b> tab, select your entity and period, then update task statuses as you complete them. Progress is saved automatically.</td>
                    </tr>
                    <tr>
                      <td>How do I run a manual reconciliation?</td>
                      <td>Go to <b>Merchant Reconciliation</b> and use &quot;Run Daily Now&quot; for today's date or select a specific date and click &quot;Run for Date&quot;.</td>
                    </tr>
                    <tr>
                      <td>What is the difference between Daily and Monthly runs?</td>
                      <td><b>Daily</b> reconciles a single business day. <b>Monthly (Super)</b> runs reconciliation for an entire month and generates a comprehensive report.</td>
                    </tr>
                    <tr>
                      <td>When does the automatic reconciliation run?</td>
                      <td>The engine runs automatically at <b>2:30 AM ET</b> every night and reconciles the previous 3 business days. Check Settings for current schedule.</td>
                    </tr>
                    <tr>
                      <td>What file formats does the engine accept?</td>
                      <td>The engine accepts <b>CSV</b>, <b>XLSX</b>, and <b>XLS</b> files from payment processors (Stripe, PayPal, Braintree, NMI) and CRM systems.</td>
                    </tr>
                    <tr>
                      <td>How should I organize input files?</td>
                      <td>Files must be in: <code>[Input Root]/[Entity]/[Processor or CRM]/</code>. Check Settings → Expected Folder Structure for details.</td>
                    </tr>
                    <tr>
                      <td>What does &quot;Missing in CRM&quot; mean?</td>
                      <td>A transaction exists in the payment processor data but has no corresponding entry in the CRM system. This may indicate a posting delay or missing transaction.</td>
                    </tr>
                    <tr>
                      <td>What does &quot;Missing in Processor&quot; mean?</td>
                      <td>A transaction exists in CRM but not in processor data. This may indicate a manual journal entry, refund, or data sync issue.</td>
                    </tr>
                    <tr>
                      <td>How do I resolve an exception?</td>
                      <td>In the Exception Dashboard, check the resolved checkbox and add notes explaining the resolution. Resolved exceptions remain visible but are filtered separately.</td>
                    </tr>
                    <tr>
                      <td>Can I export exceptions to Excel?</td>
                      <td>Yes, exceptions are included in the reconciliation Excel output. You can also view them in the Exception Dashboard and mark them as resolved.</td>
                    </tr>
                    <tr>
                      <td>What if the backend engine is down?</td>
                      <td>Check <b>Settings</b> for the engine status. If down, verify the Windows service (NSSM) is running. Contact support if issues persist.</td>
                    </tr>
                    <tr>
                      <td>How do I change the auto-run schedule?</td>
                      <td>The schedule is configured in the backend settings file. Contact your system administrator to modify auto-run time or lookback days.</td>
                    </tr>
                    <tr>
                      <td>Why is my entity showing &quot;At Risk&quot;?</td>
                      <td>This is a visual indicator for entities with open exceptions or incomplete close tasks. It's informational only and doesn't affect functionality.</td>
                    </tr>
                    <tr>
                      <td>Can I run multiple reconciliations at once?</td>
                      <td>No, reconciliations run sequentially to ensure data integrity. Wait for the current run to complete before starting another.</td>
                    </tr>
                    <tr>
                      <td>What happens if a file is missing for a date?</td>
                      <td>The engine will use the most recent file available before that date. Check the output Excel file's Meta tab to see which files were used.</td>
                    </tr>
                    <tr>
                      <td>How do I update the application?</td>
                      <td>The app includes an auto-updater. When a new version is available, you'll be prompted to download and install. Updates are deployed via GitHub releases.</td>
                    </tr>
                    <tr>
                      <td>Where are my settings stored?</td>
                      <td>Settings are stored locally in your browser's localStorage. They persist between sessions but are specific to your machine.</td>
                    </tr>
                    <tr>
                      <td>Who do I contact for support?</td>
                      <td>Email <b>brent.wimmer@stalliant.com</b> with screenshots, error messages, and steps to reproduce the issue.</td>
                    </tr>
                  </tbody>
                </table>

                <div className="hr" />
                <div className="smallNote">
                  <b>Pro Tips:</b> Use Ctrl+F to search this FAQ table. The reconciliation engine runs fully automated each night, so ensure your input files are uploaded by 2:00 AM ET. Check the Exception Dashboard regularly to stay on top of discrepancies.
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}