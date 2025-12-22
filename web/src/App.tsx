import React, { useMemo, useState } from "react";

type PackageKey = "helpgrid" | "maxweb";

type RunResponse = {
  run_id: string;
  engine: { dashboard_data: string; dev_queue: string };
  reports: string;
};

type TaskStatus = "COMPLETED" | "IN_PROGRESS" | "PENDING";

type CloseTask = {
  id: string;
  entity: string;
  category: "Merchant" | "Balance Sheet";
  name: string;
  assignee: string;
  dueDate: string;
  status: TaskStatus;
  exceptionsOpen: number;
  assignedTeam?: "Accounting" | "Dev Team";
  lastRun?: string;
};

type DevIssue = {
  exception_id: string;
  entity: string;
  period: string;
  issue_code: string;
  severity: "Low" | "Medium" | "High";
  status: string;
  message: string;
  amount?: number | null;
  reference?: string | null;
  updated_at?: string;
};

export default function App() {
  const [apiBase, setApiBase] = useState<string>(() => {
    // change to ngrok url for sharing
    return "http://localhost:8000";
  });
  const [pkg, setPkg] = useState<PackageKey>("helpgrid");

  const [merchantFiles, setMerchantFiles] = useState<File[]>([]);
  const [erpFiles, setErpFiles] = useState<File[]>([]);
  const [bankFiles, setBankFiles] = useState<File[]>([]);

  const [settlementLagDays, setSettlementLagDays] = useState<number>(2);
  const [lookbackDays, setLookbackDays] = useState<number>(21);

  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const [tasks, setTasks] = useState<CloseTask[] | null>(null);
  const [issues, setIssues] = useState<DevIssue[] | null>(null);
  const [reports, setReports] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function runRecon() {
    setRunning(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("package", pkg);
      form.append("settlement_lag_days", String(settlementLagDays));
      form.append("lookback_days", String(lookbackDays));
      merchantFiles.forEach((f) => form.append("merchant_files", f));
      erpFiles.forEach((f) => form.append("erp_files", f));
      bankFiles.forEach((f) => form.append("bank_files", f));

      const res = await fetch(`${apiBase}/api/merchant/run`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Run failed (HTTP ${res.status})`);
      const json = (await res.json()) as RunResponse;
      setRunId(json.run_id);

      const dashRes = await fetch(`${apiBase}${json.engine.dashboard_data}`, { cache: "no-store" });
      const devRes = await fetch(`${apiBase}${json.engine.dev_queue}`, { cache: "no-store" });
      const dashJson = await dashRes.json();
      const devJson = await devRes.json();

      setTasks(Array.isArray(dashJson?.tasks) ? (dashJson.tasks as CloseTask[]) : []);
      setIssues(Array.isArray(devJson?.issues) ? (devJson.issues as DevIssue[]) : []);

      const repRes = await fetch(`${apiBase}${json.reports}`, { cache: "no-store" });
      const repJson = await repRes.json();
      setReports(Array.isArray(repJson) ? repJson : []);
    } catch (e: any) {
      setError(e?.message || "Failed to run");
    } finally {
      setRunning(false);
    }
  }

  const taskSummary = useMemo(() => {
    const t = tasks || [];
    const open = t.reduce((acc, x) => acc + (x.exceptionsOpen || 0), 0);
    return { count: t.length, open };
  }, [tasks]);

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui", padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>Yomali Close — Live Demo</div>
          <div style={{ color: "#555", marginTop: 4 }}>
            Per-package Merchant reconciliation: Helpgrid vs MaxWeb (uploads → API → engine JSON → dashboard)
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "block" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>API Base URL</div>
            <input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              placeholder="http://localhost:8000"
            />
          </label>

          <label style={{ display: "block" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Package</div>
            <select
              value={pkg}
              onChange={(e) => setPkg(e.target.value as PackageKey)}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            >
              <option value="helpgrid">Helpgrid</option>
              <option value="maxweb">MaxWeb</option>
            </select>
          </label>

          <label style={{ display: "block" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Settlement lag days</div>
            <input
              type="number"
              value={settlementLagDays}
              onChange={(e) => setSettlementLagDays(Number(e.target.value || 0))}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>

          <label style={{ display: "block" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Lookback days</div>
            <input
              type="number"
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value || 0))}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>
        </div>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <label>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Merchant files</div>
            <input type="file" multiple onChange={(e) => setMerchantFiles(Array.from(e.target.files || []))} />
            <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>{merchantFiles.length} selected</div>
          </label>

          <label>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>ERP files</div>
            <input type="file" multiple onChange={(e) => setErpFiles(Array.from(e.target.files || []))} />
            <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>{erpFiles.length} selected</div>
          </label>

          <label>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Bank files</div>
            <input type="file" multiple onChange={(e) => setBankFiles(Array.from(e.target.files || []))} />
            <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>{bankFiles.length} selected</div>
          </label>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={runRecon}
            disabled={running}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #222",
              background: running ? "#eee" : "#111",
              color: running ? "#333" : "white",
              cursor: running ? "default" : "pointer",
              fontWeight: 600,
            }}
          >
            {running ? "Running..." : "Run Reconciliation"}
          </button>

          {runId ? <span style={{ color: "#555" }}>Run: <b>{runId}</b></span> : null}
          {error ? <span style={{ color: "crimson" }}>{error}</span> : null}
        </div>
      </div>

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Tasks</div>
          <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
            {tasks ? `${taskSummary.count} tasks • ${taskSummary.open} open exceptions` : "No run yet"}
          </div>
          <div style={{ marginTop: 10 }}>
            {(tasks || []).map((t) => (
              <div key={t.id} style={{ padding: 10, border: "1px solid #eee", borderRadius: 10, marginBottom: 8 }}>
                <div style={{ fontWeight: 650 }}>{t.name}</div>
                <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                  Entity: {t.entity} • Status: {t.status} • Open exceptions: {t.exceptionsOpen}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Dev Queue</div>
          <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
            {issues ? `${issues.length} items` : "No run yet"}
          </div>
          <div style={{ marginTop: 10 }}>
            {(issues || []).map((i) => (
              <div key={i.exception_id} style={{ padding: 10, border: "1px solid #eee", borderRadius: 10, marginBottom: 8 }}>
                <div style={{ fontWeight: 650 }}>{i.exception_id} • {i.severity}</div>
                <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                  {i.entity} • {i.issue_code} • {i.status}
                </div>
                <div style={{ marginTop: 6 }}>{i.message}</div>
                {i.reference ? <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>Ref: {i.reference}</div> : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Reports</div>
        <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
          Downloads served by API for this run.
        </div>
        <div style={{ marginTop: 10 }}>
          {reports.length ? (
            <ul>
              {reports.map((r) => (
                <li key={r}>
                  <a href={`${apiBase}/api/runs/${runId}/reports/${r}`} target="_blank" rel="noreferrer">
                    {r}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ color: "#666" }}>No reports yet.</div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12, color: "#666", fontSize: 12 }}>
        Note: This is a minimal “live demo” harness. Once you plug your real recon engines into the API, the dashboard will display the real output.
      </div>
    </div>
  );
}
