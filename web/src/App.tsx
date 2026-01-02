import React, { useMemo, useState } from "react";
import MerchantReconciliation from "./MerchantReconciliation";

// NOTE: This is a minimal App.tsx that assumes you already have your existing layout + tabs.
// Replace your Merchant tab body with <MerchantReconciliation /> and remove demo table + manual upload UI.

type TabKey = "overview" | "merchant" | "balancesheet" | "settings";

export default function App() {
  const [tab, setTab] = useState<TabKey>("merchant");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brandTitle">Yomali Reconciliation</div>
          <div className="brandSub">Local app • Auto recon + Super recon</div>
        </div>
        <nav className="tabs">
          <button className={"tab " + (tab === "overview" ? "active" : "")} onClick={() => setTab("overview")}>Overview</button>
          <button className={"tab " + (tab === "merchant" ? "active" : "")} onClick={() => setTab("merchant")}>Merchant Recon</button>
          <button className={"tab " + (tab === "balancesheet" ? "active" : "")} onClick={() => setTab("balancesheet")}>Balance Sheet</button>
          <button className={"tab " + (tab === "settings" ? "active" : "")} onClick={() => setTab("settings")}>Settings</button>
        </nav>
      </header>

      <main className="content">
        {tab === "merchant" && <MerchantReconciliation />}
        {tab !== "merchant" && (
          <div className="card">
            <div className="cardHeader">
              <div>
                <h3 className="cardTitle">Coming next</h3>
                <p className="cardSub">We will wire the other tabs after Merchant Recon is stable.</p>
              </div>
            </div>
            <div className="cardBody">
              <div className="smallNote">Select “Merchant Recon” to run daily reconciliations and export results.</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
