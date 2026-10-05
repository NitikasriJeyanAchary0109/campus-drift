import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text, Uuid
from sqlalchemy.orm import relationship
from app.core.database import Base


class DriftEvent(Base):
    __tablename__ = "drift_events"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(Uuid(as_uuid=True), ForeignKey("devices.id"), nullable=False, index=True)
    snapshot_id = Column(Uuid(as_uuid=True), ForeignKey("configuration_snapshots.id"), nullable=False)
    baseline_id = Column(Uuid(as_uuid=True), ForeignKey("baselines.id"), nullable=True)
    label = Column(String(32), nullable=False, index=True)  # see §12 label taxonomy (includes NO_BASELINE)
    risk_score = Column(Integer, nullable=False, index=True)  # 0–100
    underlying_severity = Column(Integer, nullable=True)  # Pre-ticket-cap raw score for audit/evidence
    matched_ticket_id = Column(Uuid(as_uuid=True), ForeignKey("change_tickets.id"), nullable=True)
    status = Column(String(16), nullable=False, default="OPEN")  # OPEN / ACK / RESOLVED / FALSE_POSITIVE
    detected_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)

    device = relationship("Device", back_populates="drift_events")
    snapshot = relationship("ConfigurationSnapshot", back_populates="drift_events")
    baseline = relationship("Baseline", back_populates="drift_events")
    matched_ticket = relationship("ChangeTicket", back_populates="drift_events")
    details = relationship("DriftDetail", back_populates="drift_event", cascade="all, delete-orphan")
    remediation_plans = relationship("RemediationPlan", back_populates="drift_event", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<DriftEvent(device_id={self.device_id}, label={self.label}, score={self.risk_score})>"


class DriftDetail(Base):
    __tablename__ = "drift_details"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    drift_event_id = Column(Uuid(as_uuid=True), ForeignKey("drift_events.id"), nullable=False, index=True)
    key_path = Column(String(255), nullable=False)
    expected_value = Column(Text, nullable=True)
    actual_value = Column(Text, nullable=True)
    change_type = Column(String(32), nullable=False)  # ADDED / REMOVED / MODIFIED / ACL_ORDER_SIGNIFICANT
    rule_id = Column(Uuid(as_uuid=True), ForeignKey("baseline_rules.id"), nullable=True)

    drift_event = relationship("DriftEvent", back_populates="details")
    rule = relationship("BaselineRule", back_populates="drift_details")

    def __repr__(self) -> str:
        return f"<DriftDetail(path={self.key_path}, type={self.change_type})>"
