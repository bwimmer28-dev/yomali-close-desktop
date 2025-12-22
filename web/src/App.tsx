import React, { useMemo, useState } from "react";
import stalliantLogo from "./assets/stalliant.png";

type TabKey =
  | "dashboard"
  | "balanceSheet"
  | "merchantRecon"
  | "help"
  | "settings";

const ENTITIES = [
  "ClickCRM",
  "Helpgrid Inc",
  "Maxweb Inc",
  "GetPayment",
  "SmartFluent",
  "Yomali Holdings",
  "Yomali Labs",
];

declare global {
  interface Window {
    electronAPI?: {
      checkForUpdates?: () => Promise<boolean>;
      installUpdate?: () => Promise<boolean>;
    };
  }
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");

  // Settings (persist later if you want via localStorage)
  const [merchantOutPath, setMerchantOutPath] = useState(
    "C:\\StalliantLive\\Output\\Merchant Reconciliations"
  );
  const [balanceOutPath, setBalanceOutPath] = useState(
    "C:\\StalliantLive\\Output\\Balance Sheet Reconciliations"
  );

  const tabs = useMemo(
    () => [
      { key: "dashboard" as const, label: "Dashboard" },
      { key: "balanceSheet" as const, label: "Balance Sheet" },
      { key: "merchantRecon" as const, label: "Merchant Reconciliation" },
      { key: "help" as const, label: "Help" },
      { key: "settings" as const, label: "Settings" },
    ],
    []
  );

  async function handleCheckUpdates() {
    try {
      if (window.electronAPI?.checkForUpdates) {
        await window.electronAPI.checkForUpdates();
        alert("Checking for updates…");
      } else {
        alert("Update checker not available (are you running the packaged app?)");
      }
    } catch (e: any) {
      alert(`Update check failed: ${e?.message || e}`);
    }
  }

  return (
    <div style={styles.app}>
      {/* Top bar */}
      <div style={styles.topbar}>
        <div style={styles.brandLeft}>
          <div style={styles.logoWrap}>
            <img
              src={stalliantLogo}
              alt="Stalliant"
              style={styles.logoImg}
            />
          </div>
          <div>
            <div style={styles.title}>Stalliant Live</div>
            <div style={styles.subtitle}>Close + Reconciliation Toolkit</div>
          </div>
        </div>

        <div style={styles.topbarRight}>
          <button style={styles.ghostBtn} onClick={handleCheckUpdates}>
            Check for Updates
          </button>
        </div>
      </div>

      {/* Layout */}
      <div style={styles.layout}>
        {/* Sidebar */}
        <div style={styles.sidebar}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...styles.navBtn,
                ...(tab === t.key ? styles.navBtnActive : {}),
              }}
            >
              {t.label}
            </button>
          ))}

          <div style={styles.sidebarCard}>
            <div style={styles.cardTitle}>Entities</div>
            <div style={styles.entityList}>
              {ENTITIES.map((e) => (
                <div key={e} style={styles.entityPill}>
                  {e}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div style={styles.content}>
          {tab === "dashboard" && (
            <div style={styles.panel}>
              <h2 style={styles.h2}>Dashboard</h2>
              <div style={styles.grid2}>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>Merchant Recon Output Folder</div>
                  <div style={styles.kpiValue}>{merchantOutPath}</div>
                </div>
                <div style={styles.kpiCard}>
                  <div style={styles.kpiLabel}>Balance Sheet Output Folder</div>
                  <div style={styles.kpiValue}>{balanceOutPath}</div>
                </div>
              </div>

              <div style={{ ...styles.panel, marginTop: 16 }}>
                <div style={styles.sectionTitle}>Quick Actions</div>
                <div style={styles.row}>
                  <button style={styles.primaryBtn}>Run Merchant Reconciliation</button>
                  <button style={styles.primaryBtn}>Run Balance Sheet Reconciliation</button>
                  <button style={styles.ghostBtn} onClick={() => setTab("settings")}>
                    Settings
                  </button>
                </div>
                <div style={styles.note}>
                  Tip: outputs will be organized by date in the folders set in <b>Settings</b>.
                </div>
              </div>
            </div>
          )}

          {tab === "balanceSheet" && (
            <div style={styles.panel}>
              <h2 style={styles.h2}>Balance Sheet</h2>
              <div style={styles.note}>
                This is the staging area for balance sheet reconciliation outputs by entity and date.
              </div>

              <div style={styles.sectionTitle}>Entities in Scope</div>
              <ul style={styles.ul}>
                {ENTITIES.map((e) => (
                  <li key={e} style={styles.li}>{e}</li>
                ))}
              </ul>

              <div style={styles.sectionTitle}>Output Location</div>
              <div style={styles.pathBox}>{balanceOutPath}</div>
            </div>
          )}

          {tab === "merchantRecon" && (
            <div style={styles.panel}>
              <h2 style={styles.h2}>Merchant Reconciliation</h2>
              <div style={styles.note}>
                This is the staging area for merchant reconciliation outputs by entity and date.
              </div>

              <div style={styles.sectionTitle}>Entities in Scope</div>
              <ul style={styles.ul}>
                {ENTITIES.map((e) => (
                  <li key={e} style={styles.li}>{e}</li>
                ))}
              </ul>

              <div style={styles.sectionTitle}>Output Location</div>
              <div style={styles.pathBox}>{merchantOutPath}</div>
            </div>
          )}

          {tab === "help" && (
            <div style={styles.panel}>
              <h2 style={styles.h2}>Help & FAQs</h2>

              <div style={styles.faq}>
                <div style={styles.q}>Where do completed reconciliations go?</div>
                <div style={styles.a}>
                  Outputs are saved into the folders configured in <b>Settings</b>, organized by date.
                </div>
              </div>

              <div style={styles.faq}>
                <div style={styles.q}>How do I manually check for updates?</div>
                <div style={styles.a}>
                  Use <b>Help → Check for Updates</b> from the top menu, or click the
                  <b> “Check for Updates”</b> button in the top right of the app.
                </div>
              </div>

              <div style={styles.faq}>
                <div style={styles.q}>The app opens but looks blank / missing UI</div>
                <div style={styles.a}>
                  That usually means the packaged build couldn’t find its web assets.
                  We fixed this by setting Vite <code>base: "./"</code> and loading the built
                  <code> index.html</code> via Electron <code>loadFile()</code>.
                </div>
              </div>

              <div style={styles.panelDivider} />

              <div style={styles.sectionTitle}>Need help?</div>
              <div style={styles.note}>
                Email Brent:{" "}
                <a style={styles.link} href="mailto:brent.wimmer@stalliant.com">
                  brent.wimmer@stalliant.com
                </a>
              </div>
            </div>
          )}

          {tab === "settings" && (
            <div style={styles.panel}>
              <h2 style={styles.h2}>Settings</h2>

              <div style={styles.field}>
                <div style={styles.label}>Merchant Reconciliation Output Folder</div>
                <input
                  style={styles.input}
                  value={merchantOutPath}
                  onChange={(e) => setMerchantOutPath(e.target.value)}
                />
              </div>

              <div style={styles.field}>
                <div style={styles.label}>Balance Sheet Reconciliation Output Folder</div>
                <input
                  style={styles.input}
                  value={balanceOutPath}
                  onChange={(e) => setBalanceOutPath(e.target.value)}
                />
              </div>

              <div style={styles.note}>
                Next polish step: store these settings in a config file or localStorage so they
                persist per-user machine.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    height: "100vh",
    width: "100vw",
    background: "linear-gradient(135deg, #0b1220, #0f1b33)",
    color: "#e8eefc",
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, Arial",
  },
  topbar: {
    height: 76,
    padding: "14px 18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(10, 16, 30, 0.55)",
    backdropFilter: "blur(10px)",
  },
  brandLeft: { display: "flex", alignItems: "center", gap: 14 },
  logoWrap: {
    width: 170,
    height: 36,
    display: "flex",
    alignItems: "center",
  },
  logoImg: {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.35))",
  },
  title: { fontSize: 18, fontWeight: 700, letterSpacing: 0.2 },
  subtitle: { fontSize: 12, opacity: 0.8, marginTop: 2 },
  topbarRight: { display: "flex", alignItems: "center", gap: 10 },

  layout: { display: "flex", height: "calc(100vh - 76px)" },
  sidebar: {
    width: 260,
    padding: 14,
    borderRight: "1px solid rgba(255,255,255,0.10)",
  },
  navBtn: {
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#e8eefc",
    cursor: "pointer",
    marginBottom: 10,
  },
  navBtnActive: {
    background: "rgba(95, 155, 255, 0.18)",
    border: "1px solid rgba(95, 155, 255, 0.45)",
  },
  sidebarCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
  },
  cardTitle: { fontSize: 12, fontWeight: 700, opacity: 0.85, marginBottom: 10 },
  entityList: { display: "flex", flexWrap: "wrap", gap: 8 },
  entityPill: {
    fontSize: 11,
    padding: "6px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.12)",
  },

  content: { flex: 1, padding: 18, overflow: "auto" },
  panel: {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    padding: 16,
    boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
  },
  h2: { margin: 0, fontSize: 20, letterSpacing: 0.2 },
  sectionTitle: { marginTop: 14, fontSize: 13, fontWeight: 700, opacity: 0.9 },
  note: { marginTop: 10, fontSize: 12, opacity: 0.85, lineHeight: 1.45 },

  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 },
  kpiCard: {
    borderRadius: 16,
    padding: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.12)",
  },
  kpiLabel: { fontSize: 11, opacity: 0.8 },
  kpiValue: { marginTop: 8, fontSize: 12, fontWeight: 600, wordBreak: "break-word" },

  row: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 },
  primaryBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(95, 155, 255, 0.45)",
    background: "rgba(95, 155, 255, 0.18)",
    color: "#e8eefc",
    cursor: "pointer",
    fontWeight: 700,
  },
  ghostBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "#e8eefc",
    cursor: "pointer",
    fontWeight: 600,
  },

  field: { marginTop: 14 },
  label: { fontSize: 12, fontWeight: 700, opacity: 0.9, marginBottom: 6 },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.20)",
    color: "#e8eefc",
    outline: "none",
  },
  pathBox: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.12)",
    fontSize: 12,
    fontWeight: 600,
    wordBreak: "break-word",
  },

  ul: { marginTop: 10, paddingLeft: 18 },
  li: { fontSize: 12, opacity: 0.9, marginBottom: 6 },

  faq: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.12)",
  },
  q: { fontSize: 12, fontWeight: 800, marginBottom: 6 },
  a: { fontSize: 12, opacity: 0.9, lineHeight: 1.45 },

  panelDivider: {
    height: 1,
    background: "rgba(255,255,255,0.10)",
    marginTop: 16,
    marginBottom: 12,
  },
  link: { color: "#9cc1ff" },
};

