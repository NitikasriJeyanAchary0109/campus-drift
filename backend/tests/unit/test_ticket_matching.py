"""
Unit Tests for Change Ticket Matching Engine
--------------------------------------------
Tests temporal grace windows, device/group scoping, wildcard matching,
and overlapping ticket specificity resolution per §11 of architecture.md.
"""
from datetime import datetime, timedelta, timezone

import pytest
from app.core.database import Base
from app.models.devices import Device, DeviceGroup
from app.models.tickets import ChangeTicket
from app.services.tickets import find_matching_ticket
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def ticket_env():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = Session()

    group_a = DeviceGroup(name="Classroom", criticality_weight=1.0)
    group_b = DeviceGroup(name="Lab", criticality_weight=1.2)
    db.add_all([group_a, group_b])
    db.commit()

    dev_1 = Device(
        hostname="sw-1",
        ip_address="10.10.1.1",
        vendor="cisco_ios",
        model="Catalyst",
        device_group_id=group_a.id,
    )
    dev_2 = Device(
        hostname="sw-2",
        ip_address="10.10.1.2",
        vendor="cisco_ios",
        model="Catalyst",
        device_group_id=group_a.id,
    )
    db.add_all([dev_1, dev_2])
    db.commit()

    yield db, dev_1, dev_2, group_a, group_b

    db.close()
    Base.metadata.drop_all(bind=engine)


def test_ticket_matching_exact_and_prefix(ticket_env):
    """Test exact and hierarchical prefix key-path matching."""
    db, dev_1, dev_2, group_a, _ = ticket_env
    now = datetime.now(timezone.utc)

    ticket = ChangeTicket(
        ticket_ref="CHG-001",
        device_id=dev_1.id,
        key_path_scope="interface.FastEthernet0/1",
        valid_from=now - timedelta(hours=1),
        valid_to=now + timedelta(hours=1),
        status="OPEN",
    )
    db.add(ticket)
    db.commit()

    # Exact child key path covered by prefix
    match = find_matching_ticket(db, dev_1, "interface.FastEthernet0/1.port_security.enabled", now)
    assert match is not None
    assert match.ticket_ref == "CHG-001"

    # Exact key path match
    match_exact = find_matching_ticket(db, dev_1, "interface.FastEthernet0/1", now)
    assert match_exact is not None

    # Unrelated interface should NOT match
    no_match = find_matching_ticket(db, dev_1, "interface.FastEthernet0/2.port_security.enabled", now)
    assert no_match is None


def test_ticket_matching_grace_period_boundaries(ticket_env):
    """
    Test grace window matching per §11:
    Snapshot collected within valid_to + grace_period matches;
    Snapshot collected outside valid_to + grace_period does not match.
    """
    db, dev_1, _, _, _ = ticket_env
    now = datetime.now(timezone.utc)
    valid_from = now - timedelta(hours=2)
    valid_to = now - timedelta(minutes=45)  # Expired 45 mins ago

    ticket = ChangeTicket(
        ticket_ref="CHG-GRACE",
        device_id=dev_1.id,
        key_path_scope="line.vty.transport_input",
        valid_from=valid_from,
        valid_to=valid_to,
        status="OPEN",
    )
    db.add(ticket)
    db.commit()

    # Default grace is 30 mins: 45 mins expired is outside 30-min window
    match_strict = find_matching_ticket(db, dev_1, "line.vty.transport_input", now, grace_period_minutes=30)
    assert match_strict is None

    # With 60-min grace period: 45 mins expired is covered!
    match_grace = find_matching_ticket(db, dev_1, "line.vty.transport_input", now, grace_period_minutes=60)
    assert match_grace is not None
    assert match_grace.ticket_ref == "CHG-GRACE"


def test_ticket_wrong_device_scope_no_match(ticket_env):
    """Ticket scoped to Device 1 should NOT match Device 2."""
    db, dev_1, dev_2, _, _ = ticket_env
    now = datetime.now(timezone.utc)

    ticket = ChangeTicket(
        ticket_ref="CHG-DEV1-ONLY",
        device_id=dev_1.id,
        key_path_scope="snmp.community.public.exists",
        valid_from=now - timedelta(hours=1),
        valid_to=now + timedelta(hours=1),
        status="OPEN",
    )
    db.add(ticket)
    db.commit()

    # Check against dev_2 (wrong device)
    match = find_matching_ticket(db, dev_2, "snmp.community.public.exists", now)
    assert match is None


def test_overlapping_tickets_specificity_resolution(ticket_env):
    """
    Edge case from evaluation notes:
    When two open tickets cover the same key path (e.g. broad group ticket vs specific device ticket),
    the more specific device ticket MUST be selected.
    """
    db, dev_1, _, group_a, _ = ticket_env
    now = datetime.now(timezone.utc)

    # Ticket 1: Group-scoped, broad wildcard scope
    t_broad = ChangeTicket(
        ticket_ref="CHG-GROUP-BROAD",
        device_id=None,
        device_group_id=group_a.id,
        key_path_scope="interface.*",
        valid_from=now - timedelta(hours=1),
        valid_to=now + timedelta(hours=1),
        status="OPEN",
    )

    # Ticket 2: Specific device, specific key path
    t_specific = ChangeTicket(
        ticket_ref="CHG-DEVICE-SPECIFIC",
        device_id=dev_1.id,
        device_group_id=None,
        key_path_scope="interface.FastEthernet0/1.port_security.enabled",
        valid_from=now - timedelta(hours=1),
        valid_to=now + timedelta(hours=1),
        status="OPEN",
    )

    db.add_all([t_broad, t_specific])
    db.commit()

    match = find_matching_ticket(db, dev_1, "interface.FastEthernet0/1.port_security.enabled", now)
    assert match is not None
    # Specificity resolution chooses the device-specific ticket
    assert match.ticket_ref == "CHG-DEVICE-SPECIFIC"


# --- the change happened between two polls, not at the poll that noticed it ----------------------------------------------
def test_ticket_window_is_matched_against_the_interval_since_the_previous_poll(db_session):
    from datetime import datetime, timedelta
    from app.models.devices import Device, DeviceGroup
    from app.models.tickets import ChangeTicket
    from app.services.tickets import find_matching_ticket
    import uuid
    uid = uuid.uuid4().hex[:6]
    group = DeviceGroup(name=f"G-{uid}", criticality_weight=1.0)
    db_session.add(group)
    db_session.flush()
    device = Device(hostname=f"sw-{uid}", ip_address="10.9.9.9", vendor="cisco_ios", model="x", device_group_id=group.id, status="ONLINE")
    db_session.add(device)
    db_session.flush()
    window_end = datetime(2026, 10, 27, 13, 0)
    db_session.add(ChangeTicket(ticket_ref=f"T-{uid}", source="internal", device_id=device.id, key_path_scope="ntp.server",
                                valid_from=datetime(2026, 10, 27, 11, 0), valid_to=window_end, status="OPEN"))
    db_session.commit()
    poll_after = window_end + timedelta(hours=3)                     # noticed three hours after the window closed
    assert find_matching_ticket(db_session, device, "ntp.server", poll_after) is None
    previous_poll = window_end - timedelta(minutes=30)               # but the previous poll was inside the window
    assert find_matching_ticket(db_session, device, "ntp.server", poll_after, since=previous_poll) is not None
    long_ago = window_end + timedelta(hours=2, minutes=40)           # a previous poll after window+grace: still no match
    assert find_matching_ticket(db_session, device, "ntp.server", poll_after, since=long_ago) is None
