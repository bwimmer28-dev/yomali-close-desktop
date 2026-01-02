// web/src/lib/reconApi.ts
// Lightweight client for the local FastAPI reconciliation service.

export type RunMode = "daily" | "super";

export type EntityRunStatus = {
  /** Display name (optional) */
  entity?: string;

  // daily
  last_daily?: string | null;
  last_daily_output?: string | null;
  last_daily_ok?: boolean | null;

  // super (optional / future)
  last_super?: string | null;
  last_super_output?: string | null;
  last_super_ok?: boolean | null;

  // optional helpful fields
  message?: string | null;
};

export type ReconSettings = {
  auto_enabled?: boolean;
  /** e.g. "02:00" */
  auto_time_et?: string;
  /** business days */
  lookback_business_days?: number;
};

export type StatusResponse = {
  ok: boolean;
  serverTime?: string;
  settings?: ReconSettings;
  /** Entity status keyed by entity id (e.g. "helpgrid") */
  entities?: Record<string, EntityRunStatus>;
};

export type RunResult = {
  ok: boolean;
  entity?: string;
  date?: string;
  skipped?: boolean;
  message?: string;

  // UI expects these (optional depending on backend)
  download_token?: string;
  output_file?: string;

  // result details
  summary?: any[];
  exceptions?: any[];
};

function baseUrl() {
  // Prefer Vite env var if you set it; otherwise localhost.
  // Example: VITE_RECON_API_URL=http://127.0.0.1:8000
  const v = (import.meta as any).env?.VITE_RECON_API_URL;
  return (v && String(v).trim()) || "http://127.0.0.1:8000";
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

async function health(): Promise<{ ok: boolean }> {
  return jsonFetch<{ ok: boolean }>(`${baseUrl()}/health`);
}

/** Normalize backend shapes -> UI-friendly StatusResponse */
function normalizeStatus(raw: any): StatusResponse {
  if (!raw || typeof raw !== "object") return { ok: false, entities: {} };

  // entities can come back as:
  //  - map: { helpgrid: { ... } }
  //  - list: [ { id: "helpgrid", ... }, { entity_id: "helpgrid", ... } ]
  const entitiesRaw = (raw as any).entities;
  let entities: Record<string, EntityRunStatus> = {};

  if (Array.isArray(entitiesRaw)) {
    for (const item of entitiesRaw) {
      if (!item || typeof item !== "object") continue;
      const id =
        String(
          (item as any).id ??
            (item as any).entity_id ??
            (item as any).entityId ??
            (item as any).key ??
            ""
        ).trim();
      if (!id) continue;
      entities[id] = item as EntityRunStatus;
    }
  } else if (entitiesRaw && typeof entitiesRaw === "object") {
    entities = entitiesRaw as Record<string, EntityRunStatus>;
  }

  return {
    ok: !!(raw as any).ok,
    serverTime: (raw as any).serverTime ?? (raw as any).server_time,
    settings: (raw as any).settings,
    entities,
  };
}

/**
 * Main status call the UI expects.
 * Backend should return something like:
 * { ok: true, settings: {...}, entities: { helpgrid: {...} } }
 */
export async function apiStatus(): Promise<StatusResponse> {
  // If your backend uses /status, keep as-is.
  // If yours is /api/status, change to `${baseUrl()}/api/status`.
  return jsonFetch<any>(`${baseUrl()}/status`)
    .then(normalizeStatus)
    .catch(async () => {
      // fallback: some builds only have /health; treat as "ok but no entities"
      const h = await health();
      return { ok: !!h.ok, entities: {} };
    });
}

/**
 * Kick off a DAILY run for an entity.
 * Optional date (YYYY-MM-DD) and force flag to override idempotency.
 */
export async function runDaily(entity: string, date?: string, force?: boolean): Promise<RunResult> {
  const payload: any = { entity };
  if (date) payload.date = date;
  if (typeof force === "boolean") payload.force = force;

  return jsonFetch<RunResult>(`${baseUrl()}/run/daily`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Manual "RUN NOW" button (ad-hoc run).
 */
export async function runNow(entity: string): Promise<RunResult> {
  const payload = { entity };
  return jsonFetch<RunResult>(`${baseUrl()}/run/now`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Download an output XLSX from the backend using a download token.
 * Returns a Blob so the UI can choose how to save it.
 *
 * Backend routes supported (tries in order):
 *  - GET /download/{token}
 *  - GET /download?token={token}
 */
export async function downloadXlsx(downloadToken: string): Promise<Blob> {
  const tryUrls = [
    `${baseUrl()}/download/${encodeURIComponent(downloadToken)}`,
    `${baseUrl()}/download?token=${encodeURIComponent(downloadToken)}`,
  ];

  let lastErr: Error | null = null;

  for (const url of tryUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Download failed: HTTP ${res.status}: ${text}`);
      }
      return await res.blob();
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastErr || new Error("Download failed");
}
