"""
Pydantic Schemas for Remediation & Approvals
-------------------------------------------
Provides schemas for remediation plan generation, previews, approval decisions,
and execution/rollback actions per §8, §9, and §13 of architecture.md.
"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class ApprovalCreate(BaseModel):
    decision: str = Field(..., pattern="^(APPROVED|REJECTED)$", description="Approval decision: APPROVED or REJECTED")
    comment: Optional[str] = Field(None, max_length=1000, description="Optional engineering review comment")


class ApprovalOut(BaseModel):
    id: UUID
    remediation_plan_id: UUID
    approved_by: UUID
    approver_username: Optional[str] = None
    decision: str
    comment: Optional[str] = None
    decided_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RemediationActionOut(BaseModel):
    id: UUID
    remediation_plan_id: UUID
    executed_commands: List[str]
    result: str  # SUCCESS / FAILED / ROLLED_BACK
    verification_snapshot_id: Optional[UUID] = None
    executed_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RemediationPlanOut(BaseModel):
    id: UUID
    drift_event_id: UUID
    device_id: Optional[UUID] = None
    device_hostname: Optional[str] = None
    proposed_commands: List[str]
    status: str  # PENDING / APPROVED / REJECTED / APPLIED
    created_at: datetime
    approval: Optional[ApprovalOut] = None

    model_config = ConfigDict(from_attributes=True)


class ApplyRemediationResponse(BaseModel):
    message: str
    action_id: UUID
    remediation_plan_id: UUID
    result: str  # SUCCESS / ROLLED_BACK
    executed_commands: List[str]
    verification_passed: bool
    details: Dict[str, Any] = {}


class RollbackResponse(BaseModel):
    message: str
    action_id: UUID
    result: str  # ROLLED_BACK / ROLLBACK_FAILED
    details: Dict[str, Any] = {}
