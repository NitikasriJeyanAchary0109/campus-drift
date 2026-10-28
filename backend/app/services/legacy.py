"""
Legacy Workflow Coexistence Service
-----------------------------------
Lets the drift detector run alongside an existing manual / console / TFTP-backup process:

* ``upload_manual_configuration`` ingests an offline ``show running-config`` dump through the
  exact same normalize -> diff -> score -> ticket pipeline as SSH polling, so legacy devices are
  scored consistently with automated ones.
* ``set_collection_mode`` controls how a device is fed (SSH_POLL / MANUAL_UPLOAD / PAUSED) and
  whether the tool may push changes to it (``shadow_mode`` = report-only).
* ``assert_remediation_allowed`` is the single guard the remediation pipeline calls before it
  opens an SSH session to a device.

Error boundaries (HTTP status returned to the caller, DB state left behind):
  404 unknown device            -> nothing written
  400 decommissioned device     -> nothing written
  409 device PAUSED             -> nothing written
  413 payload > MAX_UPLOAD_BYTES -> nothing written
  422 empty / binary / future captured_at / hostname mismatch -> nothing written
  parse failure of otherwise valid text -> PARSE_ERROR snapshot + CRITICAL_DRIFT alert (never silent)
"""
import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.devices import Device
from app.models.drift import DriftEvent
from app.models.users import User
from app.services.collection import ingest_raw_configuration

MAX_UPLOAD_BYTES = 1_048_576  # 1 MiB; real switch configs are typically < 200 KiB
CLOCK_SKEW_TOLERANCE = timedelta(minutes=5)
VALID_MODES = ("SSH_POLL", "MANUAL_UPLOAD", "PAUSED")

_HOSTNAME_RE = re.compile(r"^\s*hostname\s+(\S+)\s*$", re.MULTILINE | re.IGNORECASE)


def _extract_hostname(config_text: str) -> Optional[str]:
    match = _HOSTNAME_RE.search(config_text)
    return match.group(1) if match else None


def _to_utc(value: datetime) -> datetime:
    """Treat naive timestamps as UTC (matches how collection timestamps are stored)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def validate_config_text(config_text: str) -> str:
    """Reject payloads that must never be mistaken for a (compliant) configuration."""
    if len(config_text.encode("utf-8", errors="replace")) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Configuration exceeds the {MAX_UPLOAD_BYTES} byte upload limit",
        )
    if "\x00" in config_text:
        raise HTTPException(
            status_code=422,
            detail="Upload looks like a binary file (NUL bytes found); expected plain-text running-config",
        )
    if not config_text.strip():
        raise HTTPException(
            status_code=422,
            detail="Configuration is empty; an empty upload would otherwise be reported as compliant",
        )
    # Normalize line endings from Windows console captures
    return config_text.replace("\r\n", "\n").replace("\r", "\n")


def upload_manual_configuration(
    db: Session,
    device_id: UUID,
    config_text: str,
    user: User,
    captured_at: Optional[datetime] = None,
    source_filename: Optional[str] = None,
    note: Optional[str] = None,
    allow_hostname_mismatch: bool = False,
) -> dict:
    """Ingest an offline configuration for ``device_id`` and return a summary of the result."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Device with ID {device_id} not found")
    if device.status == "DECOMMISSIONED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot upload a configuration for a decommissioned device")
    if device.collection_mode == "PAUSED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Device {device.hostname} is PAUSED; resume it (collection-mode) before uploading configurations",
        )

    config_text = validate_config_text(config_text)

    now = datetime.now(timezone.utc)
    captured = _to_utc(captured_at) if captured_at else now
    if captured > now + CLOCK_SKEW_TOLERANCE:
        raise HTTPException(
            status_code=422,
            detail="captured_at is in the future",
        )

    # Guard against uploading switch B's config onto switch A
    declared_hostname = _extract_hostname(config_text)
    if (
        declared_hostname
        and declared_hostname.lower() != device.hostname.lower()
        and not allow_hostname_mismatch
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                f"Config declares hostname '{declared_hostname}' but the target device is '{device.hostname}'. "
                "Set allow_hostname_mismatch=true if this is intentional."
            ),
        )

    digest = hashlib.sha256(config_text.encode("utf-8")).hexdigest()
    snapshot = ingest_raw_configuration(
        db=db,
        device=device,
        raw_config=config_text,
        collection_method="MANUAL_UPLOAD",
        triggered_by_user_id=user.id,
        collected_at=captured,
        audit_action="CONFIG_UPLOADED",
        audit_extra={
            "sha256": digest,
            "bytes": len(config_text.encode("utf-8")),
            "source_filename": source_filename,
            "note": note,
            "captured_at": captured.isoformat(),
            "hostname_mismatch_overridden": bool(
                declared_hostname and declared_hostname.lower() != device.hostname.lower()
            ),
        },
    )

    event = (
        db.query(DriftEvent)
        .filter(DriftEvent.device_id == device.id)
        .order_by(DriftEvent.detected_at.desc())
        .first()
    ) if snapshot.status == "SUCCESS" else None

    message = (
        f"Configuration ingested for {device.hostname} (snapshot {snapshot.id})."
        if snapshot.status == "SUCCESS"
        else f"Configuration stored for {device.hostname} but could not be parsed (PARSE_ERROR); a critical alert was raised."
    )
    return {
        "device_id": device.id,
        "hostname": device.hostname,
        "snapshot_id": snapshot.id,
        "snapshot_status": snapshot.status,
        "collection_method": snapshot.collection_method,
        "captured_at": captured,
        "sha256": digest,
        "drift_event_id": event.id if event else None,
        "drift_label": event.label if event else None,
        "risk_score": event.risk_score if event else None,
        "message": message,
    }


def set_collection_mode(
    db: Session,
    device_id: UUID,
    user: User,
    collection_mode: Optional[str] = None,
    shadow_mode: Optional[bool] = None,
) -> Device:
    """Change how a device is fed and whether remediation may be pushed to it (Admin-gated at the API)."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Device with ID {device_id} not found")
    if collection_mode is None and shadow_mode is None:
        raise HTTPException(
            status_code=422,
            detail="Provide collection_mode and/or shadow_mode",
        )
    if collection_mode is not None and collection_mode not in VALID_MODES:
        raise HTTPException(
            status_code=422,
            detail=f"collection_mode must be one of {VALID_MODES}",
        )

    before = {"collection_mode": device.collection_mode, "shadow_mode": device.shadow_mode}
    if collection_mode is not None:
        device.collection_mode = collection_mode
    if shadow_mode is not None:
        device.shadow_mode = shadow_mode
    after = {"collection_mode": device.collection_mode, "shadow_mode": device.shadow_mode}

    db.add(
        AuditLog(
            user_id=user.id,
            action="COLLECTION_MODE_CHANGED",
            target_type="device",
            target_id=device.id,
            before_state=before,
            after_state=after,
        )
    )
    db.commit()
    db.refresh(device)
    return device


def assert_remediation_allowed(device: Device) -> None:
    """
    Raise 409 when the tool must not open a configuration session to ``device``:
    shadow (report-only) devices, and devices that are not SSH-managed (air-gapped / legacy / paused).
    For those, the plan's proposed commands can still be applied by an engineer on the console,
    after which the resulting config is uploaded to verify the fix.
    """
    if device.shadow_mode:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Device {device.hostname} is in shadow mode (report-only); remediation will not be pushed",
        )
    if device.collection_mode != "SSH_POLL":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Device {device.hostname} is in collection mode {device.collection_mode}; "
                "apply the approved commands manually on the console, then upload the resulting config to verify"
            ),
        )
