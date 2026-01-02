from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional

# NOTE:
# - All paths should be absolute on the user's machine.
# - You can override ANY value with environment variables if you prefer.
#
# Suggested env overrides:
#   RECON_INPUT_ROOT
#   RECON_OUTPUT_DIR
#   RECON_AUTO_ENABLED   (1/0)
#   RECON_AUTO_TIME_ET   (HH:MM, e.g. 02:30)
#   RECON_LOOKBACK_BDAYS (int)
#   RECON_PORT           (default 8000)

@dataclass(frozen=True)
class EntityConfig:
    """Configuration for one entity's Merchant Reconciliation inputs."""
    id: str
    name: str

    # Folder names under the entity root input path
    crm_folder: str = "HG NAV Reports"
    processor_folders: List[str] = field(default_factory=lambda: ["Braintree", "Stripe", "NMI"])

    # Optional: If NMI has multiple subfolders, list them here (relative to the NMI folder).
    # If empty, engine will just walk everything under the folder recursively.
    nmi_subfolders: List[str] = field(default_factory=list)

@dataclass(frozen=True)
class ReconSettings:
    # Root folder that contains entity folders like: <root>\Helpgrid\...
    input_root: str = os.environ.get("RECON_INPUT_ROOT", r"C:\Users\bwimm\OneDrive\Documents\Yomali\Merchant Reconciliation")

    # Output folder for daily + super recon exports (xlsx).
    output_dir: str = os.environ.get("RECON_OUTPUT_DIR", r"C:\Users\bwimm\OneDrive\Documents\Yomali\Merchant Reconciliation\_output")

    # Auto-run
    auto_enabled: bool = os.environ.get("RECON_AUTO_ENABLED", "1") == "1"
    auto_time_et: str = os.environ.get("RECON_AUTO_TIME_ET", "02:30")  # Eastern time
    lookback_business_days: int = int(os.environ.get("RECON_LOOKBACK_BDAYS", "3"))

    # Matching tolerances (daily totals)
    amount_tolerance: float = float(os.environ.get("RECON_AMOUNT_TOL", "1.00"))  # dollars
    # For daily totals, date window isn't used much (we reconcile by day)
    # but we keep it for optional matching flexibility
    date_window_days: int = int(os.environ.get("RECON_DATE_WINDOW", "0"))

    # Entities (start with Helpgrid only)
    entities: Dict[str, EntityConfig] = field(default_factory=lambda: {
        "helpgrid": EntityConfig(
            id="helpgrid",
            name="Helpgrid",
            crm_folder="HG NAV Reports",
            processor_folders=["Braintree", "Stripe", "NMI"],
            nmi_subfolders=[],
        )
    })

DEFAULT_SETTINGS = ReconSettings()
