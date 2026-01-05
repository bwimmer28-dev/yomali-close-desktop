"""
Reconciliation Data Models

This module defines the core data structures for the two-proof reconciliation model:
- Proof A: Gross Activity (SPI ↔ Processor Events)
- Proof B: Cash Formation (Processor Events ↔ Payout/Batch)

Key concepts:
- All source data is normalized into NormalizedEvent objects
- Daily reconciliation produces DailyStatus with traffic-light classification
- Exceptions are bucketed by reason codes, not individual transactions
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Dict, List, Optional, Any
import json


# =============================================================================
# Enums
# =============================================================================

class Source(str, Enum):
    """Data source identifiers"""
    SPI = "spi"
    STRIPE = "stripe"
    BRAINTREE = "braintree"
    NMI_CHESAPEAKE = "nmi_chesapeake"
    NMI_CLIQ = "nmi_cliq"
    NMI_ESQUIRE = "nmi_esquire"
    BANK = "bank"


class EventType(str, Enum):
    """Normalized event types across all sources"""
    CHARGE = "charge"           # Sale/payment
    REFUND = "refund"           # Refund (negative)
    REFUND_FAILURE = "refund_failure"  # Failed refund reversal (positive)
    FEE = "fee"                 # Processing fee
    DISPUTE = "dispute"         # Chargeback/dispute
    DISPUTE_REVERSAL = "dispute_reversal"  # Dispute won
    ADJUSTMENT = "adjustment"   # Manual adjustment
    PAYOUT = "payout"           # Payout to bank
    BATCH = "batch"             # Settlement batch
    RESERVE = "reserve"         # Risk reserve


class ReconciliationStatus(str, Enum):
    """Traffic light status for daily reconciliation"""
    GREEN = "green"   # Within tolerance, no action needed
    YELLOW = "yellow" # Variance explainable (timing, known issues)
    RED = "red"       # Unexplained variance, needs investigation


class ReasonCode(str, Enum):
    """Exception reason codes for variance classification"""
    WITHIN_TOLERANCE = "within_tolerance"
    TIMING_CUTOFF = "timing_cutoff"           # Event in SPI day D, processor day D+1
    PAYOUT_IN_TRANSIT = "payout_in_transit"   # Payout not yet in bank
    REFUND_FAILURE = "refund_failure"         # SPI refund failure
    VOID_VS_REFUND = "void_vs_refund"         # SPI void but processor refund
    AUTH_NOT_CAPTURED = "auth_not_captured"   # Auth logged, no settle yet
    PROCESSOR_ONLY = "processor_only"         # In processor, not in SPI
    SPI_ONLY = "spi_only"                     # In SPI, not in processor
    ADJUSTMENT_NO_SPI = "adjustment_no_spi"   # Processor adjustment, no SPI
    DISPUTE_LIFECYCLE = "dispute_lifecycle"   # Dispute timing differences
    FEE_VARIANCE = "fee_variance"             # Fee calculation difference
    DATA_MISSING = "data_missing"             # Missing source file
    UNEXPLAINED = "unexplained"               # Needs investigation


class ResolutionStatus(str, Enum):
    """Resolution status for exceptions"""
    NEEDS_REVIEW = "needs_review"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    APPROVED_VARIANCE = "approved_variance"  # Approved as acceptable


# =============================================================================
# Core Data Models
# =============================================================================

@dataclass
class NormalizedEvent:
    """
    Normalized event from any source (SPI, Stripe, Braintree, NMI, Bank).
    All adapters convert their source format into this common schema.
    """
    source: Source
    merchant: str                    # HGS, Chesapeake, Cliq, Esquire, etc.
    event_type: EventType
    event_id: str                    # Unique ID (charge id, txn id, spi id)
    gross: float                     # Positive for charge, negative for refund
    fee: float = 0.0                 # Fee amount (0 for SPI)
    net: float = 0.0                 # gross - fee
    event_ts: Optional[datetime] = None  # Event timestamp
    effective_date: Optional[date] = None  # Payout/batch effective date
    batch_or_payout_id: Optional[str] = None  # Payout ID, batch ID
    status: str = "succeeded"        # succeeded/settled/pending/failed
    reference: str = ""              # Invoice/customer/order for matching
    description: str = ""            # Human-readable description
    raw_data: Dict[str, Any] = field(default_factory=dict)  # Original row data
    
    def __post_init__(self):
        # Ensure net is calculated if not provided
        if self.net == 0.0 and self.gross != 0.0:
            self.net = self.gross - self.fee


@dataclass
class DailyTotals:
    """Aggregated totals for a single day and source"""
    date: date
    source: Source
    processor: str                   # Processor name for display
    
    # Counts
    charge_count: int = 0
    refund_count: int = 0
    refund_failure_count: int = 0
    fee_count: int = 0
    dispute_count: int = 0
    adjustment_count: int = 0
    payout_count: int = 0
    
    # Amounts (gross)
    charge_gross: float = 0.0
    refund_gross: float = 0.0        # Should be negative
    refund_failure_gross: float = 0.0  # Should be positive
    fee_amount: float = 0.0          # Should be negative
    dispute_gross: float = 0.0
    adjustment_gross: float = 0.0
    payout_gross: float = 0.0
    
    # Calculated
    @property
    def total_gross(self) -> float:
        """Total gross economic activity (sales + refunds + refund failures)"""
        return self.charge_gross + self.refund_gross + self.refund_failure_gross
    
    @property
    def total_net(self) -> float:
        """Net after fees and adjustments"""
        return self.total_gross + self.fee_amount + self.adjustment_gross
    
    @property
    def total_count(self) -> int:
        return (self.charge_count + self.refund_count + self.refund_failure_count + 
                self.fee_count + self.dispute_count + self.adjustment_count)


@dataclass
class VarianceBreakdown:
    """Breakdown of variance by reason code"""
    timing_cutoff: float = 0.0
    refund_failure: float = 0.0
    void_vs_refund: float = 0.0
    processor_only: float = 0.0
    spi_only: float = 0.0
    adjustments: float = 0.0
    disputes: float = 0.0
    fees: float = 0.0
    unexplained: float = 0.0
    
    def to_dict(self) -> Dict[str, float]:
        return {
            "timing_cutoff": self.timing_cutoff,
            "refund_failure": self.refund_failure,
            "void_vs_refund": self.void_vs_refund,
            "processor_only": self.processor_only,
            "spi_only": self.spi_only,
            "adjustments": self.adjustments,
            "disputes": self.disputes,
            "fees": self.fees,
            "unexplained": self.unexplained,
        }


@dataclass
class DailyStatus:
    """
    Daily reconciliation status for a single processor.
    This is the primary output consumed by the dashboard.
    """
    date: date
    entity_id: str
    processor: str                   # stripe, braintree, nmi_chesapeake, etc.
    
    # SPI totals
    spi_charge_gross: float = 0.0
    spi_refund_gross: float = 0.0
    spi_refund_failure_gross: float = 0.0
    spi_target_gross: float = 0.0    # Calculated: charges + refunds + refund_failures
    spi_charge_count: int = 0
    spi_refund_count: int = 0
    
    # Processor totals
    proc_charge_gross: float = 0.0
    proc_refund_gross: float = 0.0
    proc_fee_amount: float = 0.0
    proc_target_gross: float = 0.0   # Calculated: charges + refunds
    proc_charge_count: int = 0
    proc_refund_count: int = 0
    
    # Variance
    variance_amount: float = 0.0     # SPI target - Processor target
    variance_pct: float = 0.0        # Variance as percentage
    
    # Status
    status: ReconciliationStatus = ReconciliationStatus.GREEN
    top_reason_code: ReasonCode = ReasonCode.WITHIN_TOLERANCE
    reason_codes: List[ReasonCode] = field(default_factory=list)
    
    # Variance breakdown
    variance_breakdown: VarianceBreakdown = field(default_factory=VarianceBreakdown)
    
    # Data quality flags
    spi_data_present: bool = True
    proc_data_present: bool = True
    data_freshness_hours: int = 0
    
    def calculate_variance(self):
        """Calculate variance and percentage"""
        self.spi_target_gross = (self.spi_charge_gross + 
                                  self.spi_refund_gross + 
                                  self.spi_refund_failure_gross)
        self.proc_target_gross = self.proc_charge_gross + self.proc_refund_gross
        self.variance_amount = self.spi_target_gross - self.proc_target_gross
        
        # Calculate percentage (avoid division by zero)
        denominator = max(abs(self.spi_target_gross), abs(self.proc_target_gross), 1.0)
        self.variance_pct = (self.variance_amount / denominator) * 100
    
    def classify_status(self, tolerance_amount: float = 10.0, tolerance_pct: float = 0.25):
        """
        Classify status as GREEN/YELLOW/RED based on variance.
        
        GREEN: abs(variance) <= max($tolerance_amount, tolerance_pct%)
        YELLOW: variance outside tolerance but explainable
        RED: unexplained variance
        """
        abs_variance = abs(self.variance_amount)
        threshold = max(tolerance_amount, abs(self.spi_target_gross) * (tolerance_pct / 100))
        
        if not self.spi_data_present or not self.proc_data_present:
            self.status = ReconciliationStatus.RED
            self.top_reason_code = ReasonCode.DATA_MISSING
        elif abs_variance <= threshold:
            self.status = ReconciliationStatus.GREEN
            self.top_reason_code = ReasonCode.WITHIN_TOLERANCE
        elif self._has_explainable_variance():
            self.status = ReconciliationStatus.YELLOW
            # top_reason_code set by _has_explainable_variance
        else:
            self.status = ReconciliationStatus.RED
            self.top_reason_code = ReasonCode.UNEXPLAINED
    
    def _has_explainable_variance(self) -> bool:
        """Check if variance can be explained by known factors"""
        vb = self.variance_breakdown
        explainable = (abs(vb.timing_cutoff) + abs(vb.refund_failure) + 
                      abs(vb.disputes) + abs(vb.fees))
        
        if abs(vb.timing_cutoff) > 0:
            self.top_reason_code = ReasonCode.TIMING_CUTOFF
            return True
        if abs(vb.refund_failure) > 0:
            self.top_reason_code = ReasonCode.REFUND_FAILURE
            return True
        if abs(vb.disputes) > 0:
            self.top_reason_code = ReasonCode.DISPUTE_LIFECYCLE
            return True
            
        return False
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": str(self.date),
            "entity_id": self.entity_id,
            "processor": self.processor,
            "spi_charge_gross": self.spi_charge_gross,
            "spi_refund_gross": self.spi_refund_gross,
            "spi_refund_failure_gross": self.spi_refund_failure_gross,
            "spi_target_gross": self.spi_target_gross,
            "spi_charge_count": self.spi_charge_count,
            "spi_refund_count": self.spi_refund_count,
            "proc_charge_gross": self.proc_charge_gross,
            "proc_refund_gross": self.proc_refund_gross,
            "proc_fee_amount": self.proc_fee_amount,
            "proc_target_gross": self.proc_target_gross,
            "proc_charge_count": self.proc_charge_count,
            "proc_refund_count": self.proc_refund_count,
            "variance_amount": self.variance_amount,
            "variance_pct": self.variance_pct,
            "status": self.status.value,
            "top_reason_code": self.top_reason_code.value,
            "reason_codes": [rc.value for rc in self.reason_codes],
            "variance_breakdown": self.variance_breakdown.to_dict(),
            "spi_data_present": self.spi_data_present,
            "proc_data_present": self.proc_data_present,
        }


@dataclass
class ReconException:
    """
    A reconciliation exception representing a variance bucket.
    Unlike transaction-level exceptions, these are categorized by reason code.
    """
    id: str
    entity_id: str
    date: date
    period: str                      # YYYY-MM
    processor: str
    reason_code: ReasonCode
    amount: float
    direction: str                   # "spi_only", "processor_only", "mismatch"
    
    # Counts (how many underlying items)
    item_count: int = 1
    
    # Resolution
    resolution_status: ResolutionStatus = ResolutionStatus.NEEDS_REVIEW
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    notes: str = ""
    
    # Reference data for drilldown
    reference_ids: List[str] = field(default_factory=list)
    suggested_matches: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "entity_id": self.entity_id,
            "date": str(self.date),
            "period": self.period,
            "processor": self.processor,
            "reason_code": self.reason_code.value,
            "amount": self.amount,
            "direction": self.direction,
            "item_count": self.item_count,
            "resolution_status": self.resolution_status.value,
            "resolved_by": self.resolved_by,
            "resolved_at": str(self.resolved_at) if self.resolved_at else None,
            "notes": self.notes,
            "reference_ids": self.reference_ids,
            "suggested_matches": self.suggested_matches,
        }


@dataclass  
class MonthEndBridge:
    """
    Month-end bridge table that replicates legacy workbook format.
    This is the month-end close package summary.
    """
    entity_id: str
    processor: str
    period: str                      # YYYY-MM
    
    # Opening
    opening_balance: float = 0.0
    
    # SPI Activity
    spi_sales: float = 0.0
    spi_refunds: float = 0.0
    spi_refund_failures: float = 0.0
    spi_adjustments: float = 0.0
    spi_gross_activity: float = 0.0  # Calculated
    
    # Processor adjustments
    proc_fees: float = 0.0
    proc_disputes_net: float = 0.0
    proc_adjustments: float = 0.0
    proc_reserves: float = 0.0
    
    # Cash
    net_expected_cash: float = 0.0   # Calculated
    bank_deposits: float = 0.0
    bank_fees: float = 0.0
    deposits_in_transit: float = 0.0
    
    # Result
    ending_balance: float = 0.0
    ending_difference: float = 0.0   # Should be 0
    
    # Metadata
    daily_statuses: List[DailyStatus] = field(default_factory=list)
    exceptions: List[ReconException] = field(default_factory=list)
    
    def calculate(self):
        """Calculate derived fields"""
        self.spi_gross_activity = (self.spi_sales + self.spi_refunds + 
                                   self.spi_refund_failures + self.spi_adjustments)
        
        self.net_expected_cash = (self.spi_gross_activity + self.proc_fees + 
                                  self.proc_disputes_net + self.proc_adjustments +
                                  self.proc_reserves)
        
        self.ending_difference = (self.opening_balance + self.net_expected_cash - 
                                  self.bank_deposits - self.bank_fees - 
                                  self.deposits_in_transit - self.ending_balance)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "processor": self.processor,
            "period": self.period,
            "opening_balance": self.opening_balance,
            "spi_sales": self.spi_sales,
            "spi_refunds": self.spi_refunds,
            "spi_refund_failures": self.spi_refund_failures,
            "spi_adjustments": self.spi_adjustments,
            "spi_gross_activity": self.spi_gross_activity,
            "proc_fees": self.proc_fees,
            "proc_disputes_net": self.proc_disputes_net,
            "proc_adjustments": self.proc_adjustments,
            "proc_reserves": self.proc_reserves,
            "net_expected_cash": self.net_expected_cash,
            "bank_deposits": self.bank_deposits,
            "bank_fees": self.bank_fees,
            "deposits_in_transit": self.deposits_in_transit,
            "ending_balance": self.ending_balance,
            "ending_difference": self.ending_difference,
        }
