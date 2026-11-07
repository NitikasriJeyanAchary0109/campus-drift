import uuid
from datetime import datetime, timezone
import json
import logging
from sqlalchemy import BigInteger, Column, Integer, String, DateTime, ForeignKey, Uuid
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.types import JSONB_compat


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)  # null = system action
    action = Column(String(64), nullable=False, index=True)
    target_type = Column(String(32), nullable=False)  # device / baseline / remediation / approval
    target_id = Column(Uuid(as_uuid=True), nullable=True)
    before_state = Column(JSONB_compat(), nullable=True)
    after_state = Column(JSONB_compat(), nullable=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    # Tamper evidence (PostgreSQL only; a trigger fills these, the application never writes them): each row's hash covers the
    # previous row's hash, so an edited, removed or inserted-in-the-past row breaks the chain. GET /api/audit/verify checks it.
    seq = Column(BigInteger().with_variant(Integer, "sqlite"), nullable=True)
    prev_hash = Column(String(64), nullable=True)
    row_hash = Column(String(64), nullable=True)

    user = relationship("User", back_populates="audit_logs")

    def __repr__(self) -> str:
        return f"<AuditLog(action={self.action}, target={self.target_type}, at={self.timestamp})>"


from sqlalchemy import event


@event.listens_for(AuditLog, "before_update")
def _prevent_audit_log_update(mapper, connection, target):
    """Enforce application-layer immutability per §13: denies UPDATE on audit_logs."""
    raise PermissionError("AuditLog records are immutable: UPDATE operations are strictly prohibited.")


@event.listens_for(AuditLog, "before_delete")
def _prevent_audit_log_delete(mapper, connection, target):
    """Enforce application-layer immutability per §13: denies DELETE on audit_logs."""
    raise PermissionError("AuditLog records are immutable: DELETE operations are strictly prohibited.")



_ship = logging.getLogger("campus_drift.audit")


@event.listens_for(AuditLog, "after_insert")
def _ship_audit_line(mapper, connection, target):
    """
    One JSON line per entry on the 'campus_drift.audit' logger. Point that logger at syslog or a log collector that the
    database administrators cannot write to, and the trail also exists outside the database (a wiped table cannot erase it).
    """
    try:
        _ship.info(json.dumps({
            "id": str(target.id), "user_id": str(target.user_id) if target.user_id else None, "action": target.action,
            "target_type": target.target_type, "target_id": str(target.target_id) if target.target_id else None,
            "timestamp": target.timestamp.isoformat() if target.timestamp else None, "after_state": target.after_state,
        }, default=str))
    except Exception:  # shipping must never break the action being audited
        pass
