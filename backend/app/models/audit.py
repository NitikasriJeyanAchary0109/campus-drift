import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, Uuid
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

    user = relationship("User", back_populates="audit_logs")

    def __repr__(self) -> str:
        return f"<AuditLog(action={self.action}, target={self.target_type}, at={self.timestamp})>"
