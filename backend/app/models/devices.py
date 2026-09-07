import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, LargeBinary, Uuid
from sqlalchemy.orm import relationship
from app.core.database import Base


class DeviceGroup(Base):
    __tablename__ = "device_groups"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(64), nullable=False)  # Classroom / Hostel / Office / Lab / PublicEvent
    criticality_weight = Column(Float, nullable=False, default=1.0)  # used in severity scoring

    devices = relationship("Device", back_populates="device_group", cascade="all, delete-orphan")
    baselines = relationship("Baseline", back_populates="device_group")
    change_tickets = relationship("ChangeTicket", back_populates="device_group")

    def __repr__(self) -> str:
        return f"<DeviceGroup(name={self.name}, weight={self.criticality_weight})>"


class Device(Base):
    __tablename__ = "devices"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hostname = Column(String(128), index=True, nullable=False)
    ip_address = Column(String(45), index=True, nullable=False)  # v4/v6
    vendor = Column(String(32), nullable=False)  # cisco_ios, juniper_junos, frr, etc.
    model = Column(String(64), nullable=False)
    device_group_id = Column(Uuid(as_uuid=True), ForeignKey("device_groups.id"), nullable=False)
    status = Column(String(16), nullable=False, default="ONLINE")  # ONLINE / UNREACHABLE / DECOMMISSIONED
    last_polled_at = Column(DateTime, nullable=True)

    device_group = relationship("DeviceGroup", back_populates="devices")
    credentials = relationship("DeviceCredential", back_populates="device", uselist=False, cascade="all, delete-orphan")
    snapshots = relationship("ConfigurationSnapshot", back_populates="device", cascade="all, delete-orphan")
    drift_events = relationship("DriftEvent", back_populates="device", cascade="all, delete-orphan")
    backups = relationship("Backup", back_populates="device", cascade="all, delete-orphan")
    change_tickets = relationship("ChangeTicket", back_populates="device")

    def __repr__(self) -> str:
        return f"<Device(hostname={self.hostname}, ip={self.ip_address})>"


class DeviceCredential(Base):
    __tablename__ = "device_credentials"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(Uuid(as_uuid=True), ForeignKey("devices.id"), nullable=False, unique=True)
    username_enc = Column(LargeBinary, nullable=False)  # encrypted at rest (Fernet/KMS)
    secret_ref = Column(String(255), nullable=False)  # pointer to vault/secret store, never plaintext in DB
    auth_type = Column(String(16), nullable=False, default="password")  # password / ssh_key

    device = relationship("Device", back_populates="credentials")

    def __repr__(self) -> str:
        return f"<DeviceCredential(device_id={self.device_id}, auth_type={self.auth_type})>"
