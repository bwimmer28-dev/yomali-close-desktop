from __future__ import annotations

import os
import re
import json
from dataclasses import asdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import pandas as pd

from .settings import ReconSettings, DEFAULT_SETTINGS, EntityConfig


# -----------------------------
# Helpers: dates + business days
# -----------------------------
_DATE_PATTERNS = [
    # 12_26_2025 or 12-26-2025
    re.compile(r"(?P<m>\d{1,2})[._-](?P<d>\d{1,2})[._-](?P<y>\d{4})"),
    # 20251226
    re.compile(r"(?P<y>\d{4})(?P<m>\d{2})(?P<d>\d{2})"),
    # 2025-12-26
    re.compile(r"(?P<y>\d{4})[._-](?P<m>\d{1,2})[._-](?P<d>\d{1,2})"),
]

def parse_date_from_filename(name: str) -> Optional[date]:
    base = os.path.basename(name)
    for pat in _DATE_PATTERNS:
        m = pat.search(base)
        if not m:
            continue
        try:
            y = int(m.group("y"))
            mo = int(m.group("m"))
            d = int(m.group("d"))
            return date(y, mo, d)
        except Exception:
            continue
    return None

def business_days_lookback(end_day: date, n_bdays: int) -> List[date]:
    days: List[date] = []
    cur = end_day
    while len(days) < n_bdays:
        # skip weekends
        if cur.weekday() < 5:
            days.append(cur)
        cur = cur - timedelta(days=1)
    return list(reversed(days))


# -----------------------------
# File discovery
# -----------------------------
def list_files(root: Path) -> List[Path]:
    if not root.exists():
        return []
    out: List[Path] = []
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in [".csv", ".xlsx", ".xls"]:
            out.append(p)
    return out

def choose_files_for_date(files: List[Path], target: date) -> List[Path]:
    """Return files whose filename contains the target date. If none, return empty."""
    picked = []
    for p in files:
        dt = parse_date_from_filename(p.name)
        if dt == target:
            picked.append(p)
    return sorted(picked)

def choose_crm_files_covering_date(files: List[Path], target: date) -> List[Path]:
    """NAV files often have two dates in filename: start_end. We'll include if either matches or range covers day."""
    picked: List[Path] = []
    for p in files:
        # find all parsed dates in filename
        found = []
        base = p.name
        for pat in _DATE_PATTERNS:
            for m in pat.finditer(base):
                try:
                    y = int(m.group("y")); mo = int(m.group("m")); d = int(m.group("d"))
                    found.append(date(y, mo, d))
                except Exception:
                    pass
        found = sorted(set(found))
        if not found:
            continue
        if target in found:
            picked.append(p)
        elif len(found) >= 2:
            if found[0] <= target <= found[-1]:
                picked.append(p)
    return sorted(picked)

def entity_root(settings: ReconSettings, entity: EntityConfig) -> Path:
    return Path(settings.input_root) / entity.name

# -----------------------------
# Loaders / normalizers
# -----------------------------
def _read_any(path: Path) -> pd.DataFrame:
    ext = path.suffix.lower()
    if ext in [".xlsx", ".xls"]:
        return pd.read_excel(path)
    return pd.read_csv(path)

def _norm_cols(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [re.sub(r"\s+", " ", str(c).strip()).lower() for c in df.columns]
    return df

def _coerce_date(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, errors="coerce").dt.date

def _coerce_amount(s: pd.Series) -> pd.Series:
    def f(x):
        if pd.isna(x):
            return None
        if isinstance(x, (int, float)):
            return float(x)
        t = str(x).strip().replace(",", "")
        if t.startswith("(") and t.endswith(")"):
            t = "-" + t[1:-1]
        try:
            return float(t)
        except Exception:
            return None
    return s.map(f).astype("float64")

def _pick(df: pd.DataFrame, options: List[str]) -> Optional[str]:
    cols = df.columns.tolist()
    s = set(cols)
    for o in options:
        if o in s:
            return o
    for o in options:
        for c in cols:
            if o in c:
                return c
    return None

def load_processor_file(path: Path, processor_name: str) -> pd.DataFrame:
    """Return standardized per-transaction rows: date, amount, description, processor."""
    raw = _norm_cols(_read_any(path))

    # Stripe itemized payouts: use created_utc + net, and filter categories
    if processor_name.lower() == "stripe":
        date_col = _pick(raw, ["created_utc", "created", "date"])
        amt_col = _pick(raw, ["net", "amount"])
        cat_col = _pick(raw, ["reporting_category", "category"])
        desc_col = _pick(raw, ["description", "statement_descriptor", "type"])

        df = pd.DataFrame()
        df["date"] = _coerce_date(raw[date_col]) if date_col else pd.Series([None]*len(raw))
        df["amount"] = _coerce_amount(raw[amt_col]) if amt_col else pd.Series([None]*len(raw), dtype="float64")
        df["description"] = raw[desc_col].astype(str) if desc_col else ""
        df["processor"] = "Stripe"

        if cat_col:
            # Keep the categories most likely to correspond to CRM cash postings
            keep = set(["charge", "refund", "dispute", "dispute_reversal", "adjustment", "payment"])
            df = df[df[cat_col].astype(str).str.lower().isin(keep)].copy()

        df = df.dropna(subset=["date", "amount"])
        return df

    # Braintree
    if processor_name.lower() == "braintree":
        # Prefer settlement date + settlement amount
        date_col = _pick(raw, ["settlement date", "settlement_date", "created datetime", "created"])
        amt_col = _pick(raw, ["settlement amount", "amount submitted for settlement", "amount authorized", "amount"])
        status_col = _pick(raw, ["transaction status", "status"])
        type_col = _pick(raw, ["transaction type", "type"])

        df = pd.DataFrame()
        df["date"] = _coerce_date(raw[date_col]) if date_col else pd.Series([None]*len(raw))
        df["amount"] = _coerce_amount(raw[amt_col]) if amt_col else pd.Series([None]*len(raw), dtype="float64")
        df["description"] = raw.get("transaction id", raw.get("id", "")).astype(str) if isinstance(raw.get("transaction id", None), pd.Series) else ""
        df["processor"] = "Braintree"

        # Filter to settled sales-like activity if columns exist
        if status_col:
            df = df[raw[status_col].astype(str).str.lower().isin(["settled", "settling", "submitted_for_settlement", "submitted for settlement"])].copy()
        if type_col:
            # keep sale/credit/void? - keep everything that has amount for now
            pass

        df = df.dropna(subset=["date", "amount"])
        return df

    # NMI
    if processor_name.lower() == "nmi":
        date_col = _pick(raw, ["action_date", "date"])
        amt_col = _pick(raw, ["action_amount", "amount"])
        desc_col = _pick(raw, ["transaction_id", "transaction id", "order_id", "order id", "description"])

        df = pd.DataFrame()
        df["date"] = _coerce_date(raw[date_col]) if date_col else pd.Series([None]*len(raw))
        df["amount"] = _coerce_amount(raw[amt_col]) if amt_col else pd.Series([None]*len(raw), dtype="float64")
        df["description"] = raw[desc_col].astype(str) if desc_col else ""
        df["processor"] = "NMI"
        df = df.dropna(subset=["date", "amount"])
        return df

    # default generic
    date_col = _pick(raw, ["date", "txn date", "transaction date"])
    amt_col = _pick(raw, ["amount", "net amount", "net"])
    desc_col = _pick(raw, ["description", "memo", "details"])

    df = pd.DataFrame()
    df["date"] = _coerce_date(raw[date_col]) if date_col else pd.Series([None]*len(raw))
    df["amount"] = _coerce_amount(raw[amt_col]) if amt_col else pd.Series([None]*len(raw), dtype="float64")
    df["description"] = raw[desc_col].astype(str) if desc_col else ""
    df["processor"] = processor_name
    df = df.dropna(subset=["date", "amount"])
    return df

def load_crm_files(paths: List[Path]) -> pd.DataFrame:
    """Load NAV sales-style files and return per-row postings with merchant and amount and date."""
    frames: List[pd.DataFrame] = []
    for p in paths:
        raw = _norm_cols(_read_any(p))
        # For NAV_*_sales files: posting date, account type, account no, amount
        date_col = _pick(raw, ["posting date", "date"])
        acct_type = _pick(raw, ["account type", "type"])
        acct_no = _pick(raw, ["account no.", "account no", "account", "customer", "account no_"])
        amt_col = _pick(raw, ["amount", "net", "total"])
        desc_col = _pick(raw, ["description", "memo"])

        if not date_col or not amt_col:
            continue

        df = pd.DataFrame()
        df["date"] = _coerce_date(raw[date_col])
        df["amount"] = _coerce_amount(raw[amt_col])
        df["description"] = raw[desc_col].astype(str) if desc_col else ""
        df["merchant"] = raw[acct_no].astype(str) if acct_no else "Unknown"

        # Filter: only Customer lines when present
        if acct_type:
            df = df[raw[acct_type].astype(str).str.lower().eq("customer")].copy()

        df = df.dropna(subset=["date", "amount"])
        frames.append(df)

    if not frames:
        return pd.DataFrame(columns=["date", "amount", "description", "merchant"])
    return pd.concat(frames, ignore_index=True)

def map_merchant_name(x: str) -> str:
    t = str(x).strip().lower()
    # Normalize common names to match processors
    if "paypal" in t:
        return "PayPal"
    if "stripe" in t:
        return "Stripe"
    if "braintree" in t:
        return "Braintree"
    if "nmi" in t:
        return "NMI"
    return str(x).strip()


# -----------------------------
# Reconciliation (2-way): processors vs CRM
# -----------------------------
def reconcile_daily(
    settings: ReconSettings,
    entity_id: str,
    target_day: date,
) -> Tuple[pd.DataFrame, pd.DataFrame, Dict]:
    """Return (summary_df, exceptions_df, meta)."""
    if entity_id not in settings.entities:
        raise ValueError(f"Unknown entity_id: {entity_id}")

    ent = settings.entities[entity_id]
    root = entity_root(settings, ent)

    # Discover processor files (we scan their folders and pick files for date)
    processor_frames: List[pd.DataFrame] = []
    proc_file_map: Dict[str, List[str]] = {}
    for folder in ent.processor_folders:
        folder_path = root / folder
        all_files = list_files(folder_path)
        picked = choose_files_for_date(all_files, target_day)
        proc_file_map[folder] = [str(p) for p in picked]

        # If none matched exactly, allow picking the most recent file <= target_day
        if not picked:
            dated = [(parse_date_from_filename(p.name), p) for p in all_files]
            dated = [(d, p) for d, p in dated if d and d <= target_day]
            dated.sort(key=lambda x: x[0], reverse=True)
            picked = [dated[0][1]] if dated else []

        # Load each picked file
        for p in picked:
            processor_frames.append(load_processor_file(p, folder))

    proc_df = (
        pd.concat(processor_frames, ignore_index=True)
        if processor_frames
        else pd.DataFrame(
            {
                "date": pd.Series(dtype="object"),
                "amount": pd.Series(dtype="float64"),
                "description": pd.Series(dtype="string"),
                "processor": pd.Series(dtype="string"),
            }
        )
    )

    # Ensure merchant is ALWAYS a string column (prevents float/object merge issues on empty frames)
    if "processor" not in proc_df.columns:
        proc_df["processor"] = pd.Series(dtype="string")
    proc_df["merchant"] = proc_df["processor"].astype("string").map(map_merchant_name).astype("string")
# CRM files live in crm_folder, but often have ranges in filename
    crm_folder = root / ent.crm_folder
    crm_files = list_files(crm_folder)
    crm_picked = choose_crm_files_covering_date(crm_files, target_day)
    crm_df = load_crm_files(crm_picked)
    if crm_df.empty:
        # Keep consistent dtypes
        crm_df = pd.DataFrame(
            {
                "date": pd.Series(dtype="object"),
                "amount": pd.Series(dtype="float64"),
                "description": pd.Series(dtype="string"),
                "merchant": pd.Series(dtype="string"),
            }
        )
    else:
        crm_df["merchant"] = crm_df["merchant"].astype("string").map(map_merchant_name).astype("string")
# Aggregate by merchant + date# Aggregate by merchant + date
    proc_day = proc_df[proc_df["date"] == target_day].copy() if not proc_df.empty else proc_df
    crm_day = crm_df[crm_df["date"] == target_day].copy() if not crm_df.empty else crm_df

    # Defensive: keep merge keys consistent types
    if "merchant" in proc_day.columns:
        proc_day["merchant"] = proc_day["merchant"].astype("string").fillna("")
    if "merchant" in crm_day.columns:
        crm_day["merchant"] = crm_day["merchant"].astype("string").fillna("")

    proc_tot = (
        proc_day.groupby(["merchant", "date"], as_index=False)["amount"]
        .sum()
        .rename(columns={"amount": "processor_total"})
    )
    crm_tot = (
        crm_day.groupby(["merchant", "date"], as_index=False)["amount"]
        .sum()
        .rename(columns={"amount": "crm_total"})
    )

    # Outer join to find mismatches / missing
    merged = proc_tot.merge(crm_tot, on=["merchant","date"], how="outer")
    merged["processor_total"] = merged["processor_total"].fillna(0.0)
    merged["crm_total"] = merged["crm_total"].fillna(0.0)
    merged["diff"] = (merged["processor_total"] - merged["crm_total"]).round(2)
    merged["abs_diff"] = merged["diff"].abs().round(2)

    merged["status"] = merged.apply(
        lambda r: "Matched" if r["abs_diff"] <= settings.amount_tolerance and r["processor_total"] != 0 and r["crm_total"] != 0
        else ("Missing in CRM" if r["crm_total"] == 0 and r["processor_total"] != 0
              else ("Missing in Processor" if r["processor_total"] == 0 and r["crm_total"] != 0
                    else "Needs Review")),
        axis=1,
    )

    # Summary: totals + counts
    summary_rows = []
    summary_rows.append({"entity_id": entity_id, "entity": ent.name, "date": str(target_day), "metric": "processor_rows", "value": int(len(proc_day))})
    summary_rows.append({"entity_id": entity_id, "entity": ent.name, "date": str(target_day), "metric": "crm_rows", "value": int(len(crm_day))})
    summary_rows.append({"entity_id": entity_id, "entity": ent.name, "date": str(target_day), "metric": "processor_total", "value": float(proc_day["amount"].sum()) if not proc_day.empty else 0.0})
    summary_rows.append({"entity_id": entity_id, "entity": ent.name, "date": str(target_day), "metric": "crm_total", "value": float(crm_day["amount"].sum()) if not crm_day.empty else 0.0})
    summary_rows.append({"entity_id": entity_id, "entity": ent.name, "date": str(target_day), "metric": "matched_merchants", "value": int((merged["status"]=="Matched").sum())})
    summary_rows.append({"entity_id": entity_id, "entity": ent.name, "date": str(target_day), "metric": "exceptions", "value": int((merged["status"]!="Matched").sum())})
    summary_df = pd.DataFrame(summary_rows)

    exceptions_df = merged[merged["status"]!="Matched"].copy()
    exceptions_df = exceptions_df.sort_values(["abs_diff","merchant"], ascending=[False, True])
    exceptions_df["resolution"] = "Open"  # default; UI can change later

    meta = {
        "entity_id": entity_id,
        "entity": ent.name,
        "target_day": str(target_day),
        "processor_files": proc_file_map,
        "crm_files": [str(p) for p in crm_picked],
        "tolerance": settings.amount_tolerance,
    }
    return summary_df, exceptions_df, meta


# -----------------------------
# Outputs + status
# -----------------------------
def output_filename(entity_id: str, target_day: date, super_recon: bool = False, month: Optional[str] = None) -> str:
    if super_recon:
        m = month or target_day.strftime("%Y-%m")
        return f"{entity_id}_super_recon_{m}.xlsx"
    return f"{entity_id}_daily_recon_{target_day.isoformat()}.xlsx"

def status_from_output_dir(settings: ReconSettings) -> Dict:
    out_dir = Path(settings.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    results = {}
    for eid, ent in settings.entities.items():
        last_daily = None
        last_super = None
        for p in out_dir.glob(f"{eid}_daily_recon_*.xlsx"):
            m = re.search(r"(\d{4}-\d{2}-\d{2})", p.name)
            if m:
                d = m.group(1)
                if (last_daily is None) or (d > last_daily):
                    last_daily = d
        for p in out_dir.glob(f"{eid}_super_recon_*.xlsx"):
            m = re.search(r"(\d{4}-\d{2})", p.name)
            if m:
                d = m.group(1)
                if (last_super is None) or (d > last_super):
                    last_super = d
        results[eid] = {
            "entity_id": eid,
            "entity": ent.name,
            "last_daily": last_daily,
            "last_super": last_super,
        }
    return results

def already_ran(settings: ReconSettings, entity_id: str, target_day: date, super_recon: bool = False, month: Optional[str] = None) -> bool:
    out_dir = Path(settings.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = output_filename(entity_id, target_day, super_recon=super_recon, month=month)
    return (out_dir / name).exists()
