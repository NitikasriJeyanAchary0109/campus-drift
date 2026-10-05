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
    source: Optional[str] = Field("internal", description="Ticket origin (internal, servicenow, jira, external)")
    external_ref: Optional[str] = Field(None, description="External ITSM identifier")
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


class ITSMWebhookPayload(BaseModel):
    external_ref: str = Field(..., description="External ITSM ticket identifier (e.g. CHG0010042)")
    ticket_ref: Optional[str] = Field(None, description="Internal reference; defaults to external_ref")
    source: Optional[str] = Field("external", description="Source platform (servicenow, jira, external)")
    hostname: Optional[str] = Field(None, description="Device hostname")
    ip_address: Optional[str] = Field(None, description="Device IP address")
    device_id: Optional[UUID] = Field(None, description="Device UUID")
    group_name: Optional[str] = Field(None, description="Device group name")
    device_group_id: Optional[UUID] = Field(None, description="Device group UUID")
    key_path_scope: str = Field(..., description="Config key path authorized (e.g. interface.*.port_security.*)")
    valid_from: datetime = Field(..., description="Start of maintenance window")
    valid_to: datetime = Field(..., description="End of maintenance window")
    status: str = Field(default="OPEN", description="OPEN / CLOSED")
    description: Optional[str] = Field(None, description="Change description or maintenance rationale")
