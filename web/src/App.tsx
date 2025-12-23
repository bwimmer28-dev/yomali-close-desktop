import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

type Tab = "merchant" | "balancesheet" | "dev" | "help" | "settings";

type Entity =
  | "ClickCRM"
  | "Helpgrid Inc"
  | "Maxweb Inc"
  | "GetPayment"
  | "SmartFluent"
  | "Yomali Holdings"
  | "Yomali Labs";

type TicketStatus = "New" | "Dev Investigating" | "Fix Deployed" | "Retest" | "Closed";

type DevTicket = {
  ticket_id: string;
  entity: Entity;
  period: string; // YYYY-MM
  source: "Merchant";
  processor: string;
  severity: "Low" | "Medium" | "High";
  issue_code: string;
  message: string;
  amount?: number | null;
  reference?: string | null;
  status: TicketStatus;
  created_at: string;
  notes_accounting?: string;
  notes_dev?: string;
};

declare global {
  interface Window {
    stalliant?: {
      settingsGet: () => Promise<any>;
      settingsSet: (patch: any) => Promise<any>;
      pickFolder: () => Promise<string | null>;
      pickFiles: (opts?: any) => Promise<string[]>;
      openPath: (p: string) => Promise<{ ok: boolean; error?: string }>;
      merchantReconcileNow: (payload: any) => Promise<any>;
      bsSaveReport: (payload: any) => Promise<any>;
    };
  }
}

const ENTITIES: Entity[] = [
  "ClickCRM",
  "Helpgrid Inc",
  "Maxweb Inc",
  "GetPayment",
  "SmartFluent",
  "Yomali Holdings",
  "Yomali Labs",
];

function monthOptions(backMonths = 18) {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < backMonths; i++) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${yyyy}-${mm}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

const CLICKCRM_BS_RECS = [
  "Clearing Account",
  "Shareholder Loan",
  "Accrued Expenses",
  "Retained Profit",
  "Prepaid Expenses",
  "Esquire Merchant Reserve",
  "Local Creditors",
  "Foreign Creditors",
  "VAT",
];

export default function App() {
  const [tab, setTab] = useState<Tab>("merchant");
  const [brandTitle, setBrandTitle] = useState("Stalliant Live");

  const [entity, setEntity] = useState<Entity>("Helpgrid Inc");
  const [period, setPeriod] = useState<string>(monthOptions(18)[0]);

  // Settings
  const [merchantOutputRoot, setMerchantOutputRoot] = useState<string>("");
  const [balanceSheetOutputRoot, setBalanceSheetOutputRoot] = useState<string>("");
  const [cadence, setCadence] = useState<{ enabled: boolean; frequency: "daily" | "hourly"; timeET: string }>({
    enabled: false,
    frequency: "daily",
    timeET: "23:00",
  });

  // Merchant inputs
  const [processor, setProcessor] = useState<string>("PayPal");
  const [crmFiles, setCrmFiles] = useState<string[]>([]);
  const [bankFiles, setBankFiles] = useState<string[]>([]);
  const [merchantFiles, setMerchantFiles] = useState<string[]>([]);
  const [merchantBusy, setMerchantBusy] = useState(false);
  const [lastMerchantReport, setLastMerchantReport] = useState<string | null>(null);

  // Dev tickets
  const [tickets, setTickets] = useState<DevTicket[]>(() => {
    try {
      const raw = localStorage.getItem("stalliant.dev.tickets");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("stalliant.dev.tickets", JSON.stringify(tickets));
    } catch {
      // no-op
    }
  }, [tickets]);

  // Load settings from Electron store
  useEffect(() => {
    (async () => {
      if (!window.stalliant) return;
      const s = await window.stalliant.settingsGet();
      if (s?.brandTitle) setBrandTitle(s.brandTitle);
      if (s?.merchantOutputRoot) setMerchantOutputRoot(s.merchantOutputRoot);
      if (s?.balanceSheetOutputRoot) setBalanceSheetOutputRoot(s.balanceSheetOutputRoot);
      if (s?.cadence) setCadence(s.cadence);
      if (s?.lastPeriod) setPeriod(s.lastPeriod);
    })();
  }, []);

  async function saveSettings(patch: any) {
    if (!window.stalliant) return;
    const s = await window.stalliant.settingsSet(patch);
    if (s?.brandTitle) setBrandTitle(s.brandTitle);
    if (s?.merchantOutputRoot) setMerchantOutputRoot(s.merchantOutputRoot);
    if (s?.balanceSheetOutputRoot) setBalanceSheetOutputRoot(s.balanceSheetOutputRoot);
    if (s?.cadence) setCadence(s.cadence);
    if (s?.lastPeriod) setPeriod(s.lastPeriod);
  }

  // Merchant actions
  async function pick(type: "crm" | "bank" | "merchant") {
    if (!window.stalliant) return;
    const picked = await window.stalliant.pickFiles({
      title: `Select ${type.toUpperCase()} file(s)`,
      multi: true,
      filters: [{ name: "Excel/CSV", extensions: ["xlsx", "xls", "csv"] }],
    });
    if (type === "crm") setCrmFiles(picked);
    if (type === "bank") setBankFiles(picked);
    if (type === "merchant") setMerchantFiles(picked);
  }

  async function reconcileNow() {
    if (!window.stalliant) return;
    setMerchantBusy(true);
    setLastMerchantReport(null);
    try {
      // persist last period
      await saveSettings({ lastPeriod: period });

      const res = await window.stalliant.merchantReconcileNow({
        entity,
        period,
        processor,
        crmFiles,
        bankFiles,
        merchantFiles,
      });

      if (res?.ok) {
        setLastMerchantReport(res.reportPath || null);

        // Any exceptions become Dev tickets
        const newTickets: DevTicket[] = (res.tickets || []) as DevTicket[];
        if (newTickets.length) {
          setTickets((prev) => [...newTickets, ...prev]);
          setTab("dev");
        }
      } else {
        alert("Reconcile failed.");
      }
    } catch (e: any) {
      alert(e?.message || "Reconcile failed.");
    } finally {
      setMerchantBusy(false);
    }
  }

  async function openPath(p: string) {
    if (!window.stalliant) return;
    const r = await window.stalliant.openPath(p);
    if (!r.ok) alert(r.error || "Failed to open file");
  }

  // Balance sheet: open existing or create output
  const bsRecs = useMemo(() => {
    // For now, seed ClickCRM with your known set; others can be extended
    if (entity === "ClickCRM") return CLICKCRM_BS_RECS;
    return [
      "Bank Reconciliation",
      "Intercompany",
      "Prepaids",
      "Accruals",
      "Merchant Clearing Rollforward",
    ];
  }, [entity]);

  async function saveBSOutput(reconName: string) {
    if (!window.stalliant) return;
    const r = await window.stalliant.bsSaveReport({
      entity,
      period,
      reconName,
      notes: "Phase 1: placeholder output generated by Stalliant Live. Attach support and tie-outs as needed.",
    });
    if (r?.ok && r?.reportPath) {
      await openPath(r.reportPath);
    }
  }

  function Shell({ children }: { children: React.ReactNode }) {
    return (
      <div style={styles.shell}>
        <div style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={styles.logoBox}>
              {/* Replace this src with your actual logo import later if you want bundler-managed assets */}
              <img src="/stalliant.png" alt="Stalliant" style={{ height: 24 }} />
            </div>
            <div>
              <div style={styles.title}>{brandTitle}</div>
              <div style={styles.subTitle}>Month-End Close Platform (Pilot)</div>
            </div>
          </div>

          <div style={styles.headerRight}>
            <div style={styles.pill}>Entity: {entity}</div>
            <div style={styles.pill}>Period: {period}</div>
          </div>
        </div>

        <div style={styles.tabs}>
          <TabButton active={tab === "merchant"} onClick={() => setTab("merchant")} label="Merchant" />
          <TabButton active={tab === "balancesheet"} onClick={() => setTab("balancesheet")} label="Balance Sheet" />
          <TabButton active={tab === "dev"} onClick={() => setTab("dev")} label={`Dev (${tickets.filter(t=>t.status!=="Closed").length})`} />
          <TabButton active={tab === "help"} onClick={() => setTab("help")} label="Help" />
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")} label="Settings" />
        </div>

        <div style={styles.content}>{children}</div>
      </div>
    );
  }

  return (
    <Shell>
      <div style={styles.topFilters}>
        <div style={styles.filterBlock}>
          <label style={styles.label}>Entity</label>
          <select value={entity} onChange={(e) => setEntity(e.target.value as Entity)} style={styles.select}>
            {ENTITIES.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </div>

        <div style={styles.filterBlock}>
          <label style={styles.label}>Period</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} style={styles.select}>
            {monthOptions(24).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {tab === "merchant" ? (
        <div style={styles.card}>
          <div style={styles.cardTitle}>Merchant Reconciliation</div>
          <div style={styles.cardSub}>Upload CRM + Bank + Merchant files and click Reconcile Now.</div>

          <div style={styles.grid2}>
            <div>
              <label style={styles.label}>Processor</label>
              <select value={processor} onChange={(e) => setProcessor(e.target.value)} style={styles.select}>
                {["PayPal", "Braintree", "Stripe", "Other"].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
              <button onClick={reconcileNow} disabled={merchantBusy} style={styles.primaryBtn}>
                {merchantBusy ? "Reconciling..." : "Reconcile Now"}
              </button>

              {lastMerchantReport ? (
                <button onClick={() => openPath(lastMerchantReport)} style={styles.secondaryBtn}>
                  Open Last Report
                </button>
              ) : null}
            </div>
          </div>

          <div style={styles.grid3}>
            <FilePicker
              title="CRM Files"
              subtitle="Exports from CRM (Dynamics / operational data)"
              files={crmFiles}
              onPick={() => pick("crm")}
              onClear={() => setCrmFiles([])}
            />
            <FilePicker
              title="Bank Files"
              subtitle="Bank statement exports / activity"
              files={bankFiles}
              onPick={() => pick("bank")}
              onClear={() => setBankFiles([])}
            />
            <FilePicker
              title="Merchant Files"
              subtitle="PayPal / Braintree / Stripe settlements"
              files={merchantFiles}
              onPick={() => pick("merchant")}
              onClear={() => setMerchantFiles([])}
            />
          </div>

          <div style={styles.note}>
            Output: saved to Settings → Merchant Output Root → {processor} → {period}. Any unreconciled items create Dev tickets.
          </div>
        </div>
      ) : null}

      {tab === "balancesheet" ? (
        <div style={styles.card}>
          <div style={styles.cardTitle}>Balance Sheet Reconciliations</div>
          <div style={styles.cardSub}>
            Track entity reconciliations by period. Click to generate/open a standardized output workbook.
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {bsRecs.map((r) => (
              <div key={r} style={styles.row}>
                <div style={{ fontWeight: 600 }}>{r}</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => saveBSOutput(r)} style={styles.secondaryBtn}>
                    Create / Open Output
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={styles.note}>
            Phase 1: Balance Sheet items do <b>not</b> create Dev tickets. They’re tracked and saved as Excel outputs under Settings → Balance Sheet Output Root.
          </div>
        </div>
      ) : null}

      {tab === "dev" ? (
        <div style={styles.card}>
          <div style={styles.cardTitle}>Dev Team Queue</div>
          <div style={styles.cardSub}>Discrepancies created by merchant engines show up here as tickets.</div>

          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Entity</th>
                  <th>Period</th>
                  <th>Processor</th>
                  <th>Severity</th>
                  <th>Issue</th>
                  <th>Status</th>
                  <th>Notes (Dev)</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.ticket_id}>
                    <td style={{ whiteSpace: "nowrap" }}>{t.ticket_id}</td>
                    <td>{t.entity}</td>
                    <td>{t.period}</td>
                    <td>{t.processor}</td>
                    <td>{t.severity}</td>
                    <td>{t.issue_code}</td>
                    <td>
                      <select
                        value={t.status}
                        onChange={(e) => {
                          const status = e.target.value as TicketStatus;
                          setTickets((prev) =>
                            prev.map((x) => (x.ticket_id === t.ticket_id ? { ...x, status } : x))
                          );
                        }}
                        style={styles.selectSmall}
                      >
                        {["New", "Dev Investigating", "Fix Deployed", "Retest", "Closed"].map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={t.notes_dev || ""}
                        onChange={(e) =>
                          setTickets((prev) =>
                            prev.map((x) => (x.ticket_id === t.ticket_id ? { ...x, notes_dev: e.target.value } : x))
                          )
                        }
                        placeholder="Dev notes…"
                        style={styles.inputSmall}
                      />
                    </td>
                  </tr>
                ))}
                {tickets.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 14, color: "#98A2B3" }}>
                      No tickets yet — run a Merchant reconciliation to generate exceptions.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div style={styles.note}>
            Phase 1 tickets are stored locally in the app. Phase 2: we sync tickets to a shared service so Accounting + Dev see the same queue.
          </div>
        </div>
      ) : null}

      {tab === "help" ? (
        <div style={styles.card}>
          <div style={styles.cardTitle}>Help</div>
          <div style={styles.cardSub}>Quick answers for navigating Stalliant Live.</div>

          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <FAQ q="How do I run a Merchant reconciliation?">
              Go to <b>Merchant</b> tab → select period + entity → pick CRM/Bank/Merchant files → click <b>Reconcile Now</b>.
              The output Excel report is saved automatically and exceptions create Dev tickets.
            </FAQ>

            <FAQ q="Where are reports saved?">
              In <b>Settings</b>, set Merchant and Balance Sheet output folders. Outputs are organized by type/entity/period automatically.
            </FAQ>

            <FAQ q="What happens when there’s a discrepancy?">
              Merchant discrepancies create a ticket on the <b>Dev</b> tab. Dev updates status/notes so Accounting can track progress.
            </FAQ>

            <FAQ q="Need help or found a bug?">
              Email: <a href="mailto:brent.wimmer@stalliant.com">brent.wimmer@stalliant.com</a>
            </FAQ>
          </div>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div style={styles.card}>
          <div style={styles.cardTitle}>Settings</div>
          <div style={styles.cardSub}>Paths, cadence, and utilities.</div>

          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <div style={styles.row}>
              <div>
                <div style={{ fontWeight: 700 }}>Merchant Output Root</div>
                <div style={styles.muted}>{merchantOutputRoot}</div>
              </div>
              <button
                style={styles.secondaryBtn}
                onClick={async () => {
                  const p = await window.stalliant?.pickFolder();
                  if (p) await saveSettings({ merchantOutputRoot: p });
                }}
              >
                Change…
              </button>
            </div>

            <div style={styles.row}>
              <div>
                <div style={{ fontWeight: 700 }}>Balance Sheet Output Root</div>
                <div style={styles.muted}>{balanceSheetOutputRoot}</div>
              </div>
              <button
                style={styles.secondaryBtn}
                onClick={async () => {
                  const p = await window.stalliant?.pickFolder();
                  if (p) await saveSettings({ balanceSheetOutputRoot: p });
                }}
              >
                Change…
              </button>
            </div>

            <div style={styles.row}>
              <div>
                <div style={{ fontWeight: 700 }}>Merchant Auto-Run (future)</div>
                <div style={styles.muted}>Schedule nightly reconciliation runs (ET). Manual button is always available on Merchant tab.</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div style={styles.cardMini}>
                <div style={styles.mutedSmall}>Enabled</div>
                <select
                  value={cadence.enabled ? "yes" : "no"}
                  onChange={(e) => saveSettings({ cadence: { ...cadence, enabled: e.target.value === "yes" } })}
                  style={styles.select}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div style={styles.cardMini}>
                <div style={styles.mutedSmall}>Frequency</div>
                <select
                  value={cadence.frequency}
                  onChange={(e) => saveSettings({ cadence: { ...cadence, frequency: e.target.value } })}
                  style={styles.select}
                >
                  <option value="daily">daily</option>
                  <option value="hourly">hourly</option>
                </select>
              </div>
              <div style={styles.cardMini}>
                <div style={styles.mutedSmall}>Time (ET)</div>
                <input
                  value={cadence.timeET}
                  onChange={(e) => saveSettings({ cadence: { ...cadence, timeET: e.target.value } })}
                  style={styles.input}
                  placeholder="23:00"
                />
              </div>
            </div>

            <div style={styles.row}>
              <div>
                <div style={{ fontWeight: 700 }}>Check for Updates (manual)</div>
                <div style={styles.muted}>Phase 1 placeholder. We can wire this to electron-updater IPC next.</div>
              </div>
              <button
                style={styles.secondaryBtn}
                onClick={() => alert("Manual update check will be wired next (electron-updater IPC).")}
              >
                Check Now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 12,
        border: active ? "1px solid rgba(255,255,255,0.20)" : "1px solid rgba(255,255,255,0.08)",
        background: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
        color: "white",
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function FilePicker({
  title,
  subtitle,
  files,
  onPick,
  onClear,
}: {
  title: string;
  subtitle: string;
  files: string[];
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div style={styles.cardMini}>
      <div style={{ fontWeight: 800 }}>{title}</div>
      <div style={styles.mutedSmall}>{subtitle}</div>
      <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
        <button style={styles.secondaryBtn} onClick={onPick}>Select file(s)…</button>
        <button style={styles.ghostBtn} onClick={onClear}>Clear</button>
      </div>
      <div style={{ marginTop: 10, maxHeight: 120, overflow: "auto" }}>
        {files.length ? (
          <ul style={{ margin: 0, paddingLeft: 16, color: "#D0D5DD" }}>
            {files.map((f) => (
              <li key={f} style={{ fontSize: 12 }}>{f}</li>
            ))}
          </ul>
        ) : (
          <div style={styles.mutedSmall}>No files selected.</div>
        )}
      </div>
    </div>
  );
}

function FAQ({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div style={styles.cardMini}>
      <div style={{ fontWeight: 800 }}>{q}</div>
      <div style={{ marginTop: 6, color: "#D0D5DD", fontSize: 13, lineHeight: 1.4 }}>{children}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    background: "radial-gradient(1200px 600px at 30% 0%, rgba(99,102,241,0.25), transparent 55%), radial-gradient(900px 500px at 85% 20%, rgba(56,189,248,0.18), transparent 60%), #070B16",
    color: "white",
    padding: 22,
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    padding: 18,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(12px)",
  },
  logoBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  title: { fontSize: 18, fontWeight: 900, letterSpacing: 0.2 },
  subTitle: { fontSize: 12, color: "#98A2B3", marginTop: 2 },
  headerRight: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" },
  pill: {
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    color: "#D0D5DD",
    fontSize: 12,
    fontWeight: 700,
  },
  tabs: { display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" },
  content: { marginTop: 16, display: "grid", gap: 14 },
  topFilters: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    padding: 14,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.035)",
  },
  filterBlock: { display: "grid", gap: 6, minWidth: 220 },
  label: { fontSize: 12, color: "#98A2B3", fontWeight: 700 },
  select: {
    height: 40,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "white",
    padding: "0 10px",
    outline: "none",
  },
  card: {
    padding: 18,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(12px)",
  },
  cardTitle: { fontSize: 16, fontWeight: 900 },
  cardSub: { marginTop: 6, fontSize: 13, color: "#98A2B3" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 14 },
  cardMini: {
    padding: 14,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.20)",
  },
  primaryBtn: {
    height: 40,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid rgba(99,102,241,0.40)",
    background: "rgba(99,102,241,0.24)",
    color: "white",
    fontWeight: 900,
    cursor: "pointer",
  },
  secondaryBtn: {
    height: 40,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
  },
  ghostBtn: {
    height: 40,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "transparent",
    color: "#D0D5DD",
    fontWeight: 800,
    cursor: "pointer",
  },
  note: { marginTop: 12, fontSize: 12, color: "#98A2B3" },
  muted: { fontSize: 12, color: "#98A2B3", marginTop: 4, maxWidth: 720, wordBreak: "break-word" },
  mutedSmall: { fontSize: 12, color: "#98A2B3", marginTop: 6 },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
    alignItems: "center",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
  },
  selectSmall: {
    height: 32,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "white",
    padding: "0 8px",
  },
  input: {
    height: 40,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "white",
    padding: "0 10px",
    outline: "none",
  },
  inputSmall: {
    height: 32,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "white",
    padding: "0 8px",
    width: 240,
  },
};

