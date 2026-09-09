"""
Pydantic Schemas for Alerts
---------------------------
Defines schemas for viewing and acknowledging alerts per §8, §9, and §14 of architecture.md.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict


class AlertOut(BaseModel):
    id: UUID
    type: str  # CRITICAL_DRIFT / DEVICE_DOWN / REMEDIATION_FAILED / SECURITY_CHANGE
    related_id: Optional[UUID] = None
    message: str
    acknowledged: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AlertAckResponse(BaseModel):
    message: str
    alert: AlertOut
