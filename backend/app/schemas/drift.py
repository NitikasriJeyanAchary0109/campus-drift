"""
Pydantic Schemas for Drift Detection & Evidence Generation
----------------------------------------------------------
Provides schemas for drift events, details, evidence bundles, and false-positive triage
per §8, §9, §11, and §12 of architecture.md.
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class DriftDetailOut(BaseModel):
    id: UUID
    key_path: str
    expected_value: Optional[str] = None
    actual_value: Optional[str] = None
    change_type: str  # ADDED / REMOVED / MODIFIED
    rule_id: Optional[UUID] = None
    why_it_matters: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class EvidenceBundle(BaseModel):
    event_id: UUID
    device_hostname: str
    device_ip: str
    device_group: str
    risk_score: int
    underlying_severity: Optional[int] = None
    label: str
    is_high_priority: bool
    ticket_matched: bool
    ticket_ref: Optional[str] = None
    why_it_matters_summary: str
    details: List[DriftDetailOut] = []


class DriftEventOut(BaseModel):
    id: UUID
    device_id: UUID
    device_hostname: Optional[str] = None
    snapshot_id: UUID
    baseline_id: Optional[UUID] = None
    label: str
    risk_score: int
    underlying_severity: Optional[int] = None
    matched_ticket_id: Optional[UUID] = None
    matched_ticket_ref: Optional[str] = None
    status: str
    detected_at: datetime
    details_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class DriftEventDetailOut(DriftEventOut):
    details: List[DriftDetailOut] = []
    evidence_bundle: Optional[EvidenceBundle] = None


class MarkFalsePositiveRequest(BaseModel):
    comment: str = Field(..., min_length=5, description="Mandatory engineer comment explaining false positive classification")


class MarkFalsePositiveResponse(BaseModel):
    message: str
    event_id: UUID
    status: str
    comment: str
