import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Text, Uuid
from app.core.database import Base


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type = Column(String(32), nullable=False, index=True)  # CRITICAL_DRIFT / DEVICE_DOWN / REMEDIATION_FAILED / SECURITY_CHANGE
    related_id = Column(Uuid(as_uuid=True), nullable=True)  # polymorphic ref (drift_event or remediation_action)
    message = Column(Text, nullable=False)
    acknowledged = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)

    def __repr__(self) -> str:
        return f"<Alert(type={self.type}, ack={self.acknowledged}, created_at={self.created_at})>"
