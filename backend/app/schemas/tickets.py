"""
Pydantic Schemas for Change Tickets
-----------------------------------
Provides schemas for change tickets that authorize configuration drift per §8, §9, §11.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class ChangeTicketBase(BaseModel):
    ticket_ref: str = Field(..., description="ITSM ticket reference (e.g. CHG-2026-001)")
    device_id: Optional[UUID] = Field(None, description="Optional target device UUID")
    device_group_id: Optional[UUID] = Field(None, description="Optional target device group UUID")
    key_path_scope: str = Field(..., description="Config key path authorized (e.g. interface.FastEthernet0/1)")
    valid_from: datetime = Field(..., description="Start of change window")
    valid_to: datetime = Field(..., description="End of change window")
    status: str = Field(default="OPEN", description="OPEN or CLOSED")


class ChangeTicketCreate(ChangeTicketBase):
    pass


class ChangeTicketOut(ChangeTicketBase):
    id: UUID

    model_config = ConfigDict(from_attributes=True)
