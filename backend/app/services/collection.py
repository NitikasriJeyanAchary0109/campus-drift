"""
Configuration Collection Service
--------------------------------
Polls network devices via SSH (Netmiko) using credentials retrieved from VaultService,
retrieves running configurations, invokes Normalization Service, and records snapshots
with comprehensive failure handling per §4, §8, §9, and §14 of architecture.md.
"""
import socket
from datetime import datetime, timezone
from typing import Optional, Tuple
from uuid import UUID

from netmiko import ConnectHandler
from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException
from sqlalchemy.orm import Session

from app.models.devices import Device
from app.models.configurations import ConfigurationSnapshot
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.services.vault import get_device_credential
from app.services.normalization import normalize_config, ParseError


SIMULATED_DEVICES = {
    "sw-classroom-01": {"docker": ("sim_switch_classroom", 22), "local": ("localhost", 2222)},
    "sw-hostel-01": {"docker": ("sim_switch_hostel", 22), "local": ("localhost", 2223)},
    "rtr-lab-01": {"docker": ("sim_router_lab", 22), "local": ("localhost", 2224)},
}


def resolve_device_endpoint(device: Device) -> Tuple[str, int]:
    """
    Resolve network endpoint (host, port) for connection.
    Gracefully routes simulated devices to Docker container hostnames when in container network,
    or localhost:port mappings during host-level testing, and real IP addresses in production.
    """
    if device.hostname in SIMULATED_DEVICES:
        entry = SIMULATED_DEVICES[device.hostname]
        # Check if Docker DNS resolves the container name
        try:
            socket.gethostbyname(entry["docker"][0])
            return entry["docker"]
        except (socket.gaierror, OSError):
            return entry["local"]

    return device.ip_address, 22


def collect_device_configuration(
    db: Session,
    device_id: UUID,
    triggered_by_user_id: Optional[UUID] = None,
) -> ConfigurationSnapshot:
    """
    Perform configuration collection for a specific device:
    1. Look up device and decrypted credentials via VaultService.
    2. Establish SSH connection using Netmiko.
    3. Run 'show running-config' and disconnect cleanly.
    4. Normalize raw configuration into structured JSON key-path tree.
    5. Handle unreachable/auth/timeout/parse errors gracefully without silent skips.
    6. Persist ConfigurationSnapshot and update device polling timestamp and status.
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise ValueError(f"Device with ID {device_id} not found")

    if device.status == "DECOMMISSIONED":
        raise ValueError(f"Cannot poll decommissioned device {device.hostname}")

    # 1. Retrieve credentials from Vault
    cred_tuple = get_device_credential(db, device.id)
    if not cred_tuple:
        device.status = "UNREACHABLE"
        alert = Alert(
            type="DEVICE_DOWN",
            related_id=device.id,
            message=f"Collection failed for {device.hostname}: Missing credentials in vault",
        )
        audit = AuditLog(
            user_id=triggered_by_user_id,
            action="COLLECT_FAILED",
            target_type="device",
            target_id=device.id,
            after_state={"error": "NO_CREDENTIALS"},
        )
        db.add(alert)
        db.add(audit)
        db.commit()
        raise ConnectionError(f"No credentials found for device {device.hostname}")

    username, secret, auth_type = cred_tuple
    host, port = resolve_device_endpoint(device)

    # Device type mapping for Netmiko
    # Simulated devices use cisco_ios CLI prompts
    device_type = "cisco_ios"

    device_params = {
        "device_type": device_type,
        "host": host,
        "port": port,
        "username": username,
        "password": secret,
        "fast_cli": False,
        "timeout": 10,
    }

    # 2. Connect via SSH
    conn = None
    raw_config = ""
    try:
        conn = ConnectHandler(**device_params)
        raw_config = conn.send_command("show running-config")
    except NetmikoTimeoutException as e:
        device.status = "UNREACHABLE"
        alert = Alert(
            type="DEVICE_DOWN",
            related_id=device.id,
            message=f"SSH timeout connecting to {device.hostname} at {host}:{port}: {e}",
        )
        audit = AuditLog(
            user_id=triggered_by_user_id,
            action="COLLECT_TIMEOUT",
            target_type="device",
            target_id=device.id,
            after_state={"error": "TIMEOUT", "endpoint": f"{host}:{port}"},
        )
        db.add(alert)
        db.add(audit)
        db.commit()
        raise ConnectionError(f"SSH timeout connecting to {device.hostname} ({host}:{port})") from e

    except NetmikoAuthenticationException as e:
        device.status = "UNREACHABLE"
        alert = Alert(
            type="DEVICE_DOWN",
            related_id=device.id,
            message=f"SSH authentication failed for {device.hostname} with user '{username}': {e}",
        )
        audit = AuditLog(
            user_id=triggered_by_user_id,
            action="AUTH_FAILURE",
            target_type="device",
            target_id=device.id,
            after_state={"error": "AUTH_FAILURE", "username": username},
        )
        db.add(alert)
        db.add(audit)
        db.commit()
        raise PermissionError(f"Authentication failed for {device.hostname}") from e

    except Exception as e:
        device.status = "UNREACHABLE"
        alert = Alert(
            type="DEVICE_DOWN",
            related_id=device.id,
            message=f"Connection error to {device.hostname}: {e}",
        )
        audit = AuditLog(
            user_id=triggered_by_user_id,
            action="COLLECT_ERROR",
            target_type="device",
            target_id=device.id,
            after_state={"error": str(e)},
        )
        db.add(alert)
        db.add(audit)
        db.commit()
        raise ConnectionError(f"Failed to connect to {device.hostname}: {e}") from e

    finally:
        if conn:
            try:
                conn.disconnect()
            except Exception:
                pass

    # 3. Normalize raw configuration
    snapshot_status = "SUCCESS"
    normalized_json = {}
    try:
        normalized_json = normalize_config(raw_config, device.vendor)
        device.status = "ONLINE"
    except ParseError as pe:
        snapshot_status = "PARSE_ERROR"
        normalized_json = {"status": "PARSE_ERROR", "error": str(pe)}
        alert = Alert(
            type="CRITICAL_DRIFT",
            related_id=device.id,
            message=f"Configuration parse error for {device.hostname}: {pe}",
        )
        audit = AuditLog(
            user_id=triggered_by_user_id,
            action="PARSE_ERROR",
            target_type="device",
            target_id=device.id,
            after_state={"error": str(pe)},
        )
        db.add(alert)
        db.add(audit)

    # 4. Save Configuration Snapshot
    now = datetime.now(timezone.utc)
    snapshot = ConfigurationSnapshot(
        device_id=device.id,
        raw_config=raw_config,
        normalized_json=normalized_json,
        collected_at=now,
        collection_method="SSH",
        status=snapshot_status,
    )
    db.add(snapshot)

    # Update device last_polled_at
    device.last_polled_at = now

    # Audit log successful collection
    if snapshot_status == "SUCCESS":
        audit_success = AuditLog(
            user_id=triggered_by_user_id,
            action="CONFIG_COLLECTED",
            target_type="device",
            target_id=device.id,
            after_state={"snapshot_id": str(snapshot.id), "status": snapshot_status},
        )
        db.add(audit_success)

    db.commit()
    db.refresh(snapshot)

    # 5. Trigger automated drift detection per §4 and §17
    if snapshot_status == "SUCCESS":
        try:
            from app.services.drift import detect_drift
            detect_drift(db=db, device=device, snapshot=snapshot)
        except Exception as e:
            # Per §14: comparison errors caught and logged to audit without crashing collection
            audit_err = AuditLog(
                user_id=triggered_by_user_id,
                action="DRIFT_CHECK_FAILED",
                target_type="device",
                target_id=device.id,
                after_state={"error": str(e)},
            )
            db.add(audit_err)
            db.commit()

    return snapshot
