// web/src/App.tsx
import React, { useMemo, useState } from "react";
import { downloadXlsx, reconcile, type ReconResponse } from "./lib/reconApi";

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
  { id: "helpgrid", name: "Helpgrid Inc", status: "At Risk", erp: "NetSuite", merchants: ["Braintree"] },
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
      // from preload
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

  // --- Merchant Recon (wired to backend) ---
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [erpFile, setErpFile] = useState<File | null>(null);
  const [processorFiles, setProcessorFiles] = useState<Record<string, File | null>>({});
  const [reconBusy, setReconBusy] = useState(false);
  const [reconErr, setReconErr] = useState<string>("");
  const [reconResult, setReconResult] = useState<ReconResponse | null>(null);
  const [lastDownloadToken, setLastDownloadToken] = useState<string>("");
  const [tolerance, setTolerance] = useState<number>(0.01);
  const [dateWindow, setDateWindow] = useState<number>(3);
  const [allowAmountOnly, setAllowAmountOnly] = useState<boolean>(true);

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
    if (tab === "settings" || tab === "help") return "Stalliant Live • Close + Reconciliation Console";
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
      setUpdateMsg(r?.ok ? "Update check started (see logs). If an update is available it will download." : `Update check failed: ${r?.error || "Unknown error"}`);
    } catch (e: any) {
      setUpdateMsg(`Update check failed: ${String(e?.message || e)}`);
    }
  }

  async function exportCurrent() {
    // For now, export is wired for Merchant Recon only (backend produces XLSX).
    if (tab !== "merchant") {
      alert("Export is currently wired for Merchant Reconciliation only.");
      return;
    }
    const token = lastDownloadToken || reconResult?.download_token;
    if (!token) {
      alert("Nothing to export yet. Run Checks first.");
      return;
    }
    try {
      const blob = await downloadXlsx(token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `merchant_recon_${activeEntity.id}_${new Date().toISOString().slice(0,10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`Export failed: ${String(e?.message || e)}`);
    }
  }

  async function runChecks() {
    if (tab !== "merchant") {
      alert("Run Checks is currently wired for Merchant Reconciliation only.");
      return;
    }
    setReconErr("");
    setReconResult(null);
    setLastDownloadToken("");
    if (!bankFile) return setReconErr("Please select a BANK file.");
    if (!erpFile) return setReconErr("Please select an ERP file.");

    const procs = (activeEntity.merchants || []).map((m) => ({
      type: m,
      file: processorFiles[m] || null,
    }));
    const missing = procs.filter((p) => !p.file).map((p) => p.type);
    if (missing.length) return setReconErr(`Please select processor file(s) for: ${missing.join(", ")}`);

    setReconBusy(true);
    try {
      const resp = await reconcile({
        entity: activeEntity.name,
        bankFile,
        erpFile,
        processorFiles: procs.map((p) => ({ type: p.type, file: p.file as File })),
        amountTolerance: tolerance,
        dateWindowDays: dateWindow,
        allowAmountOnly,
      });
      setReconResult(resp);
      setLastDownloadToken(resp.download_token);
    } catch (e: any) {
      setReconErr(String(e?.message || e));
    } finally {
      setReconBusy(false);
    }
  }

  return (
    <div className="appShell">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brandTitle">Stalliant Live</div>
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
            <div><span className="badge">{activeEntity.erp}</span></div>
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
            {(tab === "balance" || tab === "merchant") && (
              <>
                <button className="btn" onClick={exportCurrent}>Export</button>
                <button className="btn btnPrimary" onClick={runChecks} disabled={reconBusy}>Run Checks</button>
              </>
            )}
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
                      <div className="kpiValue">{ENTITIES.filter(e => e.status === "At Risk").length}</div>
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
                      {ENTITIES.map(e => (
                        <tr key={e.id}>
                          <td style={{ fontWeight: 600 }}>{e.name}</td>
                          <td><span className={statusBadgeClass(e.status)}>{e.status}</span></td>
                          <td>{e.erp}</td>
                          <td style={{ color: "var(--muted)" }}>{e.merchants.join(" • ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="hr" />
                  <div className="smallNote">
                    Next: wire the “Run Checks” and “Export” buttons to your actual reconciliation engine, using output paths set in <b>Settings</b>.
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="cardHeader">
                  <div>
                    <h3 className="cardTitle">What’s in this build</h3>
                    <p className="cardSub">From your requirements list</p>
                  </div>
                </div>
                <div className="cardBody">
                  <div className="smallNote">
                    <div className="badge">Tabs restored</div> Dashboard, Balance Sheet, Merchant Recon, Settings, Help
                    <div style={{ height: 10 }} />
                    <div className="badge">Entities restored</div> ClickCRM, Helpgrid Inc, Maxweb Inc, GetPayment, SmartFluent, Yomali Holdings, Yomali Labs
                    <div style={{ height: 10 }} />
                    <div className="badge">Manual update check</div> “Check for Updates” button
                    <div style={{ height: 10 }} />
                    <div className="badge">Help email</div> mailto: brent.wimmer@stalliant.com
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
                  This tab will become your balance sheet recon workflow for <b>{activeEntity.name}</b>.
                  <div className="hr" />
                  <div>
                    Output folder (from Settings):{" "}
                    <b>{settings.balanceSheetOutputDir || "Not set"}</b>
                  </div>
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
                      <td><span className="badge badgeWarn">-$3,580</span></td>
                      <td>Needs Review</td>
                    </tr>
                    <tr>
                      <td>Accounts Receivable</td>
                      <td>$980,000</td>
                      <td>$980,000</td>
                      <td><span className="badge badgeGood">$0</span></td>
                      <td>Resolved</td>
                    </tr>
                    <tr>
                      <td>Accrued Expenses</td>
                      <td>$410,000</td>
                      <td>$397,200</td>
                      <td><span className="badge badgeWarn">-$12,800</span></td>
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
                  <p className="cardSub">Processor settlements vs ERP postings (wired to local API)</p>
                </div>
                <span className={statusBadgeClass(activeEntity.status)}>{activeEntity.status}</span>
              </div>

              <div className="cardBody">
                <div className="smallNote">
                  Active entity: <b>{activeEntity.name}</b> • ERP: <b>{activeEntity.erp}</b>
                  <div style={{ marginTop: 8 }}>
                    Merchants:{" "}
                    <span style={{ color: "var(--muted)" }}>{activeEntity.merchants.join(" • ")}</span>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    Output folder (from Settings):{" "}
                    <b>{settings.merchantReconOutputDir || "Not set"}</b>
                  </div>
                </div>

                <div className="hr" />

                <div className="grid2" style={{ alignItems: "start" }}>
                  <div className="card" style={{ margin: 0 }}>
                    <div className="cardHeader">
                      <div>
                        <h3 className="cardTitle">Inputs</h3>
                        <p className="cardSub">Select files, then click Run Checks</p>
                      </div>
                    </div>
                    <div className="cardBody">
                      <div className="formRow" style={{ gap: 10, alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                          <div className="smallNote" style={{ marginBottom: 6 }}><b>Bank</b></div>
                          <input
                            type="file"
                            className="field"
                            onChange={(e) => setBankFile(e.target.files?.[0] || null)}
                          />
                          <div className="smallNote" style={{ marginTop: 6, color: "var(--muted)" }}>
                            {bankFile ? bankFile.name : "No bank file selected"}
                          </div>
                        </div>
                      </div>

                      <div className="formRow" style={{ gap: 10, alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                          <div className="smallNote" style={{ marginBottom: 6 }}><b>ERP</b></div>
                          <input
                            type="file"
                            className="field"
                            onChange={(e) => setErpFile(e.target.files?.[0] || null)}
                          />
                          <div className="smallNote" style={{ marginTop: 6, color: "var(--muted)" }}>
                            {erpFile ? erpFile.name : "No ERP file selected"}
                          </div>
                        </div>
                      </div>

                      <div className="hr" />

                      <div className="smallNote" style={{ marginBottom: 8 }}><b>Processor files</b></div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {activeEntity.merchants.map((m) => (
                          <div key={m} className="formRow" style={{ gap: 10, alignItems: "center" }}>
                            <div style={{ width: 130, fontWeight: 600 }}>{m}</div>
                            <input
                              type="file"
                              className="field"
                              onChange={(e) =>
                                setProcessorFiles((prev) => ({ ...prev, [m]: e.target.files?.[0] || null }))
                              }
                            />
                          </div>
                        ))}
                      </div>

                      <div className="hr" />

                      <div className="smallNote" style={{ marginBottom: 8 }}><b>Matching controls</b></div>
                      <div className="formRow">
                        <label className="smallNote" style={{ minWidth: 160 }}>Amount tolerance ($)</label>
                        <input
                          className="field"
                          style={{ maxWidth: 160 }}
                          value={String(tolerance)}
                          onChange={(e) => setTolerance(Number(e.target.value || 0))}
                        />
                      </div>
                      <div className="formRow">
                        <label className="smallNote" style={{ minWidth: 160 }}>Date window (days)</label>
                        <input
                          className="field"
                          style={{ maxWidth: 160 }}
                          value={String(dateWindow)}
                          onChange={(e) => setDateWindow(Number(e.target.value || 0))}
                        />
                      </div>
                      <div className="formRow" style={{ alignItems: "center" }}>
                        <label className="smallNote" style={{ minWidth: 160 }}>Allow amount-only fallback</label>
                        <input
                          type="checkbox"
                          checked={allowAmountOnly}
                          onChange={(e) => setAllowAmountOnly(e.target.checked)}
                        />
                      </div>

                      {reconErr && (
                        <div className="hr" />
                      )}
                      {reconErr && (
                        <div className="smallNote" style={{ color: "var(--danger)" }}>
                          <b>Error:</b> {reconErr}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="card" style={{ margin: 0 }}>
                    <div className="cardHeader">
                      <div>
                        <h3 className="cardTitle">Results</h3>
                        <p className="cardSub">Summary + Exceptions from the recon engine</p>
                      </div>
                      <div className="smallNote">
                        {reconBusy ? "Running…" : reconResult ? "Ready" : "Run Checks to populate"}
                      </div>
                    </div>
                    <div className="cardBody">
                      {!reconResult && (
                        <div className="smallNote">
                          When you click <b>Run Checks</b>, we POST the selected files to the local API and receive:
                          <div style={{ marginTop: 8, color: "var(--muted)" }}>
                            • Summary rows<br />
                            • Exceptions needing review<br />
                            • A downloadable XLSX token (Export)
                          </div>
                        </div>
                      )}

                      {reconResult && (
                        <>
                          <div className="kpiRow">
                            <div className="kpi">
                              <div className="kpiLabel">Summary rows</div>
                              <div className="kpiValue">{reconResult.counts.summary_rows}</div>
                              <div className="kpiNote">Totals by source</div>
                            </div>
                            <div className="kpi">
                              <div className="kpiLabel">Exceptions</div>
                              <div className="kpiValue">{reconResult.counts.exceptions_rows}</div>
                              <div className="kpiNote">Needs review</div>
                            </div>
                            <div className="kpi">
                              <div className="kpiLabel">Export token</div>
                              <div className="kpiValue" style={{ fontSize: 14 }}>{reconResult.download_token.slice(0, 8)}…</div>
                              <div className="kpiNote">Use Export</div>
                            </div>
                          </div>

                          <div className="hr" />

                          <div className="smallNote" style={{ marginBottom: 8 }}><b>Summary</b></div>
                          <table className="table">
                            <thead>
                              <tr>
                                {Object.keys(reconResult.summary?.[0] || { source: 1, rows: 1, total_amount: 1 }).map((k) => (
                                  <th key={k}>{k}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {reconResult.summary.map((r, idx) => (
                                <tr key={idx}>
                                  {Object.keys(reconResult.summary?.[0] || {}).map((k) => (
                                    <td key={k}>{String((r as any)[k] ?? "")}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <div className="hr" />

                          <div className="smallNote" style={{ marginBottom: 8 }}><b>Exceptions (top 50)</b></div>
                          <table className="table">
                            <thead>
                              <tr>
                                {Object.keys(reconResult.exceptions?.[0] || { stage: 1, source: 1, amount: 1, date: 1, issue: 1 }).map((k) => (
                                  <th key={k}>{k}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {reconResult.exceptions.slice(0, 50).map((r, idx) => (
                                <tr key={idx}>
                                  {Object.keys(reconResult.exceptions?.[0] || {}).map((k) => (
                                    <td key={k}>{String((r as any)[k] ?? "")}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <div className="hr" />
                          <div className="smallNote">
                            Next step: we’ll add an “Exception Resolution” UI (approve/match/split) and then generate JEs.
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
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
                    Tip: Your export routine can create subfolders like:
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
                    If an update downloads, you can add an “Install update” button that calls <code>electronAPI.installUpdate()</code>.
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
                <a className="btn btnPrimary" href="mailto:brent.wimmer@stalliant.com?subject=Stalliant%20Live%20Support">
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
                      <td>Where do exports go?</td>
                      <td>Set output folders in <b>Settings</b>. Exports will be organized by date.</td>
                    </tr>
                    <tr>
                      <td>What does “Needs Review” mean?</td>
                      <td>The engine found a mismatch (amount/date/entity) that requires approval before JE/export.</td>
                    </tr>
                    <tr>
                      <td>How do I check for updates?</td>
                      <td>Use <b>Check for Updates</b> in the top bar (or Settings → Updates).</td>
                    </tr>
                    <tr>
                      <td>Who do I contact?</td>
                      <td>Email <b>brent.wimmer@stalliant.com</b> with screenshots + steps to reproduce.</td>
                    </tr>
                  </tbody>
                </table>

                <div className="hr" />
                <div className="smallNote">
                  Next: we’ll keep updating these FAQs as we add features (merchant import rules, JE templates, exception resolution flow, etc.).
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
