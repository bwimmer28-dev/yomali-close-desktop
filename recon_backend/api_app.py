from __future__ import annotations

import asyncio
import io
from datetime import date, datetime, time
from pathlib import Path
from typing import Dict, Optional

import pytz
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from .settings import DEFAULT_SETTINGS, ReconSettings
from .engine import (
    reconcile_daily,
    business_days_lookback,
    already_ran,
    status_from_output_dir,
    output_filename,
)
from .outputs import write_recon_xlsx


# NOTE: Uvicorn import path:
#   python -m uvicorn recon_backend.api_app:app --host 127.0.0.1 --port 8000

app = FastAPI(title="Yomali Recon API", version="1.0")

_settings: ReconSettings = DEFAULT_SETTINGS

# In-memory token store for downloads from manual endpoints (safe enough for local app)
_downloads: Dict[str, bytes] = {}


def _parse_iso_date(s: str) -> date:
    try:
        return datetime.fromisoformat(s).date()
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid date: {s} (expected YYYY-MM-DD)")

def _parse_month(s: str) -> str:
    # YYYY-MM
    if not isinstance(s, str) or len(s) != 7 or s[4] != "-":
        raise HTTPException(status_code=400, detail=f"Invalid month: {s} (expected YYYY-MM)")
    return s

def _et_now() -> datetime:
    tz = pytz.timezone("US/Eastern")
    return datetime.now(tz)

def _next_run_dt_et(run_hhmm: str) -> datetime:
    tz = pytz.timezone("US/Eastern")
    now = _et_now()
    hh, mm = run_hhmm.split(":")
    target = tz.localize(datetime.combine(now.date(), time(int(hh), int(mm))))
    if target <= now:
        from datetime import timedelta
        target = target + timedelta(days=1)
    return target


async def _auto_runner_loop():
    """Auto-run daily reconciliations for each entity.
    - Runs at settings.auto_time_et in Eastern
    - Looks back settings.lookback_business_days
    - Skips if output file already exists for day/entity
    """
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
                # sleep until target
                await asyncio.sleep((target - now).total_seconds())
                continue

            # run window is now; compute lookback days from "today" ET
            target_day = now.date()
            days = business_days_lookback(target_day, _settings.lookback_business_days)
            for entity_id in _settings.entities.keys():
                for d in days:
                    if already_ran(_settings, entity_id, d):
                        continue
                    # run and save
                    await run_daily(entity_id=entity_id, day=d, save_to_output=True)
            # sleep a bit to avoid rerunning immediately
            await asyncio.sleep(60 * 10)
        except Exception:
            # keep loop alive
            await asyncio.sleep(60)

async def run_daily(entity_id: str, day: date, save_to_output: bool) -> Dict:
    summary_df, exceptions_df, meta = reconcile_daily(_settings, entity_id, day)
    bio = io.BytesIO()
    write_recon_xlsx(bio, summary_df, exceptions_df, meta)
    data = bio.getvalue()

    # Save to output dir if requested
    out_dir = Path(_settings.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = output_filename(entity_id, day)
    if save_to_output:
        (out_dir / fname).write_bytes(data)

    token = f"{entity_id}-{day.isoformat()}-{len(data)}"
    _downloads[token] = data
    return {
        "entity_id": entity_id,
        "date": day.isoformat(),
        "download_token": token,
        "output_file": str(out_dir / fname) if save_to_output else None,
        "counts": {
            "summary_rows": int(len(summary_df)),
            "exceptions_rows": int(len(exceptions_df)),
        },
        "summary": summary_df.to_dict(orient="records"),
        "exceptions": exceptions_df.to_dict(orient="records"),
        "meta": meta,
    }

@app.on_event("startup")
async def _startup():
    # Start auto runner
    asyncio.create_task(_auto_runner_loop())

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/status")
def status():
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

@app.post("/run/daily")
async def run_daily_endpoint(entity_id: str, date_str: str, save: bool = True):
    day = _parse_iso_date(date_str)
    if already_ran(_settings, entity_id, day) and save:
        # Don't rerun; return "exists"
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
    day = _et_now().date()
    return await run_daily_endpoint(entity_id=entity_id, date_str=day.isoformat(), save=True)

@app.get("/download/{token}")
def download(token: str):
    if token not in _downloads:
        raise HTTPException(status_code=404, detail="Unknown token")
    data = _downloads[token]
    bio = io.BytesIO(data)
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="reconciliation.xlsx"'},
    )
