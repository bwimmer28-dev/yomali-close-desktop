// web/src/lib/reconApi.ts

export type RunMode = "daily" | "super";

export type EntityRunStatus = {
  entity: string;

  // daily
  lastDailyAt?: string | null;
  lastDailyOutputPath?: string | null;
  lastDailyOk?: boolean | null;

  // super (wiring next pass, but we show it in status now)
  lastSuperAt?: string | null;
  lastSuperOutputPath?: string | null;
  lastSuperOk?: boolean | null;

  // optional helpful fields
  message?: string | null;
};

export type StatusResponse = {
  ok: boolean;
  serverTime?: string;
  entities?: EntityRunStatus[];
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

/**
 * Health is just a quick connectivity check.
 * (Not exported by default — your UI imports apiStatus, not health.)
 */
async function health(): Promise<{ ok: boolean }> {
  return jsonFetch<{ ok: boolean }>(`${baseUrl()}/health`);
}

/**
 * Main status call the UI expects.
 * Backend should return something like:
 * { ok: true, entities: [ { entity: "Helpgrid", lastDailyAt: "...", lastSuperAt: "..." } ] }
 */
export async function apiStatus(): Promise<StatusResponse> {
  // If your backend uses /status, keep as-is.
  // If yours is /api/status, change to `${baseUrl()}/api/status`.
  return jsonFetch<StatusResponse>(`${baseUrl()}/status`).catch(async () => {
    // fallback: some builds only have /health; treat as "ok but no entities"
    const h = await health();
    return { ok: !!h.ok, entities: [] };
  });
}

/**
 * Kick off a DAILY run for an entity.
 * The backend should be responsible for:
 *  - skipping rerun if output already exists for entity/day
 *  - returning a message that indicates "skipped" vs "ran"
 */
export async function runDaily(entity: string) {
  const payload = { entity };
  // If your backend route differs, change it here.
  // Common patterns: /run/daily or /runDaily
  return jsonFetch<{ ok: boolean; skipped?: boolean; message?: string }>(
    `${baseUrl()}/run/daily`,
    { method: "POST", body: JSON.stringify(payload) }
  );
}

/**
 * Manual "RUN NOW" button (ad-hoc run).
 * You can treat it as a "super" later if you want;
 * right now it’s just a manual trigger.
 */
export async function runNow(entity: string) {
  const payload = { entity };
  // If your backend route differs, change it here.
  return jsonFetch<{ ok: boolean; skipped?: boolean; message?: string }>(
    `${baseUrl()}/run/now`,
    { method: "POST", body: JSON.stringify(payload) }
  );
}

/**
 * Download the output XLSX from the backend.
 * Backend route can be either:
 *  - GET /download?entity=...&mode=daily
 *  - or something similar.
 */
export async function downloadXlsx(entity: string, mode: RunMode = "daily") {
  const url = `${baseUrl()}/download?entity=${encodeURIComponent(
    entity
  )}&mode=${encodeURIComponent(mode)}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Download failed: HTTP ${res.status}: ${text}`);
  }

  const blob = await res.blob();
  const a = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);

  // Try to use filename from header if present
  const cd = res.headers.get("content-disposition") || "";
  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
  const filename =
    (match?.[1] ? decodeURIComponent(match[1]) : match?.[2]) ||
    `${entity}_${mode}_recon.xlsx`;

  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(objectUrl);
}
