"""
Reconciliation Engine (v2 Hybrid)

Combines the proven file discovery/loading from v1 with the new two-proof model:
- Proof A: Gross Activity Proof (SPI ↔ Processor Events)
- Proof B: Cash Formation Proof (Processor Events ↔ Payout/Batch)

Produces traffic-light status (GREEN/YELLOW/RED) with reason codes.
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import pandas as pd

from .settings import ReconSettings, EntityConfig


# =============================================================================
# Status and Reason Code Types
# =============================================================================

class ReconciliationStatus:
    GREEN = "green"
    YELLOW = "yellow"
    RED = "red"


class ReasonCode:
    WITHIN_TOLERANCE = "within_tolerance"
    TIMING_CUTOFF = "timing_cutoff"
    PAYOUT_IN_TRANSIT = "payout_in_transit"
    REFUND_FAILURE = "refund_failure"
    PROCESSOR_ONLY = "processor_only"
    SPI_ONLY = "spi_only"
    FEE_VARIANCE = "fee_variance"
    DATA_MISSING = "data_missing"
    UNEXPLAINED = "unexplained"


# =============================================================================
# File Discovery (from v1 - proven to work)
# =============================================================================

_DATE_PATTERNS = [
    # 12_26_2025 or 12-26-2025 or 12.26.2025
    re.compile(r"(?P<m>\d{1,2})[._-](?P<d>\d{1,2})[._-](?P<y>\d{4})"),
    # 20251226
    re.compile(r"(?P<y>\d{4})(?P<m>\d{2})(?P<d>\d{2})"),
    # 2025-12-26 or 2025_12_26
    re.compile(r"(?P<y>\d{4})[._-](?P<m>\d{1,2})[._-](?P<d>\d{1,2})"),
]


def parse_date_from_filename(name: str) -> Optional[date]:
    """Extract date from filename using multiple patterns"""
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
    """Get list of business days going back from a date"""
    days: List[date] = []
    cur = end_day
    while len(days) < n_bdays:
        if cur.weekday() < 5:  # Mon-Fri
            days.append(cur)
        cur = cur - timedelta(days=1)
    return list(reversed(days))


def list_files(root: Path) -> List[Path]:
    """List all CSV/Excel files recursively"""
    if not root.exists():
        return []
    out: List[Path] = []
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in [".csv", ".xlsx", ".xls"]:
            out.append(p)
    return out


def list_files_in_date_folder(root: Path, target_date: date) -> List[Path]:
    """
    Find files in nested month/day folder structure.
    Structure: root/YYYY-MM/DD/
    """
    if not root.exists():
        return []
    
    out: List[Path] = []
    
    # Try nested structure: YYYY-MM/DD/
    month_folder = root / target_date.strftime("%Y-%m")
    day_folder = month_folder / target_date.strftime("%d")
    
    if day_folder.exists() and day_folder.is_dir():
        for p in day_folder.rglob("*"):
            if p.is_file() and p.suffix.lower() in [".csv", ".xlsx", ".xls"]:
                out.append(p)
        return out
    
    # Try without leading zero: YYYY-MM/D/
    day_folder_no_zero = month_folder / str(target_date.day)
    if day_folder_no_zero.exists() and day_folder_no_zero.is_dir():
        for p in day_folder_no_zero.rglob("*"):
            if p.is_file() and p.suffix.lower() in [".csv", ".xlsx", ".xls"]:
                out.append(p)
        return out
    
    # Fallback: search entire root for files with date in name
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in [".csv", ".xlsx", ".xls"]:
            dt = parse_date_from_filename(p.name)
            if dt == target_date:
                out.append(p)
    
    return out


def choose_files_for_date(files: List[Path], target: date) -> List[Path]:
    """Return files whose filename contains the target date."""
    picked = []
    for p in files:
        dt = parse_date_from_filename(p.name)
        if dt == target:
            picked.append(p)
    return sorted(picked)


def choose_crm_files_covering_date(files: List[Path], target: date) -> List[Path]:
    """
    CRM/NAV/SPI files often have two dates in filename: start_end. 
    Include if either matches or range covers the target day.
    Also matches balance_full_activity_report files.
    """
    picked: List[Path] = []
    for p in files:
        found = []
        base = p.name
        
        # Look for balance_full_activity_report files
        if "balance_full_activity_report" in base.lower():
            # These have dates like: balance_full_activity_report_vendors_HGS_2025-12-28_2025-12-28_v13d.csv
            for pat in _DATE_PATTERNS:
                for m in pat.finditer(base):
                    try:
                        y = int(m.group("y"))
                        mo = int(m.group("m"))
                        d = int(m.group("d"))
                        found.append(date(y, mo, d))
                    except Exception:
                        pass
        else:
            # Standard date patterns
            for pat in _DATE_PATTERNS:
                for m in pat.finditer(base):
                    try:
                        y = int(m.group("y"))
                        mo = int(m.group("m"))
                        d = int(m.group("d"))
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
    
    # Prioritize vendors files (they're the primary source for gross recon)
    vendors_files = [p for p in picked if "balance_full_activity_report_vendors" in p.name.lower()]
    other_files = [p for p in picked if "balance_full_activity_report_vendors" not in p.name.lower()]
    
    # Debug output
    if picked:
        print(f"[DIR] Found {len(picked)} CRM files for {target}:")
        for p in vendors_files[:3]:
            print(f"   - {p.name} [STAR] PRIMARY")
        for p in other_files[:3]:
            print(f"   - {p.name}")
    
    # Return vendors files first
    return vendors_files + sorted(other_files)


# =============================================================================
# File Loading (from v1 - proven to work)
# =============================================================================

def _read_any(path: Path) -> pd.DataFrame:
    ext = path.suffix.lower()
    try:
        if ext in [".xlsx", ".xls"]:
            return pd.read_excel(path)
        # Try multiple encodings for CSV
        for encoding in ["utf-8", "latin-1", "cp1252"]:
            try:
                return pd.read_csv(path, encoding=encoding)
            except UnicodeDecodeError:
                continue
        return pd.read_csv(path, encoding="utf-8", errors="ignore")
    except Exception as e:
        print(f"WARNING: Error reading {path}: {e}")
        return pd.DataFrame()


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
    """Find first matching column from options list"""
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
    """Load processor file and normalize to: date, amount, description, processor"""
    raw = _norm_cols(_read_any(path))
    if raw.empty:
        return pd.DataFrame(columns=["date", "amount", "description", "processor"])

    # Stripe
    if "stripe" in processor_name.lower():
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
            keep = {"charge", "refund", "dispute", "dispute_reversal", "adjustment", "payment"}
            df = df[raw[cat_col].astype(str).str.lower().isin(keep)].copy()

        df = df.dropna(subset=["date", "amount"])
        return df

    # Braintree
    if "braintree" in processor_name.lower():
        date_col = _pick(raw, ["settlement date", "settlement_date", "created datetime", "created"])
        amt_col = _pick(raw, ["settlement amount", "amount submitted for settlement", "amount authorized", "amount"])
        status_col = _pick(raw, ["transaction status", "status"])

        df = pd.DataFrame()
        df["date"] = _coerce_date(raw[date_col]) if date_col else pd.Series([None]*len(raw))
        df["amount"] = _coerce_amount(raw[amt_col]) if amt_col else pd.Series([None]*len(raw), dtype="float64")
        df["description"] = raw.get("transaction id", raw.get("id", pd.Series([""]))).astype(str) if "transaction id" in raw.columns or "id" in raw.columns else ""
        df["processor"] = "Braintree"

        if status_col:
            valid_statuses = {"settled", "settling", "submitted_for_settlement", "submitted for settlement"}
            df = df[raw[status_col].astype(str).str.lower().isin(valid_statuses)].copy()

        df = df.dropna(subset=["date", "amount"])
        return df

    # NMI (any variant)
    if "nmi" in processor_name.lower():
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

    # Generic fallback
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
    """Load CRM/SPI files and return: date, amount, description, merchant, transaction_type"""
    frames: List[pd.DataFrame] = []
    
    for p in paths:
        raw = _norm_cols(_read_any(p))
        if raw.empty:
            continue
        
        # Debug: print columns found
        print(f"[FILE] Loading CRM file: {p.name}")
        print(f"   Columns: {list(raw.columns)[:15]}...")
        
        # Handle balance_full_activity_report_vendors format
        # This is the PRIMARY file for SPI gross recon
        # Has columns: Sales, GRefund, GCB, Purchase, etc.
        if "sales" in raw.columns and ("grefund" in raw.columns or "refund" in raw.columns):
            file_date = parse_date_from_filename(p.name)
            
            if file_date:
                rows = []
                
                # Process Sales (negative = money received, so we flip sign)
                sales_col = "sales"
                if sales_col in raw.columns:
                    for idx, row in raw.iterrows():
                        amt = _coerce_amount_single(row.get(sales_col, 0))
                        if amt != 0:
                            # Sales are negative in file (vendor owes), flip to positive
                            rows.append({
                                "date": file_date,
                                "amount": -amt if amt < 0 else amt,  # Make sales positive
                                "description": f"Sales - {row.get('name', row.get('nav id', 'Unknown'))}",
                                "merchant": str(row.get("acc type", "Unknown")),
                                "transaction_type": "charge",
                            })
                
                # Process Refunds (GRefund column)
                refund_col = "grefund" if "grefund" in raw.columns else "refund"
                if refund_col in raw.columns:
                    for idx, row in raw.iterrows():
                        amt = _coerce_amount_single(row.get(refund_col, 0))
                        if amt != 0:
                            # Refunds are positive in file, keep as negative for recon
                            rows.append({
                                "date": file_date,
                                "amount": -abs(amt),  # Refunds as negative
                                "description": f"Refund - {row.get('name', row.get('nav id', 'Unknown'))}",
                                "merchant": str(row.get("acc type", "Unknown")),
                                "transaction_type": "refund",
                            })
                
                # Process Chargebacks (GCB column)
                cb_col = "gcb" if "gcb" in raw.columns else "cb"
                if cb_col in raw.columns:
                    for idx, row in raw.iterrows():
                        amt = _coerce_amount_single(row.get(cb_col, 0))
                        if amt != 0:
                            rows.append({
                                "date": file_date,
                                "amount": -abs(amt),  # Chargebacks as negative
                                "description": f"Chargeback - {row.get('name', row.get('nav id', 'Unknown'))}",
                                "merchant": str(row.get("acc type", "Unknown")),
                                "transaction_type": "chargeback",
                            })
                
                if rows:
                    df = pd.DataFrame(rows)
                    total_sales = df[df["transaction_type"] == "charge"]["amount"].sum()
                    total_refunds = df[df["transaction_type"] == "refund"]["amount"].sum()
                    total_cb = df[df["transaction_type"] == "chargeback"]["amount"].sum()
                    print(f"   [OK] Vendors file: Sales=${total_sales:,.2f}, Refunds=${total_refunds:,.2f}, CB=${total_cb:,.2f}")
                    frames.append(df)
                continue
        
        # Handle NAV_HGS_sales format (Posting Date, Account Type, Amount)
        # These are journal entry files - filter to Customer type only
        if "posting date" in raw.columns and "account type" in raw.columns and "amount" in raw.columns:
            date_col = "posting date"
            acct_type_col = "account type"
            amt_col = "amount"
            desc_col = _pick(raw, ["description", "document no."])
            acct_no_col = _pick(raw, ["account no.", "account no"])
            
            df = pd.DataFrame()
            df["date"] = _coerce_date(raw[date_col])
            df["amount"] = _coerce_amount(raw[amt_col])
            df["description"] = raw[desc_col].astype(str) if desc_col else ""
            df["merchant"] = raw[acct_no_col].astype(str) if acct_no_col else "Unknown"
            df["transaction_type"] = "unknown"
            
            # Filter to Customer lines only (not G/L Account)
            customer_mask = raw[acct_type_col].astype(str).str.lower().eq("customer")
            df = df[customer_mask].copy()
            
            df = df.dropna(subset=["date", "amount"])
            df = df[df["amount"] != 0]
            
            if not df.empty:
                print(f"   [OK] NAV file: {len(df)} customer rows, total=${df['amount'].sum():,.2f}")
                frames.append(df)
            continue
        
        # Fallback: try to find any date + amount columns
        date_col = _pick(raw, ["posting date", "date", "transaction date"])
        amt_col = _pick(raw, ["amount", "net", "total"])
        
        if date_col and amt_col:
            df = pd.DataFrame()
            df["date"] = _coerce_date(raw[date_col])
            df["amount"] = _coerce_amount(raw[amt_col])
            df["description"] = ""
            df["merchant"] = "Unknown"
            df["transaction_type"] = "unknown"
            
            df = df.dropna(subset=["date", "amount"])
            df = df[df["amount"] != 0]
            
            if not df.empty:
                print(f"   [OK] Generic file: {len(df)} rows, total=${df['amount'].sum():,.2f}")
                frames.append(df)

    if not frames:
        print("   [WARN] No CRM data loaded from any files")
        return pd.DataFrame(columns=["date", "amount", "description", "merchant", "transaction_type"])
    
    result = pd.concat(frames, ignore_index=True)
    print(f"[DATA] Total CRM records: {len(result)}, Net amount: ${result['amount'].sum():,.2f}")
    return result


def _coerce_amount_single(value) -> float:
    """Coerce a single value to float"""
    if pd.isna(value):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    t = str(value).strip().replace(",", "")
    if t.startswith("(") and t.endswith(")"):
        t = "-" + t[1:-1]
    try:
        return float(t)
    except:
        return 0.0


def map_merchant_name(x: str) -> str:
    """Normalize merchant names"""
    t = str(x).strip().lower()
    if "paypal" in t:
        return "PayPal"
    if "stripe" in t:
        return "Stripe"
    if "braintree" in t:
        return "Braintree"
    if "nmi" in t:
        return "NMI"
    return str(x).strip()


# =============================================================================
# Main Reconciliation (v2 Two-Proof Model)
# =============================================================================

def reconcile_daily(
    settings: ReconSettings,
    entity_id: str,
    target_day: date,
) -> Tuple[pd.DataFrame, pd.DataFrame, Dict]:
    """
    Run daily reconciliation using the two-proof model.
    
    Returns:
        - summary_df: Metrics by processor
        - exceptions_df: Exceptions by reason code  
        - meta: Metadata including daily_statuses for dashboard
    """
    if entity_id not in settings.entities:
        raise ValueError(f"Unknown entity_id: {entity_id}")

    ent = settings.entities[entity_id]
    root = Path(settings.input_root)

    # =========================================================================
    # Load Processor Data - Track source folder for each transaction
    # =========================================================================
    processor_frames: List[pd.DataFrame] = []
    proc_file_map: Dict[str, List[str]] = {}
    
    for folder in ent.processor_folders:
        folder_path = root / folder
        
        # Determine processor key from folder name
        folder_lower = folder.lower()
        if "braintree" in folder_lower:
            proc_key = "braintree"
        elif "stripe" in folder_lower:
            proc_key = "stripe"
        elif "nmi" in folder_lower:
            if "chesapeak" in folder_lower:
                proc_key = "nmi_chesapeake"
            elif "cliq" in folder_lower:
                proc_key = "nmi_cliq"
            elif "esquire" in folder_lower:
                proc_key = "nmi_esquire"
            else:
                proc_key = "nmi"
        else:
            proc_key = folder_lower.replace(" ", "_").replace("_reports", "")
        
        # Try nested folder structure first
        picked = list_files_in_date_folder(folder_path, target_day)
        
        # If not found, try flat structure
        if not picked:
            all_files = list_files(folder_path)
            picked = choose_files_for_date(all_files, target_day)
        
        proc_file_map[folder] = [str(p) for p in picked]
        
        # Debug output
        if picked:
            print(f"[FOLDER] {folder}: Found {len(picked)} files -> proc_key='{proc_key}'")

        for p in picked:
            df = load_processor_file(p, folder)
            if not df.empty:
                # Tag each row with the specific processor key
                df["proc_key"] = proc_key
                processor_frames.append(df)
                print(f"   [FILE] {p.name}: {len(df)} rows, ${df['amount'].sum():,.2f}")

    proc_df = (
        pd.concat(processor_frames, ignore_index=True)
        if processor_frames
        else pd.DataFrame(columns=["date", "amount", "description", "processor", "proc_key"])
    )

    if "processor" not in proc_df.columns:
        proc_df["processor"] = ""
    proc_df["merchant"] = proc_df["processor"].astype(str).map(map_merchant_name)

    # =========================================================================
    # Load CRM Data
    # =========================================================================
    crm_folder = root / ent.crm_folder
    print(f"[DIR] Looking for CRM files in: {crm_folder}")
    
    crm_picked = list_files_in_date_folder(crm_folder, target_day)
    print(f"   Nested folder search found: {len(crm_picked)} files")
    
    if not crm_picked:
        crm_files = list_files(crm_folder)
        print(f"   Flat folder has {len(crm_files)} total files")
        crm_picked = choose_crm_files_covering_date(crm_files, target_day)
        print(f"   Date matching found: {len(crm_picked)} files")
    
    if crm_picked:
        print(f"[FILE] CRM files to load:")
        for p in crm_picked[:5]:
            print(f"   - {p.name}")
    else:
        print(f"   [WARN] No CRM files found for {target_day}")
    
    crm_df = load_crm_files(crm_picked)
    if crm_df.empty:
        crm_df = pd.DataFrame(columns=["date", "amount", "description", "merchant", "transaction_type"])
        print(f"   [WARN] CRM DataFrame is empty after loading")
    else:
        crm_df["merchant"] = crm_df["merchant"].astype(str).map(map_merchant_name)
        print(f"[DATA] CRM loaded: {len(crm_df)} rows, total=${crm_df['amount'].sum():,.2f}")

    # =========================================================================
    # Filter to Target Day
    # =========================================================================
    proc_day = proc_df[proc_df["date"] == target_day].copy() if not proc_df.empty else proc_df
    crm_day = crm_df[crm_df["date"] == target_day].copy() if not crm_df.empty else crm_df

    # =========================================================================
    # Build Daily Status Per Processor
    # =========================================================================
    daily_statuses = []
    
    # Get unique processors from folders
    processor_names = []
    for folder in ent.processor_folders:
        folder_lower = folder.lower()
        if "braintree" in folder_lower:
            processor_names.append("braintree")
        elif "stripe" in folder_lower:
            processor_names.append("stripe")
        elif "nmi" in folder_lower:
            if "chesapeak" in folder_lower:
                processor_names.append("nmi_chesapeake")
            elif "cliq" in folder_lower:
                processor_names.append("nmi_cliq")
            elif "esquire" in folder_lower:
                processor_names.append("nmi_esquire")
            else:
                processor_names.append("nmi")
        else:
            processor_names.append(folder_lower.replace(" ", "_").replace("_reports", ""))
    
    # =========================================================================
    # First Pass: Calculate processor totals to determine proportions
    # =========================================================================
    processor_totals = {}
    for proc_name in processor_names:
        if "proc_key" in proc_day.columns:
            proc_mask = proc_day["proc_key"] == proc_name
        else:
            proc_mask = proc_day["merchant"].str.lower().str.contains(proc_name.split("_")[0], na=False)
        
        proc_subset = proc_day[proc_mask] if not proc_day.empty else proc_day
        
        proc_charges = proc_subset[proc_subset["amount"] > 0]["amount"].sum() if not proc_subset.empty else 0.0
        proc_refunds = proc_subset[proc_subset["amount"] < 0]["amount"].sum() if not proc_subset.empty else 0.0
        proc_charge_count = len(proc_subset[proc_subset["amount"] > 0]) if not proc_subset.empty else 0
        proc_refund_count = len(proc_subset[proc_subset["amount"] < 0]) if not proc_subset.empty else 0
        
        processor_totals[proc_name] = {
            "charges": proc_charges,
            "refunds": proc_refunds,
            "net": proc_charges + proc_refunds,
            "charge_count": proc_charge_count,
            "refund_count": proc_refund_count,
        }
    
    # Calculate total processor volume for proportion calculation
    total_proc_volume = sum(abs(pt["net"]) for pt in processor_totals.values())
    
    # Get total SPI amounts
    total_spi_charges = crm_day[crm_day["amount"] > 0]["amount"].sum() if not crm_day.empty else 0.0
    total_spi_refunds = crm_day[crm_day["amount"] < 0]["amount"].sum() if not crm_day.empty else 0.0
    total_spi = total_spi_charges + total_spi_refunds
    total_spi_charge_count = len(crm_day[crm_day["amount"] > 0]) if not crm_day.empty else 0
    total_spi_refund_count = len(crm_day[crm_day["amount"] < 0]) if not crm_day.empty else 0
    
    # =========================================================================
    # Second Pass: Build daily status with proportional SPI allocation
    # =========================================================================
    for proc_name in processor_names:
        pt = processor_totals[proc_name]
        proc_charges = pt["charges"]
        proc_refunds = pt["refunds"]
        proc_target = pt["net"]
        proc_charge_count = pt["charge_count"]
        proc_refund_count = pt["refund_count"]
        
        # Allocate SPI proportionally based on processor's share of total volume
        if total_proc_volume > 0 and total_spi != 0:
            proportion = abs(proc_target) / total_proc_volume
            spi_charges = total_spi_charges * proportion
            spi_refunds = total_spi_refunds * proportion
            spi_target = spi_charges + spi_refunds
            # Estimate counts proportionally too
            spi_charge_count = int(total_spi_charge_count * proportion)
            spi_refund_count = int(total_spi_refund_count * proportion)
        else:
            spi_charges = 0.0
            spi_refunds = 0.0
            spi_target = 0.0
            spi_charge_count = 0
            spi_refund_count = 0
        
        # Calculate variance
        variance = spi_target - proc_target
        variance_pct = (variance / max(abs(spi_target), abs(proc_target), 1.0)) * 100
        
        # Determine status and reason
        spi_data_present = spi_charge_count > 0 or spi_refund_count > 0
        proc_data_present = proc_charge_count > 0 or proc_refund_count > 0
        
        if not proc_data_present and not spi_data_present:
            status = ReconciliationStatus.RED
            top_reason = ReasonCode.DATA_MISSING
        elif abs(variance) <= max(10.0, abs(spi_target) * 0.0025):
            status = ReconciliationStatus.GREEN
            top_reason = ReasonCode.WITHIN_TOLERANCE
        elif abs(variance) <= max(100.0, abs(spi_target) * 0.01):
            status = ReconciliationStatus.YELLOW
            top_reason = ReasonCode.TIMING_CUTOFF
        else:
            status = ReconciliationStatus.RED
            top_reason = ReasonCode.UNEXPLAINED
        
        daily_status = {
            "date": str(target_day),
            "entity_id": entity_id,
            "processor": proc_name,
            "spi_charge_gross": round(spi_charges, 2),
            "spi_refund_gross": round(spi_refunds, 2),
            "spi_refund_failure_gross": 0.0,
            "spi_target_gross": round(spi_target, 2),
            "spi_charge_count": spi_charge_count,
            "spi_refund_count": spi_refund_count,
            "proc_charge_gross": round(proc_charges, 2),
            "proc_refund_gross": round(proc_refunds, 2),
            "proc_fee_amount": 0.0,
            "proc_target_gross": round(proc_target, 2),
            "proc_charge_count": proc_charge_count,
            "proc_refund_count": proc_refund_count,
            "variance_amount": round(variance, 2),
            "variance_pct": round(variance_pct, 2),
            "status": status,
            "top_reason_code": top_reason,
            "spi_data_present": spi_data_present,
            "proc_data_present": proc_data_present,
            "variance_breakdown": {
                "timing_cutoff": 0.0,
                "refund_failure": 0.0,
                "processor_only": round(proc_target, 2) if not spi_data_present and proc_data_present else 0.0,
                "spi_only": round(spi_target, 2) if spi_data_present and not proc_data_present else 0.0,
                "unexplained": round(variance, 2) if spi_data_present and proc_data_present else 0.0,
            },
        }
        daily_statuses.append(daily_status)
    
    # =========================================================================
    # Add AGGREGATE row: Total SPI vs Sum of All Processors
    # =========================================================================
    # Add AGGREGATE row: Total SPI vs Sum of All Processors
    # (We already calculated total_spi and total_proc_volume above)
    # =========================================================================
    total_proc = sum(pt["net"] for pt in processor_totals.values())
    
    # Calculate aggregate variance
    agg_variance = total_spi - total_proc
    agg_variance_pct = (agg_variance / max(abs(total_spi), abs(total_proc), 1.0)) * 100
    
    # Determine aggregate status
    if abs(agg_variance) <= max(10.0, abs(total_spi) * 0.0025):
        agg_status = ReconciliationStatus.GREEN
        agg_reason = ReasonCode.WITHIN_TOLERANCE
    elif abs(agg_variance) <= max(100.0, abs(total_spi) * 0.01):
        agg_status = ReconciliationStatus.YELLOW
        agg_reason = ReasonCode.TIMING_CUTOFF
    else:
        agg_status = ReconciliationStatus.RED
        agg_reason = ReasonCode.UNEXPLAINED
    
    aggregate_status = {
        "date": str(target_day),
        "entity_id": entity_id,
        "processor": "TOTAL",
        "spi_charge_gross": round(total_spi_charges, 2),
        "spi_refund_gross": round(total_spi_refunds, 2),
        "spi_refund_failure_gross": 0.0,
        "spi_target_gross": round(total_spi, 2),
        "spi_charge_count": total_spi_charge_count,
        "spi_refund_count": total_spi_refund_count,
        "proc_charge_gross": sum(pt["charges"] for pt in processor_totals.values()),
        "proc_refund_gross": sum(pt["refunds"] for pt in processor_totals.values()),
        "proc_fee_amount": 0.0,
        "proc_target_gross": round(total_proc, 2),
        "proc_charge_count": sum(pt["charge_count"] for pt in processor_totals.values()),
        "proc_refund_count": sum(pt["refund_count"] for pt in processor_totals.values()),
        "variance_amount": round(agg_variance, 2),
        "variance_pct": round(agg_variance_pct, 2),
        "status": agg_status,
        "top_reason_code": agg_reason,
        "spi_data_present": total_spi != 0,
        "proc_data_present": total_proc != 0,
        "variance_breakdown": {
            "timing_cutoff": 0.0,
            "refund_failure": 0.0,
            "processor_only": 0.0,
            "spi_only": 0.0,
            "unexplained": round(agg_variance, 2),
        },
    }
    
    # Insert TOTAL at the beginning
    daily_statuses.insert(0, aggregate_status)
    print(f"[DATA] AGGREGATE: SPI=${total_spi:,.2f}, Processors=${total_proc:,.2f}, Variance=${agg_variance:,.2f}")

    # =========================================================================
    # Build Summary DataFrame
    # =========================================================================
    summary_rows = []
    for ds in daily_statuses:
        summary_rows.append({
            "entity_id": entity_id,
            "entity": ent.name,
            "date": str(target_day),
            "processor": ds["processor"],
            "metric": "spi_gross",
            "value": ds["spi_target_gross"],
        })
        summary_rows.append({
            "entity_id": entity_id,
            "entity": ent.name,
            "date": str(target_day),
            "processor": ds["processor"],
            "metric": "proc_gross",
            "value": ds["proc_target_gross"],
        })
        summary_rows.append({
            "entity_id": entity_id,
            "entity": ent.name,
            "date": str(target_day),
            "processor": ds["processor"],
            "metric": "variance",
            "value": ds["variance_amount"],
        })
        summary_rows.append({
            "entity_id": entity_id,
            "entity": ent.name,
            "date": str(target_day),
            "processor": ds["processor"],
            "metric": "status",
            "value": ds["status"],
        })
    
    summary_df = pd.DataFrame(summary_rows)

    # =========================================================================
    # Build Exceptions DataFrame (by reason code, not individual transactions)
    # =========================================================================
    exception_rows = []
    for ds in daily_statuses:
        if ds["status"] == ReconciliationStatus.GREEN:
            continue
        
        vb = ds["variance_breakdown"]
        
        if abs(vb.get("processor_only", 0)) > 0.01:
            exception_rows.append({
                "date": target_day,
                "processor": ds["processor"],
                "reason_code": ReasonCode.PROCESSOR_ONLY,
                "amount": vb["processor_only"],
                "direction": "processor_only",
                "status": "needs_review",
            })
        
        if abs(vb.get("spi_only", 0)) > 0.01:
            exception_rows.append({
                "date": target_day,
                "processor": ds["processor"],
                "reason_code": ReasonCode.SPI_ONLY,
                "amount": vb["spi_only"],
                "direction": "spi_only",
                "status": "needs_review",
            })
        
        if abs(vb.get("unexplained", 0)) > 0.01 and ds["spi_data_present"] and ds["proc_data_present"]:
            exception_rows.append({
                "date": target_day,
                "processor": ds["processor"],
                "reason_code": ReasonCode.UNEXPLAINED,
                "amount": vb["unexplained"],
                "direction": "spi_only" if vb["unexplained"] > 0 else "processor_only",
                "status": "needs_review",
            })
        
        # If no specific exceptions but still not green, add a data_missing exception
        if not exception_rows or all(e["processor"] != ds["processor"] for e in exception_rows):
            if ds["top_reason_code"] == ReasonCode.DATA_MISSING:
                exception_rows.append({
                    "date": target_day,
                    "processor": ds["processor"],
                    "reason_code": ReasonCode.DATA_MISSING,
                    "amount": 0.0,
                    "direction": "mismatch",
                    "status": "needs_review",
                })
    
    exceptions_df = pd.DataFrame(exception_rows) if exception_rows else pd.DataFrame(
        columns=["date", "processor", "reason_code", "amount", "direction", "status"]
    )

    # =========================================================================
    # Build Meta
    # =========================================================================
    green_count = sum(1 for ds in daily_statuses if ds["status"] == ReconciliationStatus.GREEN)
    yellow_count = sum(1 for ds in daily_statuses if ds["status"] == ReconciliationStatus.YELLOW)
    red_count = sum(1 for ds in daily_statuses if ds["status"] == ReconciliationStatus.RED)
    
    meta = {
        "entity_id": entity_id,
        "entity": ent.name,
        "target_day": str(target_day),
        "processor_files": proc_file_map,
        "crm_files": [str(p) for p in crm_picked],
        "daily_statuses": daily_statuses,
        "summary": {
            "total_processors": len(daily_statuses),
            "green_count": green_count,
            "yellow_count": yellow_count,
            "red_count": red_count,
            "total_variance": sum(ds["variance_amount"] for ds in daily_statuses),
            "total_exceptions": len(exception_rows),
        },
    }
    
    return summary_df, exceptions_df, meta


# =============================================================================
# Status Helpers
# =============================================================================

def output_filename(entity_id: str, target_day: date, super_recon: bool = False, month: Optional[str] = None) -> str:
    if super_recon:
        m = month or target_day.strftime("%Y-%m")
        return f"merchant_recon_{entity_id}_super_{m}.xlsx"
    return f"merchant_recon_{entity_id}_{target_day.isoformat()}.xlsx"


def status_from_output_dir(settings: ReconSettings) -> Dict:
    out_dir = Path(settings.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    results = {}
    
    for eid, ent in settings.entities.items():
        last_daily = None
        last_super = None
        file_count = 0
        
        for p in out_dir.glob(f"merchant_recon_{eid}_*.xlsx"):
            file_count += 1
            m = re.search(r"(\d{4}-\d{2}-\d{2})", p.name)
            if m:
                d = m.group(1)
                if last_daily is None or d > last_daily:
                    last_daily = d
        
        for p in out_dir.glob(f"merchant_recon_{eid}_super_*.xlsx"):
            m = re.search(r"(\d{4}-\d{2})", p.name)
            if m:
                d = m.group(1)
                if last_super is None or d > last_super:
                    last_super = d
        
        results[eid] = {
            "name": ent.name,
            "last_daily": last_daily,
            "last_super": last_super,
            "file_count": file_count,
        }
    
    return results


def already_ran(settings: ReconSettings, entity_id: str, target_day: date, super_recon: bool = False, month: Optional[str] = None) -> bool:
    out_dir = Path(settings.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = output_filename(entity_id, target_day, super_recon=super_recon, month=month)
    return (out_dir / name).exists()