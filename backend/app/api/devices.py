from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rbac import require_admin, require_neteng, require_viewer
from app.models.devices import Device, DeviceGroup
from app.models.configurations import ConfigurationSnapshot
from app.models.users import User
from app.schemas.devices import (
    DeviceCreate,
    DeviceUpdate,
    DeviceOut,
    DeviceDetailOut,
    DeviceGroupOut,
    DeviceCredentialCreate,
    DeviceCredentialOut,
    PollTriggerResponse,
    PollStatusResponse,
    SnapshotSummaryOut,
)
from celery.result import AsyncResult
from app.core.celery_app import celery_app
from app.tasks.collection import poll_device_task
from app.services.vault import store_device_credential
from app.services.collection import collect_device_configuration

router = APIRouter(prefix="/devices", tags=["Devices"])


@router.get("", response_model=List[DeviceOut])
def list_devices(
    group: Optional[str] = Query(None, description="Filter by device group name or UUID"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status (ONLINE, UNREACHABLE, DECOMMISSIONED)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    List all devices with optional filtering by group and status.
    Role: Viewer+
    """
    query = db.query(Device)

    if group:
        # Check if group is a UUID or a group name
        try:
            group_uuid = UUID(group)
            query = query.filter(Device.device_group_id == group_uuid)
        except ValueError:
            query = query.join(DeviceGroup).filter(DeviceGroup.name.ilike(f"%{group}%"))

    if status_filter:
        query = query.filter(Device.status == status_filter.upper())

    devices = query.order_by(Device.hostname.asc()).all()

    result = []
    for d in devices:
        d_out = DeviceOut(
            id=d.id,
            hostname=d.hostname,
            ip_address=d.ip_address,
            vendor=d.vendor,
            model=d.model,
            device_group_id=d.device_group_id,
            status=d.status,
            last_polled_at=d.last_polled_at,
            device_group=d.device_group,
            has_credentials=d.credentials is not None,
        )
        result.append(d_out)

    return result


@router.get("/groups", response_model=List[DeviceGroupOut])
def list_device_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    List all campus device groups.
    Role: Viewer+
    """
    return db.query(DeviceGroup).order_by(DeviceGroup.name.asc()).all()


@router.post("", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
def create_device(
    device_in: DeviceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Add a new network device to the campus inventory.
    Role: Admin only
    """
    # Verify device_group exists
    group = db.query(DeviceGroup).filter(DeviceGroup.id == device_in.device_group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device group with ID {device_in.device_group_id} not found",
        )

    # Check for duplicate hostname or IP
    existing = db.query(Device).filter(
        (Device.hostname == device_in.hostname) | (Device.ip_address == device_in.ip_address)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Device with hostname '{device_in.hostname}' or IP '{device_in.ip_address}' already exists",
        )

    device = Device(
        hostname=device_in.hostname,
        ip_address=device_in.ip_address,
        vendor=device_in.vendor,
        model=device_in.model,
        device_group_id=device_in.device_group_id,
        status=device_in.status.upper(),
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    return DeviceOut(
        id=device.id,
        hostname=device.hostname,
        ip_address=device.ip_address,
        vendor=device.vendor,
        model=device.model,
        device_group_id=device.device_group_id,
        status=device.status,
        last_polled_at=device.last_polled_at,
        device_group=device.device_group,
        has_credentials=False,
    )


@router.get("/{device_id}", response_model=DeviceDetailOut)
def get_device(
    device_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    Retrieve device details including latest configuration snapshot.
    Role: Viewer+
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device with ID {device_id} not found",
        )

    # Fetch latest snapshot if available
    latest_snap = (
        db.query(ConfigurationSnapshot)
        .filter(ConfigurationSnapshot.device_id == device_id)
        .order_by(ConfigurationSnapshot.collected_at.desc())
        .first()
    )

    snapshot_summary = None
    if latest_snap:
        snapshot_summary = SnapshotSummaryOut(
            id=latest_snap.id,
            collected_at=latest_snap.collected_at,
            collection_method=latest_snap.collection_method,
        )

    return DeviceDetailOut(
        id=device.id,
        hostname=device.hostname,
        ip_address=device.ip_address,
        vendor=device.vendor,
        model=device.model,
        device_group_id=device.device_group_id,
        status=device.status,
        last_polled_at=device.last_polled_at,
        device_group=device.device_group,
        has_credentials=device.credentials is not None,
        latest_snapshot=snapshot_summary,
    )


@router.put("/{device_id}", response_model=DeviceOut)
def update_device(
    device_id: UUID,
    device_in: DeviceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Update device metadata.
    Role: Admin only
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device with ID {device_id} not found",
        )

    if device_in.device_group_id is not None:
        group = db.query(DeviceGroup).filter(DeviceGroup.id == device_in.device_group_id).first()
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device group with ID {device_in.device_group_id} not found",
            )
        device.device_group_id = device_in.device_group_id

    if device_in.hostname is not None:
        device.hostname = device_in.hostname
    if device_in.ip_address is not None:
        device.ip_address = device_in.ip_address
    if device_in.vendor is not None:
        device.vendor = device_in.vendor
    if device_in.model is not None:
        device.model = device_in.model
    if device_in.status is not None:
        device.status = device_in.status.upper()

    db.commit()
    db.refresh(device)

    return DeviceOut(
        id=device.id,
        hostname=device.hostname,
        ip_address=device.ip_address,
        vendor=device.vendor,
        model=device.model,
        device_group_id=device.device_group_id,
        status=device.status,
        last_polled_at=device.last_polled_at,
        device_group=device.device_group,
        has_credentials=device.credentials is not None,
    )


@router.delete("/{device_id}", response_model=DeviceOut)
def decommission_device(
    device_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Decommission a network device (sets status to DECOMMISSIONED).
    Role: Admin only
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device with ID {device_id} not found",
        )

    device.status = "DECOMMISSIONED"
    db.commit()
    db.refresh(device)

    return DeviceOut(
        id=device.id,
        hostname=device.hostname,
        ip_address=device.ip_address,
        vendor=device.vendor,
        model=device.model,
        device_group_id=device.device_group_id,
        status=device.status,
        last_polled_at=device.last_polled_at,
        device_group=device.device_group,
        has_credentials=device.credentials is not None,
    )


@router.post("/{device_id}/credentials", response_model=DeviceCredentialOut)
def set_device_credentials(
    device_id: UUID,
    cred_in: DeviceCredentialCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Store encrypted credentials for a network device.
    Encrypts username and secret at rest; never returns plaintext secrets.
    Role: Admin only
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device with ID {device_id} not found",
        )

    cred = store_device_credential(
        db=db,
        device_id=device_id,
        username=cred_in.username,
        secret=cred_in.secret,
        auth_type=cred_in.auth_type,
    )

    return DeviceCredentialOut(
        id=cred.id,
        device_id=cred.device_id,
        auth_type=cred.auth_type,
        secret_ref=cred.secret_ref,
        has_credential=True,
    )


@router.post(
    "/{device_id}/poll",
    response_model=PollTriggerResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def trigger_device_poll(
    device_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Trigger on-demand configuration collection for a device via Celery task.
    Role: NetEng+
    Returns: HTTP 202 Accepted with task reference.
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device with ID {device_id} not found",
        )

    if device.status == "DECOMMISSIONED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot poll a decommissioned device",
        )

    if device.vendor and device.vendor.lower() in ("openconfig_stub", "openconfig", "gnmi"):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                "Vendor 'openconfig_stub': gNMI streaming telemetry support is planned in future release. "
                "See docs/architecture.md §21."
            ),
        )

    try:
        task = poll_device_task.delay(
            str(device_id),
            str(current_user.id) if current_user else None,
        )
        task_id = getattr(task, "id", str(task))
        task_status = "ACCEPTED"
        msg = f"Polling task enqueued for {device.hostname} (Task ID: {task_id})"
        ts = datetime.now(timezone.utc)
        if hasattr(task, "result") and isinstance(task.result, dict):
            task_status = task.result.get("status", "ACCEPTED")
            if "snapshot_id" in task.result:
                msg = f"Configuration successfully collected for {device.hostname} (snapshot ID: {task.result['snapshot_id']})"

        return PollTriggerResponse(
            device_id=device.id,
            hostname=device.hostname,
            status=task_status,
            message=msg,
            timestamp=ts,
            task_id=task_id,
        )
    except (ConnectionError, PermissionError) as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to poll device {device.hostname}: {e}",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to enqueue polling task for {device.hostname}: {e}",
        )


@router.get(
    "/{device_id}/poll-status/{task_id}",
    response_model=PollStatusResponse,
)
def get_poll_task_status(
    device_id: UUID,
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    Check the status of an asynchronous device polling Celery task.
    Role: Viewer+
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device with ID {device_id} not found",
        )

    state = "PENDING"
    result_data = None
    error_msg = None

    try:
        async_res = AsyncResult(task_id, app=celery_app)
        state = async_res.state
        if state == "SUCCESS":
            result_data = async_res.result if isinstance(async_res.result, dict) else {"result": str(async_res.result)}
        elif state == "FAILURE":
            error_msg = str(async_res.result)
    except Exception as e:
        latest_snap = (
            db.query(ConfigurationSnapshot)
            .filter(ConfigurationSnapshot.device_id == device_id)
            .order_by(ConfigurationSnapshot.collected_at.desc())
            .first()
        )
        if latest_snap:
            state = latest_snap.status
            result_data = {
                "status": latest_snap.status,
                "snapshot_id": str(latest_snap.id),
                "device_id": str(device_id),
            }
        else:
            state = "PENDING"
            error_msg = f"Task backend check: {e}"

    return PollStatusResponse(
        task_id=task_id,
        device_id=device_id,
        status=state,
        result=result_data,
        error=error_msg,
    )
