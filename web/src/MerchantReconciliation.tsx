// web/src/MerchantReconciliation.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  apiStatus,
  downloadLastXlsx,
  runDaily,
  runSuper,
  getExceptions,
  updateException,
  getExceptionStats,
  getStatusColor,
  getStatusBgColor,
  formatReasonCode,
  formatResolutionStatus,
  type EntityRunStatus,
  type StatusResponse,
  type Exception,
  type ExceptionStatsResponse,
  type ResolutionStatus,
} from "./lib/reconApi";

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function fmtCurrency(n: number) {
  if (n === null || n === undefined || Number.isNaN(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function StatusBadge({ status }: { status: string }) {
  const color = getStatusColor(status as any);
  const bgColor = getStatusBgColor(status as any);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        textTransform: "uppercase",
        background: bgColor,
        color: color,
      }}
    >
      {status}
    </span>
  );
}

export default function MerchantReconciliation() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [entityId, setEntityId] = useState<string>("helpgrid");
  const [manualDate, setManualDate] = useState<string>("");
  const [manualPeriod, setManualPeriod] = useState<string>(() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${d.getFullYear()}-${mm}`;
  });

  // Exception tracking state
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [stats, setStats] = useState<ExceptionStatsResponse | null>(null);
  const [filterPeriod, setFilterPeriod] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "open" | "resolved">("open");
  const [filterReason, setFilterReason] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [loadingExceptions, setLoadingExceptions] = useState(false);

  // Load initial data
  async function refresh() {
    setError("");
    try {
      const s = await apiStatus();
      setStatus(s);
      if (s?.entities && !s.entities[entityId]) {
        const first = Object.keys(s.entities)[0];
        if (first) setEntityId(first);
      }
    } catch (e: any) {
      const errMsg = String(e?.message || e);
      setError(errMsg);
      console.error("Status fetch error:", e);
    }
  }

  async function loadExceptions() {
    setLoadingExceptions(true);
    try {
      const response = await getExceptions({ entity_id: entityId });
      setExceptions(response.exceptions);
      
      const statsResponse = await getExceptionStats(entityId);
      setStats(statsResponse);
    } catch (e: any) {
      console.error("Failed to load exceptions:", e);
    } finally {
      setLoadingExceptions(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status) {
      loadExceptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const ent: EntityRunStatus | undefined = useMemo(() => {
    return status?.entities ? status.entities[entityId] : undefined;
  }, [status, entityId]);

  // Filter and sort exceptions (client-side for responsiveness)
  const filteredExceptions = useMemo(() => {
    let filtered = [...exceptions];

    if (filterPeriod !== "all") {
      filtered = filtered.filter((e) => e.period === filterPeriod);
    }

    if (filterStatus === "open") {
      filtered = filtered.filter((e) => 
        e.resolution_status === "needs_review" || e.resolution_status === "in_progress"
      );
    } else if (filterStatus === "resolved") {
      filtered = filtered.filter((e) => 
        e.resolution_status === "resolved" || e.resolution_status === "approved_variance"
      );
    }

    if (filterReason !== "all") {
      filtered = filtered.filter((e) => e.reason_code === filterReason);
    }

    if (sortBy === "date") {
      filtered.sort((a, b) => b.date.localeCompare(a.date));
    } else if (sortBy === "amount") {
      filtered.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    }

    return filtered;
  }, [exceptions, filterPeriod, filterStatus, filterReason, sortBy]);

  const periods = useMemo(() => {
    const unique = new Set(exceptions.map((e) => e.period));
    return Array.from(unique).sort().reverse();
  }, [exceptions]);

  const reasonCodes = useMemo(() => {
    const unique = new Set(exceptions.map((e) => e.reason_code));
    return Array.from(unique).sort();
  }, [exceptions]);

  async function cycleResolutionStatus(exc: Exception) {
    // Cycle through: needs_review -> in_progress -> resolved -> needs_review
    const statusOrder: ResolutionStatus[] = ["needs_review", "in_progress", "resolved", "approved_variance"];
    const currentIndex = statusOrder.indexOf(exc.resolution_status);
    const nextStatus = statusOrder[(currentIndex + 1) % statusOrder.length];

    try {
      const updated = await updateException(exc.id, { resolution_status: nextStatus });
      setExceptions((prev) =>
        prev.map((e) => (e.id === exc.id ? updated : e))
      );
      const statsResponse = await getExceptionStats(entityId);
      setStats(statsResponse);
    } catch (e: any) {
      console.error("Failed to update status:", e);
      setError(String(e?.message || e));
    }
  }

  async function updateNotes(exceptionId: string, notes: string) {
    try {
      const updated = await updateException(exceptionId, { notes });
      setExceptions((prev) =>
        prev.map((e) => (e.id === exceptionId ? updated : e))
      );
    } catch (e: any) {
      console.error("Failed to update notes:", e);
    }
  }

  async function onRunDaily() {
    setError("");
    setBusy(true);
    try {
      await runDaily(entityId);
      await refresh();
      await loadExceptions();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onRunForDate() {
    setError("");
    setBusy(true);
    try {
      if (!manualDate) throw new Error("Select a date first.");
      await runDaily(entityId, manualDate, true);
      await refresh();
      await loadExceptions();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onRunMonthly() {
    setError("");
    setBusy(true);
    try {
      if (!manualPeriod) throw new Error("Select a month first.");
      await runSuper(entityId, manualPeriod);
      await refresh();
      await loadExceptions();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    setError("");
    setBusy(true);
    try {
      const blob = await downloadLastXlsx(entityId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entityId}_recon.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const entityKeys = Object.keys(status?.entities || { helpgrid: {} as any });

  // Calculate open count from stats
  const openCount = (stats?.needs_review ?? 0) + (stats?.in_progress ?? 0);
  const resolvedCount = (stats?.resolved ?? 0) + (stats?.approved_variance ?? 0);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, marginBottom: 4 }}>Merchant Reconciliation</h2>
        <p className="smallNote" style={{ margin: 0 }}>
          Automated reconciliation engine (backend integration)
        </p>
      </div>

      {error && (
        <div
          className="card"
          style={{
            background: "#3b0e0e",
            color: "#f87171",
            marginBottom: 16,
            padding: 12,
            borderLeft: "3px solid #dc2626",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <label style={{ fontWeight: 600 }}>Entity</label>
        <select
          className="field"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          style={{ maxWidth: 200 }}
          disabled={busy}
        >
          {entityKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button className="btn" disabled={busy} onClick={refresh}>
          Refresh Status
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ margin: 0, marginBottom: 8 }}>Daily Run</h4>
          <div className="smallNote">Last output: {ent?.last_daily || "—"}</div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btnPrimary" disabled={busy} onClick={onRunDaily}>
              Run Daily Now
            </button>
            <input
              className="field"
              type="date"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
              disabled={busy}
              style={{ maxWidth: 160 }}
            />
            <button className="btn btnPrimary" disabled={busy} onClick={onRunForDate}>
              Run for Date
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ margin: 0, marginBottom: 8 }}>Monthly Run (Super)</h4>
          <div className="smallNote">Last output: {ent?.last_super || "—"}</div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="field"
              type="month"
              value={manualPeriod}
              onChange={(e) => setManualPeriod(e.target.value)}
              disabled={busy}
              style={{ maxWidth: 160 }}
            />
            <button className="btn btnPrimary" disabled={busy} onClick={onRunMonthly}>
              Run Monthly Recon
            </button>
            <button className="btn" disabled={busy} onClick={onDownload}>
              Download XLSX
            </button>
          </div>
        </div>
      </div>

      <div className="smallNote" style={{ marginTop: 12, lineHeight: 1.6 }}>
        Auto: <b>{status?.settings?.auto_enabled ? "On" : "Off"}</b> • Time (ET):{" "}
        <b>{status?.settings?.auto_time_et || "—"}</b> • Lookback:{" "}
        <b>{status?.settings?.lookback_business_days ?? "—"}</b>
      </div>

      {/* Exception Dashboard */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24, marginTop: 24 }}>
        <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, marginBottom: 4 }}>Exception Dashboard</h3>
            <p className="smallNote" style={{ margin: 0 }}>Track and manage reconciliation variances by reason code</p>
          </div>
          <button 
            className="btn" 
            disabled={loadingExceptions || !status} 
            onClick={loadExceptions}
            style={{ opacity: (loadingExceptions || !status) ? 0.5 : 1 }}
          >
            {loadingExceptions ? "Loading..." : "Refresh Exceptions"}
          </button>
        </div>

        {/* Summary Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
          <div className="card" style={{ padding: 12 }}>
            <div className="smallNote">Total Exceptions</div>
            <div className="kpiValue" style={{ fontSize: 28 }}>
              {stats?.total_exceptions ?? exceptions.length}
            </div>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div className="smallNote">Needs Review</div>
            <div className="kpiValue" style={{ fontSize: 28, color: "#ef4444" }}>
              {stats?.needs_review ?? 0}
            </div>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div className="smallNote">In Progress</div>
            <div className="kpiValue" style={{ fontSize: 28, color: "#f59e0b" }}>
              {stats?.in_progress ?? 0}
            </div>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div className="smallNote">Resolved</div>
            <div className="kpiValue" style={{ fontSize: 28, color: "#10b981" }}>
              {resolvedCount}
            </div>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div className="smallNote">Open Amount</div>
            <div className="kpiValue" style={{ fontSize: 28, color: "#f59e0b" }}>
              {fmtCurrency(stats?.total_open_amount ?? 0)}
            </div>
          </div>
        </div>

        {/* Reason Code Breakdown */}
        {stats?.by_reason_code && Object.keys(stats.by_reason_code).length > 0 && (
          <div className="card" style={{ padding: 16, marginBottom: 20 }}>
            <h4 style={{ margin: 0, marginBottom: 12 }}>Variance by Reason Code</h4>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {Object.entries(stats.by_reason_code).map(([code, data]) => (
                <div 
                  key={code} 
                  style={{ 
                    padding: "8px 12px", 
                    background: "var(--bg-secondary)", 
                    borderRadius: 6,
                    minWidth: 150,
                  }}
                >
                  <div className="smallNote">{formatReasonCode(code)}</div>
                  <div style={{ fontWeight: 600 }}>{data.count} items</div>
                  <div style={{ color: "#f59e0b", fontSize: 14 }}>{fmtCurrency(data.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!status ? (
          <div className="card" style={{ padding: 40, textAlign: "center" }}>
            <div className="smallNote" style={{ color: "#ef4444" }}>
              Cannot load exceptions - backend not connected. Click "Refresh Status" above.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label className="smallNote" style={{ fontWeight: 600 }}>Period:</label>
                <select
                  className="field"
                  value={filterPeriod}
                  onChange={(e) => setFilterPeriod(e.target.value)}
                  style={{ maxWidth: 150 }}
                >
                  <option value="all">All Periods</option>
                  {periods.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label className="smallNote" style={{ fontWeight: 600 }}>Status:</label>
                <select
                  className="field"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                  style={{ maxWidth: 150 }}
                >
                  <option value="all">All</option>
                  <option value="open">Open Only</option>
                  <option value="resolved">Resolved Only</option>
                </select>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label className="smallNote" style={{ fontWeight: 600 }}>Reason:</label>
                <select
                  className="field"
                  value={filterReason}
                  onChange={(e) => setFilterReason(e.target.value)}
                  style={{ maxWidth: 180 }}
                >
                  <option value="all">All Reasons</option>
                  {reasonCodes.map((code) => (
                    <option key={code} value={code}>{formatReasonCode(code)}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label className="smallNote" style={{ fontWeight: 600 }}>Sort by:</label>
                <select
                  className="field"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  style={{ maxWidth: 150 }}
                >
                  <option value="date">Date</option>
                  <option value="amount">Amount</option>
                </select>
              </div>

              <div className="smallNote" style={{ marginLeft: "auto" }}>
                Showing {filteredExceptions.length} exception{filteredExceptions.length !== 1 ? "s" : ""}
              </div>
            </div>

            {loadingExceptions ? (
              <div className="card" style={{ padding: 40, textAlign: "center" }}>
                <div className="smallNote">Loading exceptions...</div>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Processor</th>
                      <th>Reason Code</th>
                      <th>Direction</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                      <th>Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExceptions.map((exc) => (
                      <tr 
                        key={exc.id}
                        style={{ 
                          opacity: exc.resolution_status === "resolved" || 
                                   exc.resolution_status === "approved_variance" ? 0.6 : 1 
                        }}
                      >
                        <td>{exc.date}</td>
                        <td style={{ fontWeight: 600, textTransform: "capitalize" }}>
                          {exc.processor.replace(/_/g, " ")}
                        </td>
                        <td>
                          <span 
                            className="badge"
                            style={{
                              background: exc.reason_code === "unexplained" ? "#7f1d1d" :
                                         exc.reason_code === "data_missing" ? "#78350f" : 
                                         exc.reason_code === "timing_cutoff" ? "#064e3b" : "#422006",
                              color: exc.reason_code === "unexplained" ? "#fca5a5" :
                                     exc.reason_code === "data_missing" ? "#fcd34d" : 
                                     exc.reason_code === "timing_cutoff" ? "#6ee7b7" : "#fde68a",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                            }}
                          >
                            {formatReasonCode(exc.reason_code)}
                          </span>
                        </td>
                        <td>
                          <span style={{ 
                            color: exc.direction === "spi_only" ? "#60a5fa" : 
                                   exc.direction === "processor_only" ? "#f472b6" : "#a78bfa",
                            fontSize: 12,
                          }}>
                            {exc.direction === "spi_only" ? "SPI Only" :
                             exc.direction === "processor_only" ? "Processor Only" : "Mismatch"}
                          </span>
                        </td>
                        <td 
                          style={{ 
                            textAlign: "right", 
                            fontWeight: 700,
                            color: exc.amount < 0 ? "#ef4444" : "#f59e0b"
                          }}
                        >
                          {fmtCurrency(Math.abs(exc.amount))}
                        </td>
                        <td>
                          <button
                            onClick={() => cycleResolutionStatus(exc)}
                            className="badge"
                            style={{
                              cursor: "pointer",
                              border: "none",
                              background: 
                                exc.resolution_status === "needs_review" ? "#7f1d1d" :
                                exc.resolution_status === "in_progress" ? "#78350f" :
                                exc.resolution_status === "resolved" ? "#064e3b" : "#1e3a5f",
                              color:
                                exc.resolution_status === "needs_review" ? "#fca5a5" :
                                exc.resolution_status === "in_progress" ? "#fcd34d" :
                                exc.resolution_status === "resolved" ? "#6ee7b7" : "#93c5fd",
                              padding: "4px 10px",
                              borderRadius: 4,
                              fontSize: 11,
                            }}
                            title="Click to change status"
                          >
                            {formatResolutionStatus(exc.resolution_status)}
                          </button>
                        </td>
                        <td>
                          <input
                            type="text"
                            className="field"
                            value={exc.notes || ""}
                            onChange={(evt) => {
                              // Update locally immediately for responsiveness
                              const newValue = evt.target.value;
                              setExceptions((prev) =>
                                prev.map((item) => 
                                  item.id === exc.id ? { ...item, notes: newValue } : item
                                )
                              );
                            }}
                            onBlur={(e) => updateNotes(exc.id, e.target.value)}
                            placeholder="Add notes..."
                            style={{ minWidth: 180 }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!loadingExceptions && filteredExceptions.length === 0 && (
              <div className="card" style={{ padding: 40, textAlign: "center", marginTop: 16 }}>
                <div className="smallNote">No exceptions found for the selected filters.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}