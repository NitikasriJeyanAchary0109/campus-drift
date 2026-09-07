import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text, Uuid
from sqlalchemy.orm import relationship
from app.core.database import Base


class Baseline(Base):
    __tablename__ = "baselines"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(128), nullable=False)
    device_group_id = Column(Uuid(as_uuid=True), ForeignKey("device_groups.id"), nullable=False)
    vendor = Column(String(32), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, index=True, default=True, nullable=False)
    created_by = Column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    device_group = relationship("DeviceGroup", back_populates="baselines")
    creator = relationship("User", back_populates="baselines_created")
    rules = relationship("BaselineRule", back_populates="baseline", cascade="all, delete-orphan")
    drift_events = relationship("DriftEvent", back_populates="baseline")

    def __repr__(self) -> str:
        return f"<Baseline(name={self.name}, version={self.version}, active={self.is_active})>"


class BaselineRule(Base):
    __tablename__ = "baseline_rules"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baseline_id = Column(Uuid(as_uuid=True), ForeignKey("baselines.id"), nullable=False)
    key_path = Column(String(255), nullable=False)  # e.g. interface.*.port_security.enabled
    expected_value = Column(Text, nullable=False)
    rule_type = Column(String(16), nullable=False)  # EXACT / REGEX / MUST_EXIST / MUST_NOT_EXIST
    severity_weight = Column(Integer, nullable=False)  # 1–100, drives risk score
    hard_compliance = Column(Boolean, nullable=False, default=False)  # true = violates regardless of ticket

    baseline = relationship("Baseline", back_populates="rules")
    drift_details = relationship("DriftDetail", back_populates="rule")

    def __repr__(self) -> str:
        return f"<BaselineRule(key_path={self.key_path}, type={self.rule_type}, weight={self.severity_weight})>"
