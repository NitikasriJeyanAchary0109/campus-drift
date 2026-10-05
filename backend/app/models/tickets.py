import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Uuid
from sqlalchemy.orm import relationship
from app.core.database import Base


class ChangeTicket(Base):
    __tablename__ = "change_tickets"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_ref = Column(String(64), unique=True, nullable=False)  # unique ticket ref
    source = Column(String(32), nullable=False, default="internal")  # internal, servicenow, jira, external
    external_ref = Column(String(64), nullable=True, index=True)  # external ITSM ID
    device_id = Column(Uuid(as_uuid=True), ForeignKey("devices.id"), nullable=True)  # nullable = applies to group
    device_group_id = Column(Uuid(as_uuid=True), ForeignKey("device_groups.id"), nullable=True)
    key_path_scope = Column(String(255), nullable=False)  # which config area it authorizes
    valid_from = Column(DateTime, nullable=False)
    valid_to = Column(DateTime, nullable=False)  # matching window used by Ticket Matcher
    status = Column(String(16), nullable=False, default="OPEN")  # OPEN / CLOSED

    device = relationship("Device", back_populates="change_tickets")
    device_group = relationship("DeviceGroup", back_populates="change_tickets")
    drift_events = relationship("DriftEvent", back_populates="matched_ticket")

    def __repr__(self) -> str:
        return f"<ChangeTicket(ref={self.ticket_ref}, scope={self.key_path_scope}, status={self.status})>"
