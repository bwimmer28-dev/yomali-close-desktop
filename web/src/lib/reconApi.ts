// web/src/lib/reconApi.ts
export type ReconCounts = {
  summary_rows: number;
  exceptions_rows: number;
};

export type ReconResponse = {
  download_token: string;
  summary: Record<string, any>[];
  exceptions: Record<string, any>[];
  counts: ReconCounts;
};

// Some UI components use this name
export type ReconRow = Record<string, any>;

const PROD_BASE = "http://127.0.0.1:8000";
const DEV_BASE = "/api";

/**
 * In dev we prefer the Vite proxy at /api -> 127.0.0.1:8000 (see vite.config.ts).
 * In prod (Electron file://) we call the local backend directly.
 */
export function apiBase(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDev = (import.meta as any).env?.DEV;
  return isDev ? DEV_BASE : PROD_BASE;
}

export type ReconcileArgs = {
  entity?: string;
  bankFile: File;
  erpFile: File;
  processorFiles: { type: string; file: File }[];
  amountTolerance?: number;
  dateWindowDays?: number;
  allowAmountOnly?: boolean;
};

export async function reconcileFiles(args: ReconcileArgs): Promise<ReconResponse> {
  const form = new FormData();
  form.append("bank", args.bankFile);
  form.append("erp", args.erpFile);

  for (const p of args.processorFiles) {
    form.append("processors", p.file);
    form.append("processor_types", p.type);
  }

  if (args.entity) form.append("entity", args.entity);
  if (args.amountTolerance != null) form.append("amount_tolerance", String(args.amountTolerance));
  if (args.dateWindowDays != null) form.append("date_window_days", String(args.dateWindowDays));
  if (args.allowAmountOnly != null) form.append("allow_amount_only", String(args.allowAmountOnly));

  const r = await fetch(`${apiBase()}/reconcile`, { method: "POST", body: form });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Reconcile failed: ${r.status} ${txt}`);
  }
  return r.json();
}

// Backwards-compatible name used by App.tsx
export const reconcile = reconcileFiles;

export async function downloadXlsx(token: string): Promise<Blob> {
  const r = await fetch(`${apiBase()}/download/${encodeURIComponent(token)}`);
  if (!r.ok) throw new Error(`Download failed: ${r.status}`);
  return r.blob();
}
