"""Recon backend package.

This package is intentionally lightweight so it can be embedded in the Electron app
or run standalone via Uvicorn:

    python -m uvicorn recon_backend.api_app:app --host 127.0.0.1 --port 8000
"""
