// web/src/MerchantReconciliation.tsx
import { useEffect, useMemo, useState } from "react";
import { apiStatus, downloadXlsx, runDaily, runNow, type StatusResponse } from "./lib/reconApi";

function fmtMoney(x: any) {
  const n = Number(x);
  if (Number.isFinite(n)) return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  return String(x ?? "");
}

function fmtDate(x: any) {
  if (!x) return "—";
  return String(x);
}

export default function MerchantReconciliation() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [entityId, setEntityId] = useState("helpgrid");

  // manual run controls
  const [manualDate, setManualDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });

  // results
  const [result, setResult] = useState<any>(null);

  async function refresh() {
    try {
      const s = await apiStatus();
      setStatus(s);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 15000);
    return () => window.clearInterval(t);
  }, []);

  const ent = status?.entities?.[entityId];

  async function onRunNow() {
    setErr("");
    setBusy(true);
    try {
      const r = await runNow(entityId);
      setResult(r);
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onRunManual() {
    setErr("");
    setBusy(true);
    try {
      const r = await runDaily(entityId, manualDate, true);
      setResult(r);
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    const token = result?.download_token;
    if (!token) return alert("No export available yet. Run the reconciliation first.");
    const blob = await downloadXlsx(token);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entityId}_recon_${(result?.date || manualDate)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const exceptions = (result?.exceptions || []) as any[];
  const summary = (result?.summary || []) as any[];

  const exceptionCols = useMemo(() => {
    const first = exceptions[0] || {};
    return Object.keys(first);
  }, [exceptions]);

  return (
    <div className="card">
      <div className="cardHeader">
        <div>
          <h3 className="cardTitle">Merchant Reconciliation</h3>
          <p className="cardSub">Auto-run (ET) + manual runs. Processor totals vs CRM (HG NAV).</p>
        </div>
        <div className="smallNote">
          Auto: <b>{status?.settings.auto_enabled ? "On" : "Off"}</b> • Time (ET):{" "}
          <b>{status?.settings.auto_time_et || "—"}</b> • Lookback: <b>{status?.settings.lookback_business_days ?? "—"}</b>
        </div>
      </div>

      <div className="cardBody">
        <div className="grid2" style={{ alignItems: "start" }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="cardHeader">
              <div>
                <h3 className="cardTitle">Status</h3>
                <p className="cardSub">Per-entity last run dates</p>
              </div>
            </div>
            <div className="cardBody">
              <div className="formRow">
                <label className="smallNote" style={{ minWidth: 120 }}>Entity</label>
                <select className="field" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                  {Object.keys(status?.entities || { helpgrid: { entity: "Helpgrid" } }).map((k) => (
                    <option key={k} value={k}>
                      {status?.entities?.[k]?.entity || k}
                    </option>
                  ))}
                </select>
              </div>

              <div className="hr" />

              <div className="kpiRow">
                <div className="kpi">
                  <div className="kpiLabel">Last daily</div>
                  <div className="kpiValue">{fmtDate(ent?.last_daily)}</div>
                  <div className="kpiNote">Latest completed</div>
                </div>
                <div className="kpi">
                  <div className="kpiLabel">Last super</div>
                  <div className="kpiValue">{fmtDate(ent?.last_super)}</div>
                  <div className="kpiNote">Month-end run</div>
                </div>
              </div>

              <div className="hr" />

              <div className="formRow" style={{ gap: 10, alignItems: "center" }}>
                <button className="btn btnPrimary" onClick={onRunNow} disabled={busy}>
                  {busy ? "Running…" : "Run Recon Now"}
                </button>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input className="field" type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
                  <button className="btn" onClick={onRunManual} disabled={busy}>
                    Run Recon for Date
                  </button>
                </div>
              </div>

              <div className="formRow" style={{ marginTop: 10 }}>
                <button className="btn" onClick={onExport} disabled={!result?.download_token}>
                  Export (XLSX)
                </button>
                <div className="smallNote" style={{ color: "var(--muted)" }}>
                  Saved to output folder by backend. Export downloads the last run’s XLSX.
                </div>
              </div>

              {err && (
                <div className="hr" />
              )}
              {err && <div className="smallNote" style={{ color: "var(--danger)" }}><b>Error:</b> {err}</div>}
            </div>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <div className="cardHeader">
              <div>
                <h3 className="cardTitle">Results</h3>
                <p className="cardSub">Daily totals by merchant with exceptions</p>
              </div>
              <div className="smallNote">{result?.skipped ? "Skipped (already ran)" : result ? "Ready" : "Run to populate"}</div>
            </div>
            <div className="cardBody">
              {!result && (
                <div className="smallNote">
                  This tab no longer uploads files. The backend scans the configured input folders by date and writes
                  output XLSX into your Settings → output folder.
                </div>
              )}

              {result?.skipped && (
                <div className="smallNote">
                  Output already existed for {result.date}. Backend did not re-run. Output file: <b>{result.output_file}</b>
                </div>
              )}

              {!!summary.length && (
                <>
                  <div className="smallNote" style={{ marginBottom: 8 }}><b>Summary</b></div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((r: any, idx: number) => (
                        <tr key={idx}>
                          <td>{String(r.metric ?? "")}</td>
                          <td>{String(r.metric || "").includes("total") ? fmtMoney(r.value) : String(r.value ?? "")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="hr" />
                </>
              )}

              <div className="smallNote" style={{ marginBottom: 8 }}>
                <b>Exceptions</b> ({exceptions.length})
              </div>

              {exceptions.length === 0 ? (
                <div className="smallNote" style={{ color: "var(--muted)" }}>No exceptions 🎉</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      {exceptionCols.map((c) => <th key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {exceptions.slice(0, 200).map((r: any, i: number) => (
                      <tr key={i}>
                        {exceptionCols.map((c) => {
                          const v = r[c];
                          if (["processor_total", "crm_total", "diff", "abs_diff"].includes(c)) return <td key={c}>{fmtMoney(v)}</td>;
                          return <td key={c}>{String(v ?? "")}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
