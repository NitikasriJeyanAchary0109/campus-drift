import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Uuid, Index
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.types import JSONB_compat


class ConfigurationSnapshot(Base):
    __tablename__ = "configuration_snapshots"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(Uuid(as_uuid=True), ForeignKey("devices.id"), nullable=False, index=True)
    raw_config = Column(Text, nullable=False)
    normalized_json = Column(JSONB_compat(), nullable=False)  # indexed with GIN for querying
    collected_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    collection_method = Column(String(16), nullable=False, default="SSH")  # SSH / API / MANUAL_UPLOAD
    status = Column(String(16), nullable=False, default="SUCCESS")  # SUCCESS / PARSE_ERROR / FAILED

    device = relationship("Device", back_populates="snapshots")
    drift_events = relationship("DriftEvent", back_populates="snapshot")

    __table_args__ = (
        Index(
            "ix_configuration_snapshots_normalized_json",
            "normalized_json",
            postgresql_using="gin",
        ),
    )

    def __repr__(self) -> str:
        return f"<ConfigurationSnapshot(device_id={self.device_id}, method={self.collection_method}, collected_at={self.collected_at})>"
