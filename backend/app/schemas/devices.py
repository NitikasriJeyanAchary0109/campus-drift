from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class DeviceGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    criticality_weight: float


class DeviceBase(BaseModel):
    hostname: str = Field(..., max_length=128, examples=["sw-classroom-01"])
    ip_address: str = Field(..., max_length=45, examples=["10.10.1.10"])
    vendor: str = Field(..., max_length=32, examples=["cisco_ios"])
    model: str = Field(..., max_length=64, examples=["Catalyst 2960-X"])
    device_group_id: UUID
    status: str = Field(default="ONLINE", max_length=16, examples=["ONLINE"])


class DeviceCreate(DeviceBase):
    pass


class DeviceUpdate(BaseModel):
    hostname: Optional[str] = Field(None, max_length=128)
    ip_address: Optional[str] = Field(None, max_length=45)
    vendor: Optional[str] = Field(None, max_length=32)
    model: Optional[str] = Field(None, max_length=64)
    device_group_id: Optional[UUID] = None
    status: Optional[str] = Field(None, max_length=16)


class SnapshotSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    collected_at: datetime
    collection_method: str


class DeviceOut(DeviceBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    last_polled_at: Optional[datetime] = None
    device_group: Optional[DeviceGroupOut] = None
    has_credentials: bool = False


class DeviceDetailOut(DeviceOut):
    latest_snapshot: Optional[SnapshotSummaryOut] = None


class DeviceCredentialCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    secret: str = Field(..., min_length=1, max_length=256)
    auth_type: str = Field(default="password", pattern="^(password|ssh_key)$")


class DeviceCredentialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    device_id: UUID
    auth_type: str
    secret_ref: str
    has_credential: bool = True


class PollTriggerResponse(BaseModel):
    device_id: UUID
    hostname: str
    status: str
    message: str
    timestamp: datetime
