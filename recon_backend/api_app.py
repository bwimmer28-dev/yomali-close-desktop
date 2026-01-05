from __future__ import annotations

import asyncio
import io
import json
from datetime import date, datetime, time
from pathlib import Path
from typing import Dict, List, Optional

import pytz
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from .settings import DEFAULT_SETTINGS, ReconSettings
from .engine import (
    reconcile_daily,
    business_days_lookback,
    already_ran,
    status_from_output_dir,
    output_filename,
)
from .outputs import write_recon_xlsx


app = FastAPI(title="Yomali Recon API", version="1.0")

# ADD CORS MIDDLEWARE - Critical for Electron app communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_settings: ReconSettings = DEFAULT_SETTINGS

# In-memory token store for downloads
_downloads: Dict[str, bytes] = {}

# Exception storage file
EXCEPTIONS_FILE = Path(_settings.output_dir) / "exceptions.json"


# ============================================================================
# Exception Models
# ============================================================================

class ReconException(BaseModel):
    id: str
    entity_id: str
    date: str
    period: str
    processor: str
    reason_code: str
    amount: float
    direction: str  # "spi_only", "processor_only", "mismatch"
    item_count: int = 1
    resolution_status: str = "needs_review"  # needs_review, in_progress, resolved, approved_variance
    resolved_by: Optional[str] = None
    resolved_at: Optional[str] = None
    notes: Optional[str] = None


class ExceptionUpdate(BaseModel):
    resolution_status: Optional[str] = None
    notes: Optional[str] = None
    resolved_by: Optional[str] = None


# ============================================================================
# Exception Storage Functions
# ============================================================================

def load_exceptions() -> List[ReconException]:
    """Load exceptions from JSON file."""
    if not EXCEPTIONS_FILE.exists():
        return []
    try:
        with open(EXCEPTIONS_FILE, "r") as f:
            data = json.load(f)
        return [ReconException(**item) for item in data]
    except Exception:
        return []


def save_exceptions(exceptions: List[ReconException]):
    """Save exceptions to JSON file."""
    EXCEPTIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(EXCEPTIONS_FILE, "w") as f:
        json.dump([exc.dict() for exc in exceptions], f, indent=2)


def add_exceptions_from_recon(entity_id: str, exceptions_df, target_day: date):
    """Add new exceptions from a reconciliation run.
    
    Stores exceptions by reason code (not individual transactions).
    Each exception represents a variance bucket for a processor/date/reason combination.
    """
    existing = load_exceptions()
    existing_ids = {e.id for e in existing}
    
    new_exceptions = []
    for idx, row in exceptions_df.iterrows():
        processor = str(row.get("processor", "Unknown")).strip()
        reason_code = str(row.get("reason_code", "unexplained")).strip()
        date_str = str(row.get("date", target_day))
        amount = float(row.get("amount", 0))
        direction = str(row.get("direction", "mismatch"))
        
        # Create unique ID for each processor/date/reason combination
        exc_id = f"{entity_id}_{processor}_{date_str}_{reason_code}".replace(" ", "_")
        
        # Skip if this exact exception already exists
        if exc_id in existing_ids:
            continue
        
        period = date_str[:7] if date_str else target_day.strftime("%Y-%m")
        
        exc = ReconException(
            id=exc_id,
            entity_id=entity_id,
            date=date_str,
            period=period,
            processor=processor,
            reason_code=reason_code,
            amount=amount,
            direction=direction,
            item_count=1,
            resolution_status="needs_review",
            notes="",
        )
        new_exceptions.append(exc)
        existing_ids.add(exc_id)
    
    if new_exceptions:
        all_exceptions = existing + new_exceptions
        save_exceptions(all_exceptions)
        print(f"[OK] Added {len(new_exceptions)} exceptions by reason code")
    
    return new_exceptions


# ============================================================================
# Helper Functions
# ============================================================================

def _parse_iso_date(s: str) -> date:
    try:
        return datetime.fromisoformat(s).date()
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid date: {s}")


def _et_now() -> datetime:
    tz = pytz.timezone("US/Eastern")
    return datetime.now(tz)


async def _auto_runner_loop():
    """Auto-run daily reconciliations for each entity."""
    tz = pytz.timezone("US/Eastern")
    while True:
        try:
            if not _settings.auto_enabled:
                await asyncio.sleep(30)
                continue

            now = _et_now()
            hh, mm = _settings.auto_time_et.split(":")
            target = tz.localize(datetime.combine(now.date(), time(int(hh), int(mm))))
            if now < target:
                await asyncio.sleep((target - now).total_seconds())
                continue

            target_day = now.date()
            days = business_days_lookback(target_day, _settings.lookback_business_days)
            for entity_id in _settings.entities.keys():
                for d in days:
                    if already_ran(_settings, entity_id, d):
                        continue
                    await run_daily(entity_id=entity_id, day=d, save_to_output=True)
            await asyncio.sleep(60 * 10)
        except Exception:
            await asyncio.sleep(60)


async def run_daily(entity_id: str, day: date, save_to_output: bool) -> Dict:
    try:
        summary_df, exceptions_df, meta = reconcile_daily(_settings, entity_id, day)
        bio = io.BytesIO()
        write_recon_xlsx(bio, summary_df, exceptions_df, meta)
        data = bio.getvalue()

        out_dir = Path(_settings.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        fname = output_filename(entity_id, day)
        
        if save_to_output:
            output_path = out_dir / fname
            output_path.write_bytes(data)
            print(f"[OK] Saved reconciliation to: {output_path}")
        
        # Add exceptions to tracking system
        add_exceptions_from_recon(entity_id, exceptions_df, day)
        print(f"[OK] Added {len(exceptions_df)} exceptions to tracking")

        token = f"{entity_id}-{day.isoformat()}-{len(data)}"
        _downloads[token] = data
        
        # Convert numpy types to Python native types for JSON serialization
        def convert_numpy(obj):
            import numpy as np
            if isinstance(obj, dict):
                return {k: convert_numpy(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_numpy(item) for item in obj]
            elif isinstance(obj, np.bool_):
                return bool(obj)
            elif isinstance(obj, (np.integer,)):
                return int(obj)
            elif isinstance(obj, (np.floating,)):
                return float(obj)
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            elif hasattr(obj, 'item'):  # Catch any other numpy scalar
                return obj.item()
            else:
                return obj
        
        clean_meta = convert_numpy(meta)
        clean_summary = convert_numpy(summary_df.to_dict(orient="records"))
        clean_exceptions = convert_numpy(exceptions_df.to_dict(orient="records"))
        
        return {
            "entity_id": entity_id,
            "date": day.isoformat(),
            "download_token": token,
            "output_file": str(out_dir / fname) if save_to_output else None,
            "counts": {
                "summary_rows": int(len(summary_df)),
                "exceptions_rows": int(len(exceptions_df)),
            },
            "summary": clean_summary,
            "exceptions": clean_exceptions,
            "meta": clean_meta,
        }
    except Exception as e:
        print(f"[ERROR] ERROR in run_daily: {e}")
        import traceback
        traceback.print_exc()
        raise

# ============================================================================
# API Endpoints
# ============================================================================

@app.on_event("startup")
async def _startup():
    asyncio.create_task(_auto_runner_loop())


@app.get("/health")
def health():
    """Simple health check endpoint"""
    return {"ok": True, "status": "running"}


class SettingsUpdate(BaseModel):
    output_dir: Optional[str] = None
    input_root: Optional[str] = None
    auto_enabled: Optional[bool] = None
    auto_time_et: Optional[str] = None
    lookback_business_days: Optional[int] = None


@app.get("/status")
def status():
    """Get status of all entities and settings"""
    return {
        "settings": {
            "auto_enabled": _settings.auto_enabled,
            "auto_time_et": _settings.auto_time_et,
            "lookback_business_days": _settings.lookback_business_days,
            "input_root": _settings.input_root,
            "output_dir": _settings.output_dir,
        },
        "entities": status_from_output_dir(_settings),
    }


@app.patch("/settings")
def update_settings(updates: SettingsUpdate):
    """Update backend settings"""
    global _settings, EXCEPTIONS_FILE
    
    # Create a dict of current settings
    current = {
        "entities": _settings.entities,
        "input_root": _settings.input_root,
        "output_dir": _settings.output_dir,
        "auto_enabled": _settings.auto_enabled,
        "auto_time_et": _settings.auto_time_et,
        "lookback_business_days": _settings.lookback_business_days,
    }
    
    # Apply updates
    if updates.output_dir is not None:
        current["output_dir"] = updates.output_dir
        # Update exceptions file path too
        EXCEPTIONS_FILE = Path(updates.output_dir) / "exceptions.json"
        print(f"[OK] Updated output_dir to: {updates.output_dir}")
    if updates.input_root is not None:
        current["input_root"] = updates.input_root
        print(f"[OK] Updated input_root to: {updates.input_root}")
    if updates.auto_enabled is not None:
        current["auto_enabled"] = updates.auto_enabled
    if updates.auto_time_et is not None:
        current["auto_time_et"] = updates.auto_time_et
    if updates.lookback_business_days is not None:
        current["lookback_business_days"] = updates.lookback_business_days
    
    # Create new settings object
    _settings = ReconSettings(**current)
    
    return {
        "ok": True,
        "settings": {
            "auto_enabled": _settings.auto_enabled,
            "auto_time_et": _settings.auto_time_et,
            "lookback_business_days": _settings.lookback_business_days,
            "input_root": _settings.input_root,
            "output_dir": _settings.output_dir,
        }
    }


@app.post("/run/daily")
async def run_daily_endpoint(entity_id: str, date_str: Optional[str] = None, save: bool = True, force: bool = False):
    """
    Run daily reconciliation for a specific entity and date.
    If date_str is not provided, uses today's date.
    If force=True, will re-run even if output file already exists.
    """
    if not date_str:
        day = _et_now().date()
    else:
        day = _parse_iso_date(date_str)
    
    # Skip if already ran (unless force=True)
    if already_ran(_settings, entity_id, day) and save and not force:
        out_dir = Path(_settings.output_dir)
        fname = output_filename(entity_id, day)
        return {
            "skipped": True,
            "reason": "output_exists",
            "entity_id": entity_id,
            "date": day.isoformat(),
            "output_file": str(out_dir / fname),
        }
    return await run_daily(entity_id=entity_id, day=day, save_to_output=save)


@app.post("/run/now")
async def run_now_endpoint(entity_id: str):
    """Run daily reconciliation for today"""
    day = _et_now().date()
    return await run_daily_endpoint(entity_id=entity_id, date_str=day.isoformat(), save=True)


@app.get("/download/{token}")
def download(token: str):
    """Download reconciliation Excel file by token"""
    if token not in _downloads:
        raise HTTPException(status_code=404, detail="Unknown token")
    data = _downloads[token]
    bio = io.BytesIO(data)
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="reconciliation.xlsx"'},
    )


# ============================================================================
# Exception Management Endpoints
# ============================================================================

@app.get("/exceptions")
def get_exceptions(entity_id: Optional[str] = None, period: Optional[str] = None, resolved: Optional[bool] = None):
    """Get all exceptions with optional filters."""
    exceptions = load_exceptions()
    
    if entity_id:
        exceptions = [e for e in exceptions if e.entity_id == entity_id]
    if period:
        exceptions = [e for e in exceptions if e.period == period]
    if resolved is not None:
        # Handle old 'resolved' boolean filter for backwards compatibility
        if resolved:
            exceptions = [e for e in exceptions if e.resolution_status in ["resolved", "approved_variance"]]
        else:
            exceptions = [e for e in exceptions if e.resolution_status in ["needs_review", "in_progress"]]
    
    return {
        "exceptions": [exc.dict() for exc in exceptions],
        "count": len(exceptions),
    }


# IMPORTANT: /stats route must come BEFORE /{exception_id} to avoid matching "stats" as an ID
@app.get("/exceptions/stats")
def get_exception_stats(entity_id: Optional[str] = None):
    """Get summary statistics for exceptions."""
    exceptions = load_exceptions()
    
    if entity_id:
        exceptions = [e for e in exceptions if e.entity_id == entity_id]
    
    total = len(exceptions)
    needs_review = len([e for e in exceptions if e.resolution_status == "needs_review"])
    in_progress = len([e for e in exceptions if e.resolution_status == "in_progress"])
    resolved = len([e for e in exceptions if e.resolution_status == "resolved"])
    approved = len([e for e in exceptions if e.resolution_status == "approved_variance"])
    
    # Open = needs_review + in_progress
    total_open_amount = sum(abs(e.amount) for e in exceptions 
                          if e.resolution_status in ["needs_review", "in_progress"])
    
    # By reason code
    by_reason_code = {}
    for exc in exceptions:
        rc = exc.reason_code
        if rc not in by_reason_code:
            by_reason_code[rc] = {"count": 0, "amount": 0.0}
        by_reason_code[rc]["count"] += 1
        by_reason_code[rc]["amount"] += abs(exc.amount)
    
    # By period
    by_period = {}
    for exc in exceptions:
        if exc.period not in by_period:
            by_period[exc.period] = {"total": 0, "open": 0, "resolved": 0}
        by_period[exc.period]["total"] += 1
        if exc.resolution_status in ["resolved", "approved_variance"]:
            by_period[exc.period]["resolved"] += 1
        else:
            by_period[exc.period]["open"] += 1
    
    return {
        "total_exceptions": total,
        "needs_review": needs_review,
        "in_progress": in_progress,
        "resolved": resolved,
        "approved_variance": approved,
        "total_open_amount": total_open_amount,
        "by_reason_code": by_reason_code,
        "by_period": by_period,
    }


@app.get("/exceptions/{exception_id}")
def get_exception(exception_id: str):
    """Get a single exception by ID."""
    exceptions = load_exceptions()
    for exc in exceptions:
        if exc.id == exception_id:
            return exc.dict()
    raise HTTPException(status_code=404, detail="Exception not found")


@app.patch("/exceptions/{exception_id}")
def update_exception(exception_id: str, update: ExceptionUpdate):
    """Update an exception's resolution status or notes."""
    print(f"🔍 Attempting to update exception: {exception_id}")
    exceptions = load_exceptions()
    print(f"📋 Loaded {len(exceptions)} total exceptions")
    
    found = False
    updated_exc = None
    
    for exc in exceptions:
        if exc.id == exception_id:
            print(f"[OK] Found matching exception!")
            if update.resolution_status is not None:
                exc.resolution_status = update.resolution_status
                if update.resolution_status in ["resolved", "approved_variance"]:
                    from datetime import datetime
                    exc.resolved_at = datetime.now().isoformat()
                    if update.resolved_by:
                        exc.resolved_by = update.resolved_by
            if update.notes is not None:
                exc.notes = update.notes
            found = True
            updated_exc = exc
            break
    
    if not found:
        print(f"[ERROR] Exception not found! Looking for: {exception_id}")
        raise HTTPException(status_code=404, detail="Exception not found")
    
    save_exceptions(exceptions)
    
    for exc in exceptions:
        if exc.id == exception_id:
            return exc.dict()


@app.delete("/exceptions/{exception_id}")
def delete_exception(exception_id: str):
    """Delete an exception."""
    exceptions = load_exceptions()
    original_count = len(exceptions)
    exceptions = [e for e in exceptions if e.id != exception_id]
    
    if len(exceptions) == original_count:
        raise HTTPException(status_code=404, detail="Exception not found")
    
    save_exceptions(exceptions)
    return {"deleted": True, "exception_id": exception_id}