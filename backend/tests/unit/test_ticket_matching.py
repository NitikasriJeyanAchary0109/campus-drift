"""
Unit Tests for Change Ticket Matching Engine
--------------------------------------------
Tests temporal grace windows, device/group scoping, wildcard matching,
and overlapping ticket specificity resolution per §11 of architecture.md.
"""
import uuid
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.devices import DeviceGroup, Device
from app.models.tickets import ChangeTicket
from app.services.tickets import find_matching_ticket


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
