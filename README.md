# Yomali Live Demo (Dashboard + Upload API)

This repo is a **client-testable** demo:
- React dashboard (web/) with a **per-package** run (Helpgrid vs MaxWeb)
- FastAPI backend (api/) that accepts file uploads and returns engine JSON + downloadable reports.

## Run backend (API)
```bash
cd api
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

## Run frontend (Web)
```bash
cd web
npm install
npm run dev
```

Open the URL shown (typically http://localhost:5173).

## Using the demo
1. Choose Package: Helpgrid or MaxWeb
2. Upload Merchant / ERP / Bank files (any Excel/CSV for now)
3. Click "Run Reconciliation"
4. Dashboard will load the generated engine JSON and show a demo report list.

## Plug in the real engines
Replace the `run_recon_package(...)` function in `api/app.py` to:
- read uploaded files from `api/runs/<run_id>/uploads/...`
- execute your real recon logic
- write:
  - `api/runs/<run_id>/engine/dashboard_data.json`
  - `api/runs/<run_id>/engine/dev_queue.json`
  - `api/runs/<run_id>/reports/*`

## Sharing with client
Use ngrok to expose ports 5173 (web) and 8000 (api).
