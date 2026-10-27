"""Shared SQLite environment builder for the failure / edge-case tests (no Docker or Postgres needed)."""
from datetime import datetime, timezone
from typing import Any, Dict

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (register tables)
from app.core.database import Base
from app.models.baselines import Baseline, BaselineRule
from app.models.devices import Device, DeviceGroup
from app.models.drift import DriftEvent
from app.models.users import Role, User
from app.services.collection import ingest_raw_configuration

DRIFTED_CFG = """hostname sw-h1
ntp server 10.10.0.1
snmp-server community public RO
snmp-server community campus-ro RO
line vty 0 4
 transport input telnet ssh
 login local
end
"""

CLEAN_CFG = """hostname sw-h1
ntp server 10.10.0.1
snmp-server community campus-ro RO
line vty 0 4
 transport input ssh
 login local
end
"""


def build_env() -> Dict[str, Any]:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Session = sessionmaker(bind=engine, autoflush=False)
    Base.metadata.create_all(bind=engine)
    db = Session()
    roles = {n: Role(name=n) for n in ("Admin", "NetworkEngineer", "Viewer")}
    db.add_all(roles.values())
    db.commit()
    users = {}
    for name, role in (("admin_f", "Admin"), ("neteng_f", "NetworkEngineer"), ("viewer_f", "Viewer")):
        u = User(username=name, password_hash="x", role_id=roles[role].id, is_active=True)
        db.add(u)
        users[role] = u
    db.commit()
    group = DeviceGroup(name="Hostel", criticality_weight=1.0)
    db.add(group)
    db.commit()
    device = Device(hostname="sw-h1", ip_address="10.1.1.1", vendor="cisco_ios", model="m",
                    device_group_id=group.id, status="ONLINE")
    db.add(device)
    db.commit()
    baseline = Baseline(name="b1", device_group_id=group.id, vendor="cisco_ios", version=1, is_active=True,
                        created_by=users["Admin"].id)
    db.add(baseline)
    db.commit()
    db.add_all([
        BaselineRule(baseline_id=baseline.id, key_path="line.vty.transport_input", expected_value="ssh",
                     rule_type="EXACT", severity_weight=90, hard_compliance=True),
        BaselineRule(baseline_id=baseline.id, key_path="snmp.community.public.exists", expected_value="false",
                     rule_type="MUST_NOT_EXIST", severity_weight=95, hard_compliance=True),
        BaselineRule(baseline_id=baseline.id, key_path="ntp.server", expected_value="10.10.0.1", rule_type="EXACT",
                     severity_weight=30, hard_compliance=False),
    ])
    db.commit()
    return {"engine": engine, "Session": Session, "db": db, "users": users, "group": group, "device": device,
            "baseline": baseline}


def open_event(env: Dict[str, Any], config: str = DRIFTED_CFG) -> DriftEvent:
    """Ingest ``config`` through the real pipeline and return the resulting open drift event."""
    ingest_raw_configuration(env["db"], env["device"], config, "CORPUS",
                             collected_at=datetime.now(timezone.utc))
    return env["db"].query(DriftEvent).filter(DriftEvent.status == "OPEN").order_by(DriftEvent.detected_at.desc()).first()
