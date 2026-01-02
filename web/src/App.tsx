// web/src/App.tsx
import React, { useMemo, useState } from "react";
import MerchantReconciliation from "./MerchantReconciliation";

type TabKey = "dashboard" | "balance" | "merchant" | "settings" | "help";

type Entity = {
  id: string;
  name: string;
  status: "On Track" | "At Risk";
  erp: "QuickBooks" | "NetSuite";
  merchants: string[];
};

type SettingsState = {
  balanceSheetOutputDir: string;
  merchantReconOutputDir: string;
};

const ENTITIES: Entity[] = [
  { id: "clickcrm", name: "ClickCRM", status: "On Track", erp: "QuickBooks", merchants: ["PayPal", "Stripe"] },
  { id: "helpgrid", name: "Helpgrid Inc", status: "At Risk", erp: "NetSuite", merchants: ["Braintree", "Stripe", "NMI"] },
  { id: "maxweb", name: "Maxweb Inc", status: "On Track", erp: "QuickBooks", merchants: ["PayPal"] },
  { id: "getpayment", name: "GetPayment", status: "At Risk", erp: "NetSuite", merchants: ["Stripe", "Adyen"] },
  { id: "smartfluent", name: "SmartFluent", status: "On Track", erp: "QuickBooks", merchants: ["Stripe"] },
  { id: "yomali-holdings", name: "Yomali Holdings", status: "At Risk", erp: "NetSuite", merchants: ["PayPal", "Braintree"] },
  { id: "yomali-labs", name: "Yomali Labs", status: "On Track", erp: "QuickBooks", merchants: ["Stripe", "PayPal"] },
];

const STORAGE_KEY = "stalliant_live_settings_v1";

declare global {
  interface Window {
    electronAPI?: {
      checkForUpdates?: () => Promise<any>;
      installUpdate?: () => Promise<any>;
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

function statusBadgeClass(status: Entity["status"]) {
  return status === "On Track" ? "badge badgeGood" : "badge badgeWarn";
}

function statusPillClass(status: Entity["status"]) {
  return status === "On Track" ? "pill pillGood" : "pill pillWarn";
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [activeEntityId, setActiveEntityId] = useState<string>(ENTITIES[0].id);
  const [entitySearch, setEntitySearch] = useState("");
  const [settings, setSettings] = useState<SettingsState>(() => loadSettings());
  const [updateMsg, setUpdateMsg] = useState<string>("");

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
      case "dashboard":
        return "Dashboard";
      case "balance":
        return "Balance Sheet Reconciliation";
      case "merchant":
        return "Merchant Reconciliation";
      case "settings":
        return "Settings";
      case "help":
        return "Help";
      default:
        return "Dashboard";
    }
  }, [tab]);

  const breadcrumbMeta = useMemo(() => {
    if (tab === "settings" || tab === "help") return "Yomali Close Desktop • Close + Reconciliation Console";
    return `Active entity: ${activeEntity.name} • ERP: ${activeEntity.erp}`;
  }, [tab, activeEntity]);

  async function chooseFolder(which: "balance" | "merchant") {
    const picker = window.electronAPI?.pickFolder;
    if (!picker) {
      alert("Folder picker is not available (preload/electronAPI missing).");
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
  }

  async function checkForUpdates() {
    setUpdateMsg("Checking for updates…");
    try {
      const r = await window.electronAPI?.checkForUpdates?.();
      setUpdateMsg(
        r?.ok
          ? "Update check started (see logs). If an update is available it will download."
          : `Update check failed: ${r?.error || "Unknown error"}`
      );
    } catch (e: any) {
      setUpdateMsg(`Update check failed: ${String(e?.message || e)}`);
    }
  }

  return (
    <div className="appShell">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brandTitle">Yomali Close</div>
          <div className="brandSub">Close + Reconciliation Console</div>
        </div>

        <div className="nav">
          <div className="navLabel">Navigation</div>

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
            <h4>Entities</h4>
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
                <span className={statusPillClass(e.status)}>{e.status}</span>
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

      {/* MAIN */}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <div className="breadcrumbTitle">{breadcrumbTitle}</div>
            <div className="breadcrumbMeta">{breadcrumbMeta}</div>
          </div>

          <div className="actions">
            <button className="btn" onClick={checkForUpdates}>Check for Updates</button>
          </div>
        </header>

        <section className="content">
          {tab === "dashboard" && (
            <div className="grid2">
              <div className="card">
                <div className="cardHeader">
                  <div>
                    <h3 className="cardTitle">Month-End Close Snapshot</h3>
                    <p className="cardSub">High-level readiness across entities (demo metrics)</p>
                  </div>
                  <span className={statusBadgeClass(activeEntity.status)}>{activeEntity.status}</span>
                </div>

                <div className="cardBody">
                  <div className="kpiRow">
                    <div className="kpi">
                      <div className="kpiLabel">Entities Covered</div>
                      <div className="kpiValue">{ENTITIES.length}</div>
                      <div className="kpiNote">Balance sheet + merchant workflow</div>
                    </div>
                    <div className="kpi">
                      <div className="kpiLabel">At Risk</div>
                      <div className="kpiValue">{ENTITIES.filter((e) => e.status === "At Risk").length}</div>
                      <div className="kpiNote">Prioritize exceptions + approvals</div>
                    </div>
                    <div className="kpi">
                      <div className="kpiLabel">Recon Modules</div>
                      <div className="kpiValue">2</div>
                      <div className="kpiNote">Balance sheet + merchant</div>
                    </div>
                  </div>

                  <div className="hr" />

                  <table className="table">
                    <thead>
                      <tr>
                        <th>Entity</th>
                        <th>Status</th>
                        <th>ERP</th>
                        <th>Merchants</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ENTITIES.map((e) => (
                        <tr key={e.id}>
                          <td style={{ fontWeight: 600 }}>{e.name}</td>
                          <td>
                            <span className={statusBadgeClass(e.status)}>{e.status}</span>
                          </td>
                          <td>{e.erp}</td>
                          <td style={{ color: "var(--muted)" }}>{e.merchants.join(" • ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="hr" />
                  <div className="smallNote">
                    Merchant reconciliation is now engine-backed (always-on FastAPI service). Use the Merchant tab to view status and trigger runs.
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="cardHeader">
                  <div>
                    <h3 className="cardTitle">What’s in this build</h3>
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
                  <p className="cardSub">Recon workspace (demo) • Output path is controlled in Settings</p>
                </div>
                <span className={statusBadgeClass(activeEntity.status)}>{activeEntity.status}</span>
              </div>
              <div className="cardBody">
                <div className="smallNote">
                  Output folder (from Settings): <b>{settings.balanceSheetOutputDir || "Not set"}</b>
                </div>

                <div className="hr" />

                <table className="table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Expected</th>
                      <th>Actual</th>
                      <th>Variance</th>
                      <th>Resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Cash</td>
                      <td>$1,250,000</td>
                      <td>$1,246,420</td>
                      <td>
                        <span className="badge badgeWarn">-$3,580</span>
                      </td>
                      <td>Needs Review</td>
                    </tr>
                    <tr>
                      <td>Accounts Receivable</td>
                      <td>$980,000</td>
                      <td>$980,000</td>
                      <td>
                        <span className="badge badgeGood">$0</span>
                      </td>
                      <td>Resolved</td>
                    </tr>
                    <tr>
                      <td>Accrued Expenses</td>
                      <td>$410,000</td>
                      <td>$397,200</td>
                      <td>
                        <span className="badge badgeWarn">-$12,800</span>
                      </td>
                      <td>Needs Review</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "merchant" && (
            <div className="card">
              <div className="cardHeader">
                <div>
                  <h3 className="cardTitle">Merchant Reconciliation</h3>
                  <p className="cardSub">Engine-backed status + manual runs + downloads</p>
                </div>
                <span className={statusBadgeClass(activeEntity.status)}>{activeEntity.status}</span>
              </div>

              <div className="cardBody">
                {/* The MerchantReconciliation page talks to the always-on FastAPI engine over localhost */}
                <MerchantReconciliation />
              </div>
            </div>
          )}

          {tab === "settings" && (
            <div className="grid2">
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

              <div className="card">
                <div className="cardHeader">
                  <div>
                    <h3 className="cardTitle">Updates</h3>
                    <p className="cardSub">Manual fallback if auto-update doesn’t run</p>
                  </div>
                </div>
                <div className="cardBody">
                  <button className="btn btnPrimary" onClick={checkForUpdates}>Check for Updates</button>
                  <div style={{ marginTop: 10 }} className="smallNote">{updateMsg || " "}</div>
                  <div className="hr" />
                  <div className="smallNote">
                    If an update downloads, add an “Install update” button that calls <code>electronAPI.installUpdate()</code>.
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
                      <th>Question</th>
                      <th>Answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Why does the Merchant tab look different?</td>
                      <td>Merchant recon moved to an engine-backed dashboard (always-on service). The UI now triggers/monitors runs.</td>
                    </tr>
                    <tr>
                      <td>Where do exports go?</td>
                      <td>Set output folders in <b>Settings</b>. Engine outputs are organized by date per entity.</td>
                    </tr>
                    <tr>
                      <td>How do I check for updates?</td>
                      <td>Use <b>Check for Updates</b> in the top bar (or Settings → Updates).</td>
                    </tr>
                  </tbody>
                </table>

                <div className="hr" />
                <div className="smallNote">
                  If the Merchant dashboard is blank, check that the backend service is running and that <code>GET /health</code> returns ok.
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
