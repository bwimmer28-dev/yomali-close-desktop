// web/src/lib/reconApi.ts
// Central API wrapper for the local FastAPI backend (runs as Windows service).

export const API_BASE = "http://127.0.0.1:8080";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText}${text ? ` — ${text}` : ""}`);
  }
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return (undefined as any) as T;
  return (await r.json()) as T;
}

// ============================================================================
// Types
// ============================================================================

export type EngineSettings = {
  auto_enabled?: boolean;
  auto_time_et?: string;
  lookback_business_days?: number;
  input_root?: string;
  output_dir?: string;
};

export type EntityRunStatus = {
  name: string;
  last_daily?: string | null;
  last_super?: string | null;
  file_count?: number;
};

export type StatusResponse = {
  entities: Record<string, EntityRunStatus>;
  settings?: EngineSettings;
};

export type RunResponse = {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  entity_id: string;
  date: string;
  download_token?: string;
  output_file?: string;
  status_summary?: StatusSummary;
  daily_statuses?: DailyStatus[];
  exceptions?: ExceptionRow[];
  counts?: { summary_rows: number; exceptions_rows: number };
  meta?: Record<string, any>;
};

export type HealthResponse = { ok: boolean; status?: string };

// ============================================================================
// New v2 Types - Traffic Light Status
// ============================================================================

export type ReconciliationStatus = "green" | "yellow" | "red";

export type ReasonCode = 
  | "within_tolerance"
  | "timing_cutoff"
  | "payout_in_transit"
  | "refund_failure"
  | "void_vs_refund"
  | "auth_not_captured"
  | "processor_only"
  | "spi_only"
  | "adjustment_no_spi"
  | "dispute_lifecycle"
  | "fee_variance"
  | "data_missing"
  | "unexplained";

export type ResolutionStatus = 
  | "needs_review"
  | "in_progress"
  | "resolved"
  | "approved_variance";

export type StatusSummary = {
  total_processors: number;
  green_count: number;
  yellow_count: number;
  red_count: number;
  total_variance: number;
  total_exceptions: number;
};

export type VarianceBreakdown = {
  timing_cutoff: number;
  refund_failure: number;
  void_vs_refund: number;
  processor_only: number;
  spi_only: number;
  adjustments: number;
  disputes: number;
  fees: number;
  unexplained: number;
};

export type DailyStatus = {
  date: string;
  entity_id: string;
  processor: string;
  spi_charge_gross: number;
  spi_refund_gross: number;
  spi_refund_failure_gross: number;
  spi_target_gross: number;
  spi_charge_count: number;
  spi_refund_count: number;
  proc_charge_gross: number;
  proc_refund_gross: number;
  proc_fee_amount: number;
  proc_target_gross: number;
  proc_charge_count: number;
  proc_refund_count: number;
  variance_amount: number;
  variance_pct: number;
  status: ReconciliationStatus;
  top_reason_code: ReasonCode;
  reason_codes?: ReasonCode[];
  variance_breakdown?: VarianceBreakdown;
  spi_data_present: boolean;
  proc_data_present: boolean;
};

// ============================================================================
// Exception Types (v2 - reason code based)
// ============================================================================

export type Exception = {
  id: string;
  entity_id: string;
  date: string;
  period: string;
  processor: string;
  reason_code: ReasonCode;
  amount: number;
  direction: "spi_only" | "processor_only" | "mismatch";
  item_count: number;
  resolution_status: ResolutionStatus;
  resolved_by?: string | null;
  resolved_at?: string | null;
  notes: string;
};

export type ExceptionRow = {
  date: string;
  processor: string;
  reason_code: string;
  amount: number;
  direction: string;
  status: string;
};

export type ExceptionUpdate = {
  resolution_status?: ResolutionStatus;
  notes?: string;
  resolved_by?: string;
};

export type ExceptionsResponse = {
  exceptions: Exception[];
  count: number;
};

export type ExceptionStatsResponse = {
  total_exceptions: number;
  needs_review: number;
  in_progress: number;
  resolved: number;
  approved_variance: number;
  total_open_amount: number;
  by_reason_code: Record<string, { count: number; amount: number }>;
  by_period: Record<string, { total: number; open: number; resolved: number }>;
};

// ============================================================================
// Core Endpoints
// ============================================================================

export async function health(): Promise<HealthResponse> {
  return jsonFetch<HealthResponse>(`${API_BASE}/health`, { method: "GET" });
}

export async function apiStatus(): Promise<StatusResponse> {
  return jsonFetch<StatusResponse>(`${API_BASE}/status`, { method: "GET" });
}

// Daily run (optionally for a specific date, and optionally force)
export async function runDaily(entityId: string, date?: string, force?: boolean): Promise<RunResponse> {
  const p = new URLSearchParams();
  p.set("entity_id", entityId);
  if (date) {
    p.set("date_str", date);
  }
  // Always save to disk
  p.set("save", "true");
  // Force re-run even if file exists
  if (force) {
    p.set("force", "true");
  }
  return jsonFetch<RunResponse>(`${API_BASE}/run/daily?${p.toString()}`, { method: "POST" });
}

// Monthly / "Super" run (period: YYYY-MM)
export async function runSuper(entityId: string, period: string): Promise<RunResponse> {
  const p = new URLSearchParams();
  p.set("entity", entityId);
  p.set("period", period);
  return jsonFetch<RunResponse>(`${API_BASE}/run/super?${p.toString()}`, { method: "POST" });
}

// Download helpers
export async function downloadLastXlsx(entityId: string): Promise<Blob> {
  const p = new URLSearchParams();
  p.set("entity", entityId);
  const r = await fetch(`${API_BASE}/download/last?${p.toString()}`);
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  return await r.blob();
}

// ============================================================================
// Exception Management Endpoints
// ============================================================================

/**
 * Get all exceptions with optional filters
 */
export async function getExceptions(params?: {
  entity_id?: string;
  period?: string;
  resolution_status?: ResolutionStatus;
  reason_code?: ReasonCode;
}): Promise<ExceptionsResponse> {
  const p = new URLSearchParams();
  if (params?.entity_id) p.set("entity_id", params.entity_id);
  if (params?.period) p.set("period", params.period);
  if (params?.resolution_status) p.set("resolution_status", params.resolution_status);
  if (params?.reason_code) p.set("reason_code", params.reason_code);
  
  return jsonFetch<ExceptionsResponse>(`${API_BASE}/exceptions?${p.toString()}`, {
    method: "GET",
  });
}

/**
 * Get a single exception by ID
 */
export async function getException(exceptionId: string): Promise<Exception> {
  return jsonFetch<Exception>(`${API_BASE}/exceptions/${exceptionId}`, {
    method: "GET",
  });
}

/**
 * Update an exception's resolution status or notes
 */
export async function updateException(
  exceptionId: string,
  update: ExceptionUpdate
): Promise<Exception> {
  return jsonFetch<Exception>(`${API_BASE}/exceptions/${exceptionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}

/**
 * Delete an exception
 */
export async function deleteException(exceptionId: string): Promise<{ deleted: boolean; exception_id: string }> {
  return jsonFetch<{ deleted: boolean; exception_id: string }>(
    `${API_BASE}/exceptions/${exceptionId}`,
    { method: "DELETE" }
  );
}

/**
 * Clear all exceptions (requires confirm=true)
 */
export async function clearExceptions(entityId?: string): Promise<{ cleared: boolean; entity_id: string }> {
  const p = new URLSearchParams();
  p.set("confirm", "true");
  if (entityId) p.set("entity_id", entityId);
  
  return jsonFetch<{ cleared: boolean; entity_id: string }>(
    `${API_BASE}/exceptions?${p.toString()}`,
    { method: "DELETE" }
  );
}

/**
 * Get exception statistics
 */
export async function getExceptionStats(entityId?: string): Promise<ExceptionStatsResponse> {
  const p = new URLSearchParams();
  if (entityId) p.set("entity_id", entityId);
  
  return jsonFetch<ExceptionStatsResponse>(`${API_BASE}/exceptions/stats?${p.toString()}`, {
    method: "GET",
  });
}

// ============================================================================
// Helper functions for display
// ============================================================================

export function getStatusColor(status: ReconciliationStatus): string {
  switch (status) {
    case "green": return "#10b981";
    case "yellow": return "#f59e0b";
    case "red": return "#ef4444";
    default: return "#6b7280";
  }
}

export function getStatusBgColor(status: ReconciliationStatus): string {
  switch (status) {
    case "green": return "#064e3b";
    case "yellow": return "#78350f";
    case "red": return "#7f1d1d";
    default: return "#374151";
  }
}

export function formatReasonCode(code: ReasonCode | string): string {
  const labels: Record<string, string> = {
    within_tolerance: "Within Tolerance",
    timing_cutoff: "Timing Cutoff",
    payout_in_transit: "Payout In Transit",
    refund_failure: "Refund Failure",
    void_vs_refund: "Void vs Refund",
    auth_not_captured: "Auth Not Captured",
    processor_only: "Processor Only",
    spi_only: "SPI Only",
    adjustment_no_spi: "Adjustment (No SPI)",
    dispute_lifecycle: "Dispute Lifecycle",
    fee_variance: "Fee Variance",
    data_missing: "Data Missing",
    unexplained: "Unexplained",
  };
  return labels[code] || code;
}

export function formatResolutionStatus(status: ResolutionStatus | string): string {
  const labels: Record<string, string> = {
    needs_review: "Needs Review",
    in_progress: "In Progress",
    resolved: "Resolved",
    approved_variance: "Approved",
  };
  return labels[status] || status;
}

// ============================================================================
// Backward compatible exports for older UI
// ============================================================================

export type ReconSummaryRow = Record<string, unknown>;
export type ReconExceptionRow = Record<string, unknown>;

export type ReconResponse = {
  ok: boolean;
  message?: string;
  download_token?: string;
  counts?: { summary_rows: number; exceptions_rows: number };
  summary: ReconSummaryRow[];
  exceptions: ReconExceptionRow[];
};

/**
 * v0.1.15 UI calls reconcile(formData) where formData includes uploaded files.
 */
export async function reconcile(form: FormData): Promise<ReconResponse> {
  const candidates = [
    `${API_BASE}/reconcile`,
    `${API_BASE}/reconcile/upload`,
    `${API_BASE}/api/reconcile`,
  ];

  for (const url of candidates) {
    try {
      const r = await fetch(url, { method: "POST", body: form });
      if (!r.ok) continue;
      return (await r.json()) as ReconResponse;
    } catch {
      // try next
    }
  }

  return {
    ok: false,
    message: "Reconcile upload endpoint not available in this build.",
    download_token: "",
    counts: { summary_rows: 0, exceptions_rows: 0 },
    summary: [],
    exceptions: [],
  };
}

/**
 * v0.1.15 UI calls downloadXlsx(downloadToken).
 */
export async function downloadXlsx(downloadToken: string): Promise<Blob> {
  const tryUrls = [
    `${API_BASE}/download/xlsx?token=${encodeURIComponent(downloadToken)}`,
    `${API_BASE}/download?token=${encodeURIComponent(downloadToken)}`,
    `${API_BASE}/download/${encodeURIComponent(downloadToken)}`,
  ];

  for (const url of tryUrls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      return await r.blob();
    } catch {
      // try next
    }
  }
  throw new Error("Download endpoint not available (no matching /download route).");
}