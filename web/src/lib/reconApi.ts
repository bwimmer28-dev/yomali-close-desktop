// web/src/lib/reconApi.ts
// Central API wrapper for the local FastAPI backend (runs as Windows service).

export const API_BASE = "http://127.0.0.1:8080";

// ============================================================================
// Resolution Status Types and Helpers
// ============================================================================

export type ResolutionStatus = "needs_review" | "in_progress" | "resolved" | "approved_variance";

export function formatReasonCode(code: string): string {
  if (!code) return "Unknown";
  return code
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function formatResolutionStatus(status: ResolutionStatus | string): string {
  switch (status) {
    case "needs_review": return "Needs Review";
    case "in_progress": return "In Progress";
    case "resolved": return "Resolved";
    case "approved_variance": return "Approved Variance";
    default: return status || "Unknown";
  }
}

export function getStatusColor(status: ResolutionStatus | string): string {
  switch (status) {
    case "needs_review": return "#f59e0b"; // amber
    case "in_progress": return "#3b82f6"; // blue
    case "resolved": return "#10b981"; // green
    case "approved_variance": return "#8b5cf6"; // purple
    default: return "#6b7280"; // gray
  }
}

export function getStatusBgColor(status: ResolutionStatus | string): string {
  switch (status) {
    case "needs_review": return "rgba(245, 158, 11, 0.15)";
    case "in_progress": return "rgba(59, 130, 246, 0.15)";
    case "resolved": return "rgba(16, 185, 129, 0.15)";
    case "approved_variance": return "rgba(139, 92, 246, 0.15)";
    default: return "rgba(107, 114, 128, 0.15)";
  }
}

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
  entity: string;
  entity_id?: string;
  lastDailyAt?: string | null;
  lastDailyOutputPath?: string | null;
  lastDailyOk?: boolean | null;

  lastSuperAt?: string | null;
  lastSuperOutputPath?: string | null;
  lastSuperOk?: boolean | null;
};

export type StatusResponse = {
  entities: Record<string, EntityRunStatus>;
  settings?: EngineSettings;
};

export type RunResponse = {
  ok: boolean;
  skipped?: boolean;
  message?: string;
  outputPath?: string;
};

export type HealthResponse = { ok: boolean };

export type Exception = {
  id: string;
  entity_id: string;
  merchant: string;
  date: string; // ISO date string
  period: string; // YYYY-MM
  processor_total: number;
  crm_total: number;
  diff: number;
  status: "Missing in CRM" | "Missing in Processor" | "Needs Review";
  resolved: boolean;
  notes?: string;
};

export type ExceptionUpdate = {
  resolved?: boolean;
  notes?: string;
};

export type ExceptionsResponse = {
  exceptions: Exception[];
  count: number;
};

export type ExceptionStatsResponse = {
  total_exceptions: number;
  open_exceptions: number;
  resolved_exceptions: number;
  total_open_amount: number;
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
  // Note: 'save' parameter controls whether to save output
  // If force=true, we set save=false to skip the "already ran" check
  if (force !== undefined) {
    p.set("save", force ? "false" : "true");
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
  resolved?: boolean;
}): Promise<ExceptionsResponse> {
  const p = new URLSearchParams();
  if (params?.entity_id) p.set("entity_id", params.entity_id);
  if (params?.period) p.set("period", params.period);
  if (params?.resolved !== undefined) p.set("resolved", String(params.resolved));
  
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
 * Update an exception's resolved status or notes
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

// ============================================================================
// Settings Management
// ============================================================================

export type SettingsUpdate = {
  output_dir?: string;
  input_root?: string;
  auto_enabled?: boolean;
  auto_time_et?: string;
  lookback_business_days?: number;
};

/**
 * Update backend settings (output path, input path, etc.)
 */
export async function updateSettings(updates: SettingsUpdate): Promise<{ ok: boolean; settings: EngineSettings }> {
  return jsonFetch<{ ok: boolean; settings: EngineSettings }>(`${API_BASE}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}