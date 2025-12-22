import React, { useMemo, useState } from "react";

type Row = {
  id: string;
  merchant: string;
  erp: string;
  status: "Matched" | "Needs Review" | "Merchant-only" | "ERP-only";
  amount: number;
  date: string;
};

export default function App() {
  const [query, setQuery] = useState("");

  const rows: Row[] = useMemo(
    () => [
      { id: "TX-1001", merchant: "PayPal", erp: "QuickBooks", status: "Matched", amount: 1250.0, date: "2025-12-20" },
      { id: "TX-1002", merchant: "Braintree", erp: "NetSuite", status: "Needs Review", amount: 349.99, date: "2025-12-20" },
      { id: "TX-1003", merchant: "PayPal", erp: "", status: "Merchant-only", amount: 79.0, date: "2025-12-21" },
      { id: "TX-1004", merchant: "", erp: "QuickBooks", status: "ERP-only", amount: 615.5, date: "2025-12-21" },
    ],
    []
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.merchant.toLowerCase().includes(q) ||
        r.erp.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
    );
  }, [query, rows]);

  const counts = useMemo(() => {
    const c = { Matched: 0, "Needs Review": 0, "Merchant-only": 0, "ERP-only": 0 } as Record<Row["status"], number>;
    rows.forEach((r) => (c[r.status] += 1));
    return c;
  }, [rows]);

  return (
    <div style={{ fontFamily: "system-ui, Segoe UI, Arial", background: "#f6f7fb", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "white", borderBottom: "1px solid #e6e8ef" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "18px 18px", display: "flex", alignItems: "center", gap: 14 }}>
          <img
            src="/stalliant.png"
            alt="Stalliant"
            style={{ height: 34, width: "auto", display: "block" }}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 0.2 }}>Stalliant Live</div>
            <div style={{ fontSize: 12, color: "#667085" }}>
              Desktop demo — reconciliation dashboard (sample data)
            </div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search (txn, merchant, ERP, status)…"
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d7dbe7",
                width: 320,
                outline: "none",
              }}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 18 }}>
        {/* KPI cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Kpi title="Matched" value={counts["Matched"]} />
          <Kpi title="Needs Review" value={counts["Needs Review"]} />
          <Kpi title="Merchant-only" value={counts["Merchant-only"]} />
          <Kpi title="ERP-only" value={counts["ERP-only"]} />
        </div>

        {/* Table */}
        <div style={{ marginTop: 14, background: "white", border: "1px solid #e6e8ef", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #eef0f6", display: "flex", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Exceptions & Matches</div>
            <div style={{ marginLeft: "auto", color: "#667085", fontSize: 12 }}>
              Showing {filtered.length} of {rows.length}
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#fbfcff" }}>
                <Th>Txn</Th>
                <Th>Date</Th>
                <Th>Merchant</Th>
                <Th>ERP</Th>
                <Th>Status</Th>
                <Th style={{ textAlign: "right" }}>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #eef0f6" }}>
                  <Td>{r.id}</Td>
                  <Td>{r.date}</Td>
                  <Td>{r.merchant || <span style={{ color: "#98a2b3" }}>—</span>}</Td>
                  <Td>{r.erp || <span style={{ color: "#98a2b3" }}>—</span>}</Td>
                  <Td>
                    <Badge status={r.status} />
                  </Td>
                  <Td style={{ textAlign: "right" }}>${r.amount.toFixed(2)}</Td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <Td colSpan={6} style={{ padding: 18, color: "#667085" }}>
                    No results.
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, color: "#667085", fontSize: 12 }}>
          Tip: updates will be checked at launch (packaged builds) and delivered via GitHub Releases.
        </div>
      </div>
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: number }) {
  return (
    <div style={{ background: "white", border: "1px solid #e6e8ef", borderRadius: 14, padding: 14 }}>
      <div style={{ color: "#667085", fontSize: 12, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function Th({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) {
  return (
    <th style={{ padding: "10px 12px", fontSize: 12, color: "#667085", fontWeight: 700, ...style }}>
      {children}
    </th>
  );
}

function Td({ children, style, colSpan }: React.PropsWithChildren<{ style?: React.CSSProperties; colSpan?: number }>) {
  return (
    <td style={{ padding: "12px 12px", fontSize: 13, ...style }} colSpan={colSpan}>
      {children}
    </td>
  );
}

function Badge({ status }: { status: Row["status"] }) {
  const map: Record<Row["status"], { bg: string; fg: string; border: string }> = {
    Matched: { bg: "#ecfdf3", fg: "#027a48", border: "#a6f4c5" },
    "Needs Review": { bg: "#fffaeb", fg: "#b54708", border: "#fedf89" },
    "Merchant-only": { bg: "#f0f9ff", fg: "#026aa2", border: "#b9e6fe" },
    "ERP-only": { bg: "#fdf2fa", fg: "#c11574", border: "#fcceee" },
  };

  const s = map[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {status}
    </span>
  );
}
