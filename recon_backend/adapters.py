"""
Source Adapters

Each adapter converts a specific file format into NormalizedEvent objects.
This abstraction allows the reconciliation engine to be source-agnostic.

Supported sources:
- SPI (CRM vendor activity reports)
- Stripe (itemized balance/payout reports)
- Braintree (transaction exports)
- NMI (transaction reports - Chesapeake, Cliq, Esquire)
"""
from __future__ import annotations

import re
from abc import ABC, abstractmethod
from datetime import date, datetime
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

import pandas as pd

from .models import (
    NormalizedEvent, Source, EventType, DailyTotals
)


# =============================================================================
# Base Adapter
# =============================================================================

class BaseAdapter(ABC):
    """Base class for all source adapters"""
    
    source: Source
    
    @abstractmethod
    def can_handle(self, file_path: Path) -> bool:
        """Check if this adapter can handle the given file"""
        pass
    
    @abstractmethod
    def parse(self, file_path: Path, target_date: Optional[date] = None) -> List[NormalizedEvent]:
        """Parse file and return normalized events"""
        pass
    
    def _read_file(self, file_path: Path) -> pd.DataFrame:
        """Read file into DataFrame with error handling"""
        ext = file_path.suffix.lower()
        try:
            if ext in [".xlsx", ".xls"]:
                return pd.read_excel(file_path)
            elif ext == ".csv":
                # Try different encodings
                for encoding in ["utf-8", "latin-1", "cp1252"]:
                    try:
                        return pd.read_csv(file_path, encoding=encoding)
                    except UnicodeDecodeError:
                        continue
                return pd.read_csv(file_path, encoding="utf-8", errors="ignore")
            else:
                raise ValueError(f"Unsupported file type: {ext}")
        except pd.errors.EmptyDataError:
            print(f"WARNING: Empty file: {file_path}")
            return pd.DataFrame()
        except Exception as e:
            print(f"ERROR reading {file_path}: {e}")
            return pd.DataFrame()
    
    def _normalize_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Normalize column names to lowercase with underscores"""
        df = df.copy()
        df.columns = [
            re.sub(r"\s+", "_", str(c).strip().lower()) 
            for c in df.columns
        ]
        return df
    
    def _parse_date(self, value: Any) -> Optional[date]:
        """Parse various date formats"""
        if pd.isna(value):
            return None
        if isinstance(value, date):
            return value
        if isinstance(value, datetime):
            return value.date()
        try:
            return pd.to_datetime(value).date()
        except:
            return None
    
    def _parse_amount(self, value: Any) -> float:
        """Parse amount from various formats"""
        if pd.isna(value):
            return 0.0
        if isinstance(value, (int, float)):
            return float(value)
        # Handle string amounts
        s = str(value).strip().replace(",", "").replace("$", "")
        # Handle parentheses for negative
        if s.startswith("(") and s.endswith(")"):
            s = "-" + s[1:-1]
        try:
            return float(s)
        except:
            return 0.0


# =============================================================================
# SPI Adapter (CRM Vendor Activity)
# =============================================================================

class SPIAdapter(BaseAdapter):
    """
    Adapter for SPI/CRM vendor activity reports.
    
    Expected file pattern: balance_full_activity_report_vendors_*.csv
    
    SPI is the gross ledger truth - fee=0, net=gross.
    Maps SPI categories to event types:
    - customer payments → charge
    - refunds → refund (negative)
    - refund failures → refund_failure (positive)
    - corrections/voids → adjustment
    """
    
    source = Source.SPI
    
    # Column mappings (try multiple possible names)
    DATE_COLS = ["date", "transaction_date", "posting_date", "created_at"]
    AMOUNT_COLS = ["amount", "net", "total", "payment_amount"]
    TYPE_COLS = ["type", "transaction_type", "category", "action"]
    DESC_COLS = ["description", "memo", "notes", "reference"]
    MERCHANT_COLS = ["merchant", "vendor", "processor", "gateway"]
    ID_COLS = ["id", "transaction_id", "txn_id", "reference_id"]
    
    def can_handle(self, file_path: Path) -> bool:
        name = file_path.name.lower()
        return "vendors" in name or "spi" in name or "activity_report" in name
    
    def parse(self, file_path: Path, target_date: Optional[date] = None) -> List[NormalizedEvent]:
        df = self._read_file(file_path)
        if df.empty:
            return []
        
        df = self._normalize_columns(df)
        events = []
        
        # Find the right columns
        date_col = self._find_column(df, self.DATE_COLS)
        amount_col = self._find_column(df, self.AMOUNT_COLS)
        type_col = self._find_column(df, self.TYPE_COLS)
        desc_col = self._find_column(df, self.DESC_COLS)
        merchant_col = self._find_column(df, self.MERCHANT_COLS)
        id_col = self._find_column(df, self.ID_COLS)
        
        if not date_col or not amount_col:
            print(f"WARNING: SPI file missing required columns: {file_path}")
            return []
        
        for idx, row in df.iterrows():
            event_date = self._parse_date(row.get(date_col))
            if not event_date:
                continue
            
            # Filter by target date if specified
            if target_date and event_date != target_date:
                continue
            
            amount = self._parse_amount(row.get(amount_col, 0))
            event_type = self._map_spi_type(row.get(type_col, ""), amount)
            
            event = NormalizedEvent(
                source=Source.SPI,
                merchant=str(row.get(merchant_col, "Unknown")).strip(),
                event_type=event_type,
                event_id=str(row.get(id_col, f"spi_{idx}")),
                gross=amount,
                fee=0.0,  # SPI has no fees
                net=amount,
                event_ts=datetime.combine(event_date, datetime.min.time()),
                effective_date=event_date,
                status="succeeded",
                reference=str(row.get(desc_col, "")),
                description=str(row.get(desc_col, "")),
                raw_data=row.to_dict(),
            )
            events.append(event)
        
        return events
    
    def _find_column(self, df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
        """Find first matching column from candidates"""
        for col in candidates:
            if col in df.columns:
                return col
            # Try partial match
            for df_col in df.columns:
                if col in df_col:
                    return df_col
        return None
    
    def _map_spi_type(self, type_value: str, amount: float) -> EventType:
        """Map SPI transaction type to normalized EventType"""
        t = str(type_value).lower().strip()
        
        if "refund_failure" in t or "refund failure" in t:
            return EventType.REFUND_FAILURE
        if "refund" in t:
            return EventType.REFUND
        if "void" in t or "cancel" in t:
            return EventType.ADJUSTMENT
        if "adjustment" in t or "correction" in t:
            return EventType.ADJUSTMENT
        if "chargeback" in t or "dispute" in t:
            return EventType.DISPUTE
        if "payment" in t or "sale" in t or "charge" in t:
            return EventType.CHARGE
        
        # Default based on amount sign
        if amount >= 0:
            return EventType.CHARGE
        else:
            return EventType.REFUND


# =============================================================================
# Stripe Adapter
# =============================================================================

class StripeAdapter(BaseAdapter):
    """
    Adapter for Stripe itemized balance/payout reports.
    
    Stripe provides the strongest dataset with:
    - reporting_category for event type mapping
    - automatic_payout_id for cash formation proof
    - Detailed fee breakdown
    """
    
    source = Source.STRIPE
    
    def can_handle(self, file_path: Path) -> bool:
        name = file_path.name.lower()
        return "stripe" in name
    
    def parse(self, file_path: Path, target_date: Optional[date] = None) -> List[NormalizedEvent]:
        df = self._read_file(file_path)
        if df.empty:
            return []
        
        df = self._normalize_columns(df)
        events = []
        
        for idx, row in df.iterrows():
            # Try multiple date column names
            event_date = None
            for col in ["created", "created_utc", "effective_at", "date"]:
                if col in df.columns:
                    event_date = self._parse_date(row.get(col))
                    if event_date:
                        break
            
            if not event_date:
                continue
            
            if target_date and event_date != target_date:
                continue
            
            # Get amounts
            gross = self._parse_amount(row.get("gross", row.get("amount", 0)))
            fee = self._parse_amount(row.get("fee", 0))
            net = self._parse_amount(row.get("net", gross - fee))
            
            # Map reporting category to event type
            category = str(row.get("reporting_category", row.get("type", ""))).lower()
            event_type = self._map_stripe_category(category)
            
            # Get payout info
            payout_id = row.get("automatic_payout_id", row.get("payout_id", ""))
            
            event = NormalizedEvent(
                source=Source.STRIPE,
                merchant="Stripe",
                event_type=event_type,
                event_id=str(row.get("balance_transaction_id", row.get("id", f"stripe_{idx}"))),
                gross=gross,
                fee=fee,
                net=net,
                event_ts=datetime.combine(event_date, datetime.min.time()),
                effective_date=event_date,
                batch_or_payout_id=str(payout_id) if payout_id else None,
                status=str(row.get("status", "succeeded")),
                reference=str(row.get("description", row.get("customer_id", ""))),
                description=str(row.get("description", "")),
                raw_data=row.to_dict(),
            )
            events.append(event)
        
        return events
    
    def _map_stripe_category(self, category: str) -> EventType:
        """Map Stripe reporting_category to EventType"""
        category = category.lower()
        
        mapping = {
            "charge": EventType.CHARGE,
            "payment": EventType.CHARGE,
            "refund": EventType.REFUND,
            "refund_failure": EventType.REFUND_FAILURE,
            "dispute": EventType.DISPUTE,
            "dispute_reversal": EventType.DISPUTE_REVERSAL,
            "fee": EventType.FEE,
            "payout": EventType.PAYOUT,
            "adjustment": EventType.ADJUSTMENT,
            "risk_reserved_funds": EventType.RESERVE,
        }
        
        for key, value in mapping.items():
            if key in category:
                return value
        
        return EventType.ADJUSTMENT


# =============================================================================
# Braintree Adapter
# =============================================================================

class BraintreeAdapter(BaseAdapter):
    """
    Adapter for Braintree transaction exports.
    
    Only treats financially real statuses (settled) as included.
    Fees may not be present - handle as unknown until month-end.
    """
    
    source = Source.BRAINTREE
    
    def can_handle(self, file_path: Path) -> bool:
        name = file_path.name.lower()
        return "braintree" in name
    
    def parse(self, file_path: Path, target_date: Optional[date] = None) -> List[NormalizedEvent]:
        df = self._read_file(file_path)
        if df.empty:
            return []
        
        df = self._normalize_columns(df)
        events = []
        
        for idx, row in df.iterrows():
            # Check status - only include settled transactions
            status = str(row.get("status", "")).lower()
            if status not in ["settled", "settling", "submitted_for_settlement"]:
                continue
            
            # Get date
            event_date = None
            for col in ["settlement_date", "created_at", "date"]:
                if col in df.columns:
                    event_date = self._parse_date(row.get(col))
                    if event_date:
                        break
            
            if not event_date:
                continue
            
            if target_date and event_date != target_date:
                continue
            
            # Get amount
            amount = self._parse_amount(row.get("amount", 0))
            
            # Map transaction type
            txn_type = str(row.get("type", row.get("transaction_type", ""))).lower()
            event_type = self._map_braintree_type(txn_type, amount)
            
            # Adjust sign for refunds
            if event_type == EventType.REFUND and amount > 0:
                amount = -amount
            
            event = NormalizedEvent(
                source=Source.BRAINTREE,
                merchant="Braintree",
                event_type=event_type,
                event_id=str(row.get("transaction_id", row.get("id", f"bt_{idx}"))),
                gross=amount,
                fee=0.0,  # Braintree fees often not in transaction export
                net=amount,
                event_ts=datetime.combine(event_date, datetime.min.time()),
                effective_date=event_date,
                batch_or_payout_id=str(row.get("settlement_batch_id", "")),
                status=status,
                reference=str(row.get("order_id", row.get("customer_id", ""))),
                description=str(row.get("merchant_account_id", "")),
                raw_data=row.to_dict(),
            )
            events.append(event)
        
        return events
    
    def _map_braintree_type(self, txn_type: str, amount: float) -> EventType:
        """Map Braintree transaction type to EventType"""
        txn_type = txn_type.lower()
        
        if "credit" in txn_type or "refund" in txn_type:
            return EventType.REFUND
        if "sale" in txn_type or "charge" in txn_type:
            return EventType.CHARGE
        if "void" in txn_type:
            return EventType.ADJUSTMENT
        
        # Default based on amount
        return EventType.CHARGE if amount >= 0 else EventType.REFUND


# =============================================================================
# NMI Adapter
# =============================================================================

class NMIAdapter(BaseAdapter):
    """
    Adapter for NMI transaction reports.
    
    Supports multiple NMI merchants: Chesapeake, Cliq, Esquire.
    Filters to action_success == 1, excludes auth-only.
    Uses action_batch_id for cash formation proof.
    """
    
    source = Source.NMI_CHESAPEAKE  # Will be overridden based on file
    
    def __init__(self, merchant_type: str = "chesapeake"):
        self.merchant_type = merchant_type.lower()
        if "cliq" in self.merchant_type:
            self.source = Source.NMI_CLIQ
        elif "esquire" in self.merchant_type:
            self.source = Source.NMI_ESQUIRE
        else:
            self.source = Source.NMI_CHESAPEAKE
    
    def can_handle(self, file_path: Path) -> bool:
        name = file_path.name.lower()
        return "nmi" in name and self.merchant_type in name
    
    def parse(self, file_path: Path, target_date: Optional[date] = None) -> List[NormalizedEvent]:
        df = self._read_file(file_path)
        if df.empty:
            return []
        
        df = self._normalize_columns(df)
        events = []
        
        for idx, row in df.iterrows():
            # Filter: only successful actions
            success = row.get("action_success", row.get("success", 1))
            if str(success) not in ["1", "True", "true", "SUCCESS"]:
                continue
            
            # Filter: exclude auth-only
            action_type = str(row.get("action_type", row.get("type", ""))).lower()
            if action_type in ["auth", "authorize", "validate"]:
                continue
            
            # Get date
            event_date = None
            for col in ["settle_date", "transaction_date", "date", "created"]:
                if col in df.columns:
                    event_date = self._parse_date(row.get(col))
                    if event_date:
                        break
            
            if not event_date:
                continue
            
            if target_date and event_date != target_date:
                continue
            
            # Get amount
            amount = self._parse_amount(row.get("amount", row.get("settle_amount", 0)))
            
            # Map action type
            event_type = self._map_nmi_type(action_type, amount)
            
            # Adjust sign for refunds
            if event_type == EventType.REFUND and amount > 0:
                amount = -amount
            
            merchant_name = f"NMI_{self.merchant_type.title()}"
            
            event = NormalizedEvent(
                source=self.source,
                merchant=merchant_name,
                event_type=event_type,
                event_id=str(row.get("transaction_id", row.get("transactionid", f"nmi_{idx}"))),
                gross=amount,
                fee=0.0,
                net=amount,
                event_ts=datetime.combine(event_date, datetime.min.time()),
                effective_date=event_date,
                batch_or_payout_id=str(row.get("action_batch_id", row.get("batch_id", ""))),
                status="settled",
                reference=str(row.get("order_id", row.get("orderid", ""))),
                description=str(row.get("merchant_defined_field_1", "")),
                raw_data=row.to_dict(),
            )
            events.append(event)
        
        return events
    
    def _map_nmi_type(self, action_type: str, amount: float) -> EventType:
        """Map NMI action type to EventType"""
        action_type = action_type.lower()
        
        if "refund" in action_type or "credit" in action_type:
            return EventType.REFUND
        if "settle" in action_type or "capture" in action_type or "sale" in action_type:
            return EventType.CHARGE
        if "void" in action_type:
            return EventType.ADJUSTMENT
        
        return EventType.CHARGE if amount >= 0 else EventType.REFUND


# =============================================================================
# Adapter Registry
# =============================================================================

class AdapterRegistry:
    """Registry of all available adapters"""
    
    def __init__(self):
        self.adapters: List[BaseAdapter] = [
            SPIAdapter(),
            StripeAdapter(),
            BraintreeAdapter(),
            NMIAdapter("chesapeake"),
            NMIAdapter("cliq"),
            NMIAdapter("esquire"),
        ]
    
    def get_adapter(self, file_path: Path) -> Optional[BaseAdapter]:
        """Find the appropriate adapter for a file"""
        for adapter in self.adapters:
            if adapter.can_handle(file_path):
                return adapter
        return None
    
    def parse_file(self, file_path: Path, target_date: Optional[date] = None) -> List[NormalizedEvent]:
        """Parse a file using the appropriate adapter"""
        adapter = self.get_adapter(file_path)
        if not adapter:
            print(f"WARNING: No adapter found for {file_path}")
            return []
        
        return adapter.parse(file_path, target_date)
    
    def parse_files(self, file_paths: List[Path], target_date: Optional[date] = None) -> List[NormalizedEvent]:
        """Parse multiple files and return all events"""
        all_events = []
        for path in file_paths:
            events = self.parse_file(path, target_date)
            all_events.extend(events)
        return all_events


# =============================================================================
# Aggregation Helpers
# =============================================================================

def aggregate_events_to_totals(
    events: List[NormalizedEvent], 
    target_date: date,
    source: Source,
    processor_name: str
) -> DailyTotals:
    """Aggregate normalized events into daily totals"""
    
    totals = DailyTotals(
        date=target_date,
        source=source,
        processor=processor_name,
    )
    
    for event in events:
        if event.effective_date != target_date:
            continue
        
        if event.event_type == EventType.CHARGE:
            totals.charge_count += 1
            totals.charge_gross += event.gross
        elif event.event_type == EventType.REFUND:
            totals.refund_count += 1
            totals.refund_gross += event.gross  # Should be negative
        elif event.event_type == EventType.REFUND_FAILURE:
            totals.refund_failure_count += 1
            totals.refund_failure_gross += event.gross
        elif event.event_type == EventType.FEE:
            totals.fee_count += 1
            totals.fee_amount += event.gross  # Should be negative
        elif event.event_type == EventType.DISPUTE:
            totals.dispute_count += 1
            totals.dispute_gross += event.gross
        elif event.event_type == EventType.ADJUSTMENT:
            totals.adjustment_count += 1
            totals.adjustment_gross += event.gross
        elif event.event_type == EventType.PAYOUT:
            totals.payout_count += 1
            totals.payout_gross += event.gross
    
    return totals
