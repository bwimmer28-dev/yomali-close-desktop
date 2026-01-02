from __future__ import annotations

import io
from typing import Any, Dict, Optional

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment
from openpyxl.utils.dataframe import dataframe_to_rows

CURRENCY_COLS = {"processor_total", "crm_total", "diff", "abs_diff", "value"}

def _autowidth(ws):
    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                v = str(cell.value) if cell.value is not None else ""
                max_len = max(max_len, len(v))
            except Exception:
                pass
        ws.column_dimensions[col_letter].width = min(max(10, max_len + 2), 55)

def _style_header(ws):
    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center")

def write_recon_xlsx(
    bio: io.BytesIO,
    summary_df: pd.DataFrame,
    exceptions_df: pd.DataFrame,
    meta: Optional[Dict[str, Any]] = None,
):
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "Summary"

    for r in dataframe_to_rows(summary_df, index=False, header=True):
        ws1.append(r)
    _style_header(ws1)

    # currency formatting for "value" where numeric + metric implies money
    if "value" in summary_df.columns:
        val_idx = list(summary_df.columns).index("value") + 1
        met_idx = list(summary_df.columns).index("metric") + 1 if "metric" in summary_df.columns else None
        for row in range(2, ws1.max_row + 1):
            metric = ws1.cell(row=row, column=met_idx).value if met_idx else ""
            if metric in ("processor_total", "crm_total") or (isinstance(metric, str) and "total" in metric):
                ws1.cell(row=row, column=val_idx).number_format = '"$"#,##0.00'

    _autowidth(ws1)

    ws2 = wb.create_sheet("Exceptions")
    for r in dataframe_to_rows(exceptions_df, index=False, header=True):
        ws2.append(r)
    _style_header(ws2)

    # Format currency columns
    cols = list(exceptions_df.columns)
    for col_name in cols:
        if col_name in CURRENCY_COLS:
            cidx = cols.index(col_name) + 1
            for row in range(2, ws2.max_row + 1):
                ws2.cell(row=row, column=cidx).number_format = '"$"#,##0.00'

    _autowidth(ws2)

    ws3 = wb.create_sheet("Meta")
    meta = meta or {}
    ws3.append(["key", "value"])
    for k, v in meta.items():
        ws3.append([k, str(v)])
    _style_header(ws3)
    _autowidth(ws3)

    wb.save(bio)
