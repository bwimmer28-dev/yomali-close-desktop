from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
from datetime import datetime
import shutil
import json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE = Path(__file__).parent
RUNS = BASE / "runs"
RUNS.mkdir(exist_ok=True)

def run_recon_package(package: str, run_dir: Path, settlement_lag_days: int, lookback_days: int):
    """
    Hook your real engines here.
    Inputs:
      run_dir/uploads/merchant/*
      run_dir/uploads/erp/*
      run_dir/uploads/bank/*
    Outputs expected:
      run_dir/engine/dashboard_data.json
      run_dir/engine/dev_queue.json
      run_dir/reports/<files...>
    """
    engine_dir = run_dir / "engine"
    reports_dir = run_dir / "reports"
    engine_dir.mkdir(exist_ok=True)
    reports_dir.mkdir(exist_ok=True)

    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    dashboard = {
        "meta": {"period": "2025-10", "generated_at": now, "entities": [package]},
        "tasks": [
            {
                "id": f"m-{package}-run",
                "entity": package.title(),
                "category": "Merchant",
                "name": f"{package.title()} Merchant Reconciliation",
                "assignee": "Accounting",
                "dueDate": "2025-11-05",
                "status": "IN_PROGRESS",
                "exceptionsOpen": 2,
                "assignedTeam": "Dev Team",
                "lastRun": now,
            }
        ],
    }

    devq = {
        "meta": {"period": "2025-10", "generated_at": now},
        "issues": [
            {
                "exception_id": f"ex-{package}-001",
                "entity": package.title(),
                "period": "2025-10",
                "template": "merchant_gateway",
                "issue_code": "AMOUNT_MISMATCH",
                "severity": "High",
                "assigned_team": "Dev Team",
                "status": "New",
                "message": "Settlement differs from ERP clearing. (demo)",
                "amount": 125.43,
                "reference": "Batch 88421",
                "notes_accounting": "Please review fee mapping.",
                "notes_dev": "",
                "updated_at": now,
            }
        ],
    }

    (engine_dir / "dashboard_data.json").write_text(json.dumps(dashboard, indent=2), encoding="utf-8")
    (engine_dir / "dev_queue.json").write_text(json.dumps(devq, indent=2), encoding="utf-8")

    (reports_dir / f"{package}_merchant_report_demo.json").write_text(
        json.dumps(
            {
                "package": package,
                "generated_at": now,
                "lookback_days": lookback_days,
                "settlement_lag_days": settlement_lag_days,
                "notes": "Demo report. Replace with GAAP-compliant report output.",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

@app.post("/api/merchant/run")
async def merchant_run(
    package: str = Form(...),  # helpgrid|maxweb
    settlement_lag_days: int = Form(2),
    lookback_days: int = Form(21),
    merchant_files: list[UploadFile] = File(default=[]),
    erp_files: list[UploadFile] = File(default=[]),
    bank_files: list[UploadFile] = File(default=[]),
):
    run_id = datetime.utcnow().strftime("%Y%m%d_%H%M%S") + f"_{package}"
    run_dir = RUNS / run_id
    up_merchant = run_dir / "uploads" / "merchant"
    up_erp = run_dir / "uploads" / "erp"
    up_bank = run_dir / "uploads" / "bank"
    for p in [up_merchant, up_erp, up_bank]:
        p.mkdir(parents=True, exist_ok=True)

    async def save_files(files: list[UploadFile], dest: Path):
        for f in files:
            target = dest / f.filename
            with target.open("wb") as out:
                shutil.copyfileobj(f.file, out)

    await save_files(merchant_files, up_merchant)
    await save_files(erp_files, up_erp)
    await save_files(bank_files, up_bank)

    run_recon_package(package, run_dir, settlement_lag_days, lookback_days)

    return JSONResponse(
        {
            "run_id": run_id,
            "engine": {
                "dashboard_data": f"/api/runs/{run_id}/engine/dashboard_data.json",
                "dev_queue": f"/api/runs/{run_id}/engine/dev_queue.json",
            },
            "reports": f"/api/runs/{run_id}/reports",
        }
    )

@app.get("/api/runs/{run_id}/engine/{filename}")
def get_engine_file(run_id: str, filename: str):
    path = RUNS / run_id / "engine" / filename
    if not path.exists():
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(str(path), filename=filename)

@app.get("/api/runs/{run_id}/reports")
def list_reports(run_id: str):
    reports_dir = RUNS / run_id / "reports"
    if not reports_dir.exists():
        return []
    return [p.name for p in reports_dir.iterdir() if p.is_file()]

@app.get("/api/runs/{run_id}/reports/{filename}")
def download_report(run_id: str, filename: str):
    path = RUNS / run_id / "reports" / filename
    if not path.exists():
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(str(path), filename=filename)
