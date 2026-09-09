"""
Unit Tests for Dashboard Aggregation API
----------------------------------------
Tests unified dashboard summary metrics, taxonomy breakdown, recent alerts/remediations,
14-day trendline, and CRITICAL compliance calculation with NO_BASELINE denominator exclusion
per §9 and §14 of architecture.md.
"""
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.models.users import Role, User
from app.models.devices import DeviceGroup, Device
from app.models.baselines import Baseline
from app.models.configurations import ConfigurationSnapshot
from app.models.drift import DriftEvent
from app.models.alerts import Alert
from app.models.remediation import RemediationPlan, RemediationAction
from app.services.dashboard import calculate_compliance_percentage
from app.main import app


def test_calculate_compliance_percentage_unit():
    """
    Dedicated formula unit test asserting strict §14 denominator exclusion:
    Devices in NO_BASELINE state must NOT be in the denominator!
    """
    # 1. User's exact prompt specification:
    # 10 total devices, 2 NO_BASELINE, 6 compliant, 2 drifted:
    # compliance = 6 / (10 - 2) = 6 / 8 = 75.0%, NOT 6 / 10 = 60.0%.
    score = calculate_compliance_percentage(
        total_devices=10,
        no_baseline_count=2,
        compliant_count=6,
    )
    assert score == 75.0
    assert score != 60.0

    # 2. Edge case: 0 devices in inventory -> 100.0%
    assert calculate_compliance_percentage(0, 0, 0) == 100.0

    # 3. Edge case: All devices in NO_BASELINE state (0 assessed devices) -> 100.0%
    assert calculate_compliance_percentage(5, 5, 0) == 100.0

    # 4. Standard fully compliant network: 8 devices, 0 gap, 8 compliant -> 100.0%
    assert calculate_compliance_percentage(8, 0, 8) == 100.0

    # 5. Half compliant: 4 devices, 0 gap, 2 compliant -> 50.0%
    assert calculate_compliance_percentage(4, 0, 2) == 50.0


@pytest.fixture
def dashboard_test_env():
    """In-memory SQLite test environment for Dashboard API."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = Session()

    # Roles & Users
    r_viewer = Role(name="Viewer")
    db.add(r_viewer)
    db.commit()

    viewer = User(username="viewer_dash", password_hash="hash", role_id=r_viewer.id, is_active=True)
    db.add(viewer)
    db.commit()

    # Groups: Group 1 has active baseline, Group 2 has NO baseline
    g_with_baseline = DeviceGroup(name="Classroom", criticality_weight=1.0)
    g_no_baseline = DeviceGroup(name="Unmanaged_IoT", criticality_weight=0.8)
    db.add_all([g_with_baseline, g_no_baseline])
    db.commit()

    # Active baseline for Classroom / cisco_ios
    base = Baseline(
        name="Classroom-Baseline",
        device_group_id=g_with_baseline.id,
        vendor="cisco_ios",
        version=1,
        is_active=True,
        created_by=viewer.id,
    )
    db.add(base)
    db.commit()

    # Create 10 total devices:
    # - 2 devices in g_no_baseline (NO_BASELINE gap)
    # - 6 compliant devices in g_with_baseline
    # - 2 drifted devices in g_with_baseline
    devices = []
    now = datetime.now(timezone.utc)

    # 2 NO_BASELINE devices
    for i in range(1, 3):
        dev = Device(
            hostname=f"dev-nobaseline-{i:02d}",
            ip_address=f"10.20.1.{i}",
            vendor="cisco_ios",
            model="Catalyst 2960-X",
            device_group_id=g_no_baseline.id,
            status="ONLINE",
        )
        devices.append(dev)

    # 6 Compliant devices
    for i in range(1, 7):
        dev = Device(
            hostname=f"dev-compliant-{i:02d}",
            ip_address=f"10.10.1.{i}",
            vendor="cisco_ios",
            model="Catalyst 2960-X",
            device_group_id=g_with_baseline.id,
            status="ONLINE",
        )
        devices.append(dev)

    # 2 Drifted devices
    for i in range(1, 3):
        dev = Device(
            hostname=f"dev-drifted-{i:02d}",
            ip_address=f"10.10.2.{i}",
            vendor="cisco_ios",
            model="Catalyst 2960-X",
            device_group_id=g_with_baseline.id,
            status="ONLINE",
        )
        devices.append(dev)

    db.add_all(devices)
    db.commit()

    # Add DriftEvents for the 2 drifted devices
    snap = ConfigurationSnapshot(
        device_id=devices[8].id,
        raw_config="raw",
        normalized_json={},
        status="SUCCESS",
    )
    db.add(snap)
    db.commit()

    # Drifted device 1: Non-Compliant (Critical), score 95
    event_crit = DriftEvent(
        device_id=devices[8].id,
        snapshot_id=snap.id,
        baseline_id=base.id,
        label="Non-Compliant (Critical)",
        risk_score=95,
        status="OPEN",
        detected_at=now,
    )
    # Drifted device 2: Drift-Unauthorized-High, score 85
    event_high = DriftEvent(
        device_id=devices[9].id,
        snapshot_id=snap.id,
        baseline_id=base.id,
        label="Drift-Unauthorized-High",
        risk_score=85,
        status="OPEN",
        detected_at=now - timedelta(days=1),
    )
    db.add_all([event_crit, event_high])
    db.commit()

    # Add 12 alerts (to verify recent_alerts caps at 10)
    for i in range(12):
        db.add(
            Alert(
                type="CRITICAL_DRIFT" if i % 2 == 0 else "DEVICE_DOWN",
                message=f"Test alert {i}",
                acknowledged=False,
                created_at=now - timedelta(minutes=i),
            )
        )
    db.commit()

    # Add a remediation action
    plan = RemediationPlan(
        drift_event_id=event_crit.id,
        proposed_commands=["line vty 0 4", "transport input ssh"],
        status="APPLIED",
        created_at=now,
    )
    db.add(plan)
    db.flush()

    action = RemediationAction(
        remediation_plan_id=plan.id,
        executed_commands=plan.proposed_commands,
        result="SUCCESS",
        executed_at=now,
    )
    db.add(action)
    db.commit()

    # API Client & Token
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    token = create_access_token({"sub": str(viewer.id), "username": viewer.username, "role": "Viewer"})

    yield db, client, token

    app.dependency_overrides.clear()
    db.close()


def test_dashboard_summary_endpoint_with_no_baseline_exclusion(dashboard_test_env):
    """
    Test GET /api/dashboard/summary:
    Verifies total_devices, devices_by_status, no_baseline_gap_count,
    and the §14 compliance percentage calculation excluding NO_BASELINE devices.
    """
    db, client, token = dashboard_test_env
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/dashboard/summary", headers=headers)
    assert res.status_code == 200
    data = res.json()

    # 1. Total devices
    assert data["total_devices"] == 10
    assert data["devices_by_status"]["ONLINE"] == 10

    # 2. NO_BASELINE gap count
    assert data["no_baseline_gap_count"] == 2

    # 3. Compliance Percentage:
    # 10 total devices - 2 NO_BASELINE = 8 assessed devices.
    # 6 compliant devices / 8 = 75.0%.
    # MUST NOT be 6 / 10 = 60.0%!
    assert data["compliance_percentage"] == 75.0

    # 4. Open drift events breakdown
    assert data["drift_by_label"]["Non-Compliant (Critical)"] == 1
    assert data["drift_by_label"]["Drift-Unauthorized-High"] == 1
    assert data["drift_by_label"]["Drift-Unauthorized-Medium"] == 0
    assert data["drift_by_label"]["Drift-Unauthorized-Low"] == 0

    # 5. Recent Alerts capped at 10
    assert len(data["recent_alerts"]) == 10

    # 6. Recent Remediations
    assert len(data["recent_remediations"]) == 1
    assert data["recent_remediations"][0]["result"] == "SUCCESS"
    assert data["recent_remediations"][0]["device_hostname"] == "dev-drifted-01"

    # 7. 14-day trend series
    assert len(data["drift_trend"]) == 14
    for point in data["drift_trend"]:
        assert "date" in point
        assert "average_score" in point
        assert "event_count" in point


def test_dashboard_summary_unauthenticated_blocked(dashboard_test_env):
    """Unauthenticated requests to /api/dashboard/summary are rejected with 401 Unauthorized."""
    db, client, token = dashboard_test_env
    res = client.get("/api/dashboard/summary")
    assert res.status_code == 401
