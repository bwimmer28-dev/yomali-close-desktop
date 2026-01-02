from __future__ import annotations

import argparse
from datetime import date, datetime
from pathlib import Path

import pytz

from .settings import DEFAULT_SETTINGS
from .engine import reconcile_daily, business_days_lookback, already_ran, output_filename
from .outputs import write_recon_xlsx
import io


def et_today() -> date:
    tz = pytz.timezone("US/Eastern")
    return datetime.now(tz).date()


def run_auto():
    s = DEFAULT_SETTINGS
    target_day = et_today()
    days = business_days_lookback(target_day, s.lookback_business_days)

    out_dir = Path(s.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for entity_id in s.entities.keys():
        for d in days:
            if already_ran(s, entity_id, d):
                continue

            summary_df, exceptions_df, meta = reconcile_daily(s, entity_id, d)
            bio = io.BytesIO()
            write_recon_xlsx(bio, summary_df, exceptions_df, meta)

            fname = output_filename(entity_id, d)
            (out_dir / fname).write_bytes(bio.getvalue())
            print(f"Wrote: {out_dir / fname}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["auto"], default="auto")
    args = ap.parse_args()

    if args.mode == "auto":
        run_auto()


if __name__ == "__main__":
    main()
