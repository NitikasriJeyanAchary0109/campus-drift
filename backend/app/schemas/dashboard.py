"""
Pydantic Schemas for Dashboard Aggregation API
----------------------------------------------
Provides unified summary statistics, compliance metrics, taxonomy breakdown,
recent alerts/remediations, and 14-day trend series per §9 and §14 of architecture.md.
"""
from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.alerts import AlertOut


class DriftTrendPoint(BaseModel):
    """Daily average risk score point for 14-day drift trend timeline."""
    date: str = Field(..., description="Date formatted as YYYY-MM-DD")
    average_score: float = Field(..., description="Average drift risk score for events detected on this day")
    event_count: int = Field(..., description="Number of drift events detected on this day")


class RecentRemediationSummary(BaseModel):
    """Summary of a recent remediation execution."""
    id: UUID
    remediation_plan_id: UUID
    device_hostname: Optional[str] = None
    result: str  # SUCCESS / ROLLED_BACK / FAILED / IN_PROGRESS
    executed_commands_count: int
    executed_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DashboardSummaryOut(BaseModel):
    """
    Consolidated dashboard payload enabling the frontend to load with a single performant request.
    
    CRITICAL COMPLIANCE METRIC SPECIFICATION (§14):
    Devices in the 'NO_BASELINE' state are strictly excluded from the compliance calculation denominator.
    Formula:
        compliance_percentage = (compliant_devices / (total_devices - no_baseline_devices)) * 100
    This ensures that configuration coverage gaps are surfaced separately as actionable metrics
    (via `no_baseline_gap_count`) without falsely depressing or inflating compliance percentages.
    """
    total_devices: int = Field(..., description="Total device count in inventory")
    devices_by_status: Dict[str, int] = Field(..., description="Breakdown of devices by operational status (e.g. ONLINE, UNREACHABLE)")
    compliance_percentage: float = Field(
        ...,
        description="Overall network compliance percentage. CRITICAL (§14): Devices with NO_BASELINE are excluded from the denominator.",
    )
    no_baseline_gap_count: int = Field(..., description="Count of devices with no active baseline, surfaced as an actionable gap metric")
    drift_by_label: Dict[str, int] = Field(..., description="Breakdown of currently OPEN drift events by taxonomy label")
    recent_alerts: List[AlertOut] = Field(..., description="Most recent 10 system alerts ordered by timestamp descending")
    recent_remediations: List[RecentRemediationSummary] = Field(..., description="Most recent 10 remediation actions ordered by execution time descending")
    drift_trend: List[DriftTrendPoint] = Field(..., description="Daily drift score averages and event counts for the past 14 days")
