import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Uuid
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.types import StringArrayType


class RemediationPlan(Base):
    __tablename__ = "remediation_plans"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    drift_event_id = Column(Uuid(as_uuid=True), ForeignKey("drift_events.id"), nullable=False)
    proposed_commands = Column(StringArrayType(), nullable=False)  # TEXT[] generated CLI, whitelisted templates only
    status = Column(String(16), nullable=False, default="PENDING")  # PENDING / APPROVED / REJECTED / APPLIED
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    drift_event = relationship("DriftEvent", back_populates="remediation_plans")
    approval = relationship("Approval", back_populates="remediation_plan", uselist=False, cascade="all, delete-orphan")
    actions = relationship("RemediationAction", back_populates="remediation_plan", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<RemediationPlan(id={self.id}, status={self.status})>"


class Approval(Base):
    __tablename__ = "approvals"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    remediation_plan_id = Column(Uuid(as_uuid=True), ForeignKey("remediation_plans.id"), nullable=False, unique=True)
    approved_by = Column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False)  # role must be Admin/NetEng
    decision = Column(String(16), nullable=False)  # APPROVED / REJECTED
    comment = Column(Text, nullable=True)
    decided_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    remediation_plan = relationship("RemediationPlan", back_populates="approval")
    approver = relationship("User", back_populates="approvals")

    def __repr__(self) -> str:
        return f"<Approval(plan_id={self.remediation_plan_id}, decision={self.decision})>"


class RemediationAction(Base):
    __tablename__ = "remediation_actions"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    remediation_plan_id = Column(Uuid(as_uuid=True), ForeignKey("remediation_plans.id"), nullable=False)
    executed_commands = Column(StringArrayType(), nullable=False)
    result = Column(String(16), nullable=False)  # SUCCESS / FAILED / ROLLED_BACK
    verification_snapshot_id = Column(Uuid(as_uuid=True), ForeignKey("configuration_snapshots.id"), nullable=True)
    executed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    remediation_plan = relationship("RemediationPlan", back_populates="actions")
    backups = relationship("Backup", back_populates="taken_before_action")

    def __repr__(self) -> str:
        return f"<RemediationAction(plan_id={self.remediation_plan_id}, result={self.result})>"


class Backup(Base):
    __tablename__ = "backups"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(Uuid(as_uuid=True), ForeignKey("devices.id"), nullable=False, index=True)
    config_blob = Column(Text, nullable=False)  # full config captured pre-change
    taken_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    taken_before_action_id = Column(Uuid(as_uuid=True), ForeignKey("remediation_actions.id"), nullable=True)

    device = relationship("Device", back_populates="backups")
    taken_before_action = relationship("RemediationAction", back_populates="backups")

    def __repr__(self) -> str:
        return f"<Backup(device_id={self.device_id}, taken_at={self.taken_at})>"
