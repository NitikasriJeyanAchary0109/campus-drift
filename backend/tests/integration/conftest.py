"""Integration tests share three live simulated switches: every test starts from, and leaves, the pristine device configuration."""
import subprocess

import pytest
from app.core.config import settings
from app.models.devices import Device
from app.services.remediation import _connect_to_device


_CONSOLES = {"sw-hostel-01": ("sim_switch_hostel", "hostel_switch.cfg"), "sw-classroom-01": ("sim_switch_classroom", "classroom_switch.cfg")}


def _console_reset(hostname: str) -> None:
    """A simulated switch that refuses SSH cannot be reset over SSH; restore its pristine file through docker, as a console would."""
    container, cfg = _CONSOLES.get(hostname, (None, None))
    if not container:
        return
    try:
        # write through the shell redirect and keep the file world-writable: the simulator runs as an unprivileged user, and a root-owned
        # read-only copy would make every later configuration change silently do nothing
        subprocess.run(["docker", "exec", container, "sh", "-c", f"cat /etc/network/{cfg}.pristine > /etc/network/{cfg} && chmod 777 /etc/network/{cfg}"],
                       capture_output=True, timeout=20, check=False)
    except Exception:
        pass  # no docker here: the test that needs the device reports it


@pytest.fixture(autouse=True)
def fast_remediation_retries(monkeypatch):
    monkeypatch.setattr(settings, "ROLLBACK_RETRY_DELAY_SECONDS", 0.0)
    monkeypatch.setattr(settings, "ROLLBACK_AUTO_RETRIES", 0)
    yield


@pytest.fixture(autouse=True)
def no_live_remediation_plans(db_session):
    """
    One live plan per problem is enforced, and these tests each write their own plan for the same simulated switch. Plans left over
    from earlier runs (or from using the dashboard on this database) are closed first. Only the status changes: commands, approvals
    and the audit trail are untouched.
    """
    from sqlalchemy import text
    db_session.execute(text("UPDATE remediation_plans SET status = 'REJECTED' WHERE status IN ('PENDING', 'APPROVED')"))
    db_session.commit()
    yield


@pytest.fixture(autouse=True)
def pristine_simulated_switches(db_session):
    devices = db_session.query(Device).filter(Device.hostname.in_(["sw-hostel-01", "sw-classroom-01"])).all()

    def _reset():
        for device in devices:
            try:
                conn = _connect_to_device(db_session, device)
                conn.send_command("simulator-reset-pristine")
                conn.disconnect()
            except Exception:
                _console_reset(device.hostname)  # SSH refused (a lockout scenario went wrong): use the out-of-band console

    _reset()
    yield
    _reset()
