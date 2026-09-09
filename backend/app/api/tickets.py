"""
Change Tickets API Router
-------------------------
Exposes endpoints for listing and creating change tickets per §9 of architecture.md:
- GET /api/tickets (Viewer+)
- POST /api/tickets (NetEng+)
"""
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rbac import require_neteng, require_viewer
from app.models.tickets import ChangeTicket
from app.models.devices import Device, DeviceGroup
from app.models.users import User
from app.schemas.tickets import ChangeTicketCreate, ChangeTicketOut

router = APIRouter(prefix="/tickets", tags=["Tickets"])


@router.get("", response_model=List[ChangeTicketOut])
def list_tickets(
    device_id: Optional[UUID] = Query(None, description="Filter by device UUID"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status (OPEN/CLOSED)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    List all change tickets.
    Role: Viewer+
    """
    query = db.query(ChangeTicket)
    if device_id:
        query = query.filter(ChangeTicket.device_id == device_id)
    if status_filter:
        query = query.filter(ChangeTicket.status == status_filter.upper())

    return query.order_by(ChangeTicket.valid_from.desc()).all()


@router.post("", response_model=ChangeTicketOut, status_code=status.HTTP_201_CREATED)
def create_ticket(
    ticket_in: ChangeTicketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Create a new change ticket to authorize configuration drift.
    Role: NetEng+
    """
    # Check for duplicate ticket_ref
    existing = db.query(ChangeTicket).filter(ChangeTicket.ticket_ref == ticket_in.ticket_ref).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Change ticket with ref '{ticket_in.ticket_ref}' already exists",
        )

    # Validate device or group if provided
    if ticket_in.device_id:
        dev = db.query(Device).filter(Device.id == ticket_in.device_id).first()
        if not dev:
            raise HTTPException(status_code=404, detail=f"Device {ticket_in.device_id} not found")
    if ticket_in.device_group_id:
        grp = db.query(DeviceGroup).filter(DeviceGroup.id == ticket_in.device_group_id).first()
        if not grp:
            raise HTTPException(status_code=404, detail=f"DeviceGroup {ticket_in.device_group_id} not found")

    if ticket_in.valid_from > ticket_in.valid_to:
        raise HTTPException(status_code=400, detail="valid_from must be before valid_to")

    ticket = ChangeTicket(
        ticket_ref=ticket_in.ticket_ref,
        device_id=ticket_in.device_id,
        device_group_id=ticket_in.device_group_id,
        key_path_scope=ticket_in.key_path_scope,
        valid_from=ticket_in.valid_from,
        valid_to=ticket_in.valid_to,
        status=ticket_in.status.upper(),
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket
