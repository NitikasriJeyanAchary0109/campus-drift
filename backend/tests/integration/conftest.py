"""Integration tests share three live simulated switches: every test starts from, and leaves, the pristine device configuration."""
import pytest
from app.core.config import settings
from app.models.devices import Device
from app.services.remediation import _connect_to_device


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
                pass  # a device that is down is reported by the test that needs it

    _reset()
    yield
    _reset()
