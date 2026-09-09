"""
Pydantic Schemas for Audit Logs
-------------------------------
Defines schemas for viewing immutable audit records per §8, §9, and §13 of architecture.md.
"""
from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, ConfigDict


class AuditLogOut(BaseModel):
    id: UUID
    user_id: Optional[UUID] = None
    username: Optional[str] = None
    action: str
    target_type: str
    target_id: Optional[UUID] = None
    before_state: Optional[Dict[str, Any]] = None
    after_state: Optional[Dict[str, Any]] = None
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)
