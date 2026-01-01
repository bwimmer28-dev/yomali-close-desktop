// web/src/MerchantReconciliation.tsx
import { useState } from "react";
import { reconcileFiles, downloadXlsx, type ReconRow } from "@/lib/reconApi";

function Table({ rows }: { rows: ReconRow[] }) {
  if (!rows.length) return <div className="muted">No rows</div>;
  const cols = Object.keys(rows[0]);
  return (
    <table className="recon-table">
      <thead>
        <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map(c => <td key={c}>{String(r[c] ?? "")}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function MerchantReconciliation({ activeEntity }: { activeEntity: string }) {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [erpFile, setErpFile] = useState<File | null>(null);
  const [processorFiles, setProcessorFiles] = useState<{ type: string; file: File }[]>([]);
  const [summaryRows, setSummaryRows] = useState<ReconRow[]>([]);
  const [exceptionRows, setExceptionRows] = useState<ReconRow[]>([]);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!bankFile || !erpFile || !processorFiles.length) return alert("Missing files");
    setLoading(true);
    try {
      const resp = await reconcileFiles({
        entity: activeEntity,
        bankFile,
        erpFile,
        processorFiles,
      });
      setSummaryRows(resp.summary);
      setExceptionRows(resp.exceptions);
      setDownloadToken(resp.download_token);
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Merchant Reconciliation</h2>

      <div className="upload-grid">
        <input type="file" onChange={e => setBankFile(e.target.files?.[0] ?? null)} />
        <input type="file" onChange={e => setErpFile(e.target.files?.[0] ?? null)} />
        <input
          type="file"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) setProcessorFiles([{ type: "generic", file: f }]);
          }}
        />
      </div>

      <button onClick={run} disabled={loading}>
        {loading ? "Running..." : "Run Checks"}
      </button>

      {downloadToken && (
        <button onClick={async () => {
          const blob = await downloadXlsx(downloadToken);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "reconciliation.xlsx";
          a.click();
          URL.revokeObjectURL(url);
        }}>
          Export XLSX
        </button>
      )}

      <h3>Summary</h3>
      <Table rows={summaryRows} />

      <h3>Exceptions</h3>
      <Table rows={exceptionRows} />
    </div>
  );
}
