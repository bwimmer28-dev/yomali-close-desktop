from dataclasses import dataclass
from typing import Dict, List

@dataclass
class EntityConfig:
    name: str
    processor_folders: List[str]  # Folders containing processor data
    crm_folder: str  # Folder containing CRM data

@dataclass
class ReconSettings:
    input_root: str  # Root folder where all data lives
    output_dir: str  # Where to save reconciliation outputs
    entities: Dict[str, EntityConfig]
    amount_tolerance: float = 0.01
    auto_enabled: bool = True
    auto_time_et: str = "02:30"
    lookback_business_days: int = 3


# Based on your Google Drive structure
DEFAULT_SETTINGS = ReconSettings(
    # This should point to: Google Drive/Shared drives/Yomali Bank Merchant Data Storage/
    input_root="G:\\Shared drives\\Yomali Bank Merchant Data Storage",
    
    # Where reconciliation outputs are saved - UPDATED to TestA
    output_dir="C:\\Users\\bwimm\\OneDrive\\Documents\\TestA",
    
    entities={
        # Helpgrid entity configuration
        "helpgrid": EntityConfig(
            name="Helpgrid Inc",
            processor_folders=[
                "Braintree Reports",
                "NMI Chesapeak Reports", 
                "NMI Cliq Reports",
                "NMI Esquire Reports",
                "Stripe Reports",
            ],
            crm_folder="HG NAV Reports",
        ),
        
        # You can add more entities here as needed
        # "clickcrm": EntityConfig(
        #     name="ClickCRM",
        #     processor_folders=["Stripe Reports", "PayPal Reports"],
        #     crm_folder="ClickCRM NAV Reports",
        # ),
    },
    
    amount_tolerance=0.01,  # $0.01 tolerance for matching
    auto_enabled=True,
    auto_time_et="02:30",  # 2:30 AM ET
    lookback_business_days=3,
)