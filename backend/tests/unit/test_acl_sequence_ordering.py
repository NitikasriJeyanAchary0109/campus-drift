"""
Unit Tests for ACL Sequence Ordering & Overlap Analysis
-------------------------------------------------------
Verifies semantic first-match evaluation, overlap detection, cosmetic reordering,
and ACL_ORDER_SIGNIFICANT classification per Project Review #2 Feedback.
"""
import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy.orm import Session

from app.models.users import Role, User
from app.models.devices import Device, DeviceGroup
from app.models.configurations import ConfigurationSnapshot
from app.models.baselines import Baseline, BaselineRule
from app.services.normalization import normalize_config, values_equal
from app.services.acl_analyzer import (
    parse_acl_rule,
    rules_overlap,
    analyze_acl_permutation,
    to_acl_rule_list,
    is_acl_rule_list,
)
from app.services.drift import detect_drift


def test_acl_cosmetic_reordering_disjoint_rules():
    """
    Test Case A: Cosmetic reordering of disjoint rules produces zero drift.
    10.10.1.0/24 and 10.10.2.0/24 do not overlap in packet space; swapping their order
    has zero impact on first-match packet evaluation.
    """
    exp_rules = [
        "permit 10.10.1.0 0.0.0.255",
        "permit 10.10.2.0 0.0.0.255",
        "deny any",
    ]
    act_rules = [
        "permit 10.10.2.0 0.0.0.255",
        "permit 10.10.1.0 0.0.0.255",
        "deny any",
    ]

    # 1. Overlap analyzer check
    analysis = analyze_acl_permutation(exp_rules, act_rules)
    assert analysis["status"] == "COSMETIC"
    assert analysis["is_drift"] is False
    assert analysis["significant"] is False

    # 2. Normalization values_equal check
    assert values_equal(act_rules, exp_rules) is True


def test_acl_overlapping_rule_swap_permit_deny():
    """
    Test Case B: Overlapping rule swap with conflicting actions (permit vs deny)
    must be classified as ACL_ORDER_SIGNIFICANT drift.
    10.10.1.0/24 is a subset of 10.10.0.0/16; swapping permit and deny flips the verdict
    for all 10.10.1.0/24 packets from PERMIT to DENY.
    """
    exp_rules = [
        "permit 10.10.1.0 0.0.0.255",
        "deny 10.10.0.0 0.0.255.255",
        "permit any",
    ]
    act_rules = [
        "deny 10.10.0.0 0.0.255.255",
        "permit 10.10.1.0 0.0.0.255",
        "permit any",
    ]

    # 1. Overlap analyzer check
    analysis = analyze_acl_permutation(exp_rules, act_rules)
    assert analysis["status"] == "ACL_ORDER_SIGNIFICANT"
    assert analysis["is_drift"] is True
    assert analysis["significant"] is True
    assert "Precedence inversion" in analysis["message"]

    # 2. Normalization values_equal check
    assert values_equal(act_rules, exp_rules) is False


def test_acl_adversarial_fixture_middle_entry_swap():
    """
    Test Case C: Adversarial 3+ entry fixture where top and bottom rules remain unchanged,
    and only the middle overlapping entries swap precedence.
    """
    baseline_acl = [
        "permit host 192.168.1.1",
        "permit 10.10.1.0 0.0.0.255",
        "deny 10.10.0.0 0.0.255.255",
        "permit any",
    ]
    running_acl = [
        "permit host 192.168.1.1",       # Unchanged at index 0
        "deny 10.10.0.0 0.0.255.255",    # Swapped in middle (was index 2, now 1)
        "permit 10.10.1.0 0.0.0.255",    # Swapped in middle (was index 1, now 2)
        "permit any",                    # Unchanged at index 3
    ]

    analysis = analyze_acl_permutation(baseline_acl, running_acl)
    assert analysis["status"] == "ACL_ORDER_SIGNIFICANT"
    assert analysis["is_drift"] is True
    assert analysis["significant"] is True


def test_acl_drift_detection_pipeline_with_db(db_session: Session):
    """
    E2E Drift Detection Engine integration:
    Verifies that detect_drift marks disjoint reordering as Compliant (zero drift),
    and flags overlapping permit/deny inversion with change_type='ACL_ORDER_SIGNIFICANT'.
    """
    # 1. Setup Device & Baseline
    group = DeviceGroup(name="Lab-Routers-ACL", criticality_weight=1.0)
    db_session.add(group)
    db_session.flush()

    device = Device(
        hostname="rtr-lab-acl",
        ip_address="10.10.250.1",
        vendor="cisco_ios",
        model="Cisco 2901",
        device_group_id=group.id,
        status="ONLINE",
    )
    db_session.add(device)
    db_session.flush()

    # Create test user for baseline
    role_admin = db_session.query(Role).filter(Role.name == "Admin").first()
    if not role_admin:
        role_admin = Role(name="Admin")
        db_session.add(role_admin)
        db_session.flush()

    admin = db_session.query(User).filter(User.username == "acl_admin_test").first()
    if not admin:
        admin = User(username="acl_admin_test", password_hash="hash", role_id=role_admin.id, is_active=True)
        db_session.add(admin)
        db_session.flush()

    baseline = Baseline(
        name="Lab ACL Baseline",
        vendor="cisco_ios",
        version=1,
        created_by=admin.id,
        device_group_id=group.id,
        is_active=True,
    )
    db_session.add(baseline)
    db_session.flush()

    rule = BaselineRule(
        baseline_id=baseline.id,
        key_path="access_list_ordered.10",
        rule_type="EXACT",
        expected_value=[
            "permit host 192.168.1.1",
            "permit 10.10.1.0 0.0.0.255",
            "deny 10.10.0.0 0.0.255.255",
            "permit any",
        ],
        severity_weight=90,
        hard_compliance=False,
    )
    db_session.add(rule)
    db_session.commit()

    # Case 1: Cosmetic Reordering of Disjoint Rules (192.168.1.1 and 192.168.2.1)
    cosmetic_tree = {
        "access_list_ordered": {
            "10": [
                "permit 10.10.1.0 0.0.0.255",
                "permit 10.10.2.0 0.0.0.255",
                "deny any",
            ]
        }
    }
    # Update baseline expected value for cosmetic test
    rule.expected_value = [
        "permit 10.10.2.0 0.0.0.255",
        "permit 10.10.1.0 0.0.0.255",
        "deny any",
    ]
    db_session.commit()

    now = datetime.now(timezone.utc)
    snap_cosmetic = ConfigurationSnapshot(
        device_id=device.id,
        raw_config="raw",
        normalized_json=cosmetic_tree,
        status="SUCCESS",
        collected_at=now,
    )
    db_session.add(snap_cosmetic)
    db_session.commit()

    event_cosmetic = detect_drift(db_session, device, snap_cosmetic, baseline)
    assert event_cosmetic is not None
    assert event_cosmetic.label == "Compliant"
    assert event_cosmetic.risk_score == 0
    assert len(event_cosmetic.details) == 0

    # Case 2: Adversarial middle swap of overlapping rules
    adversarial_tree = {
        "access_list_ordered": {
            "10": [
                "permit host 192.168.1.1",
                "deny 10.10.0.0 0.0.255.255",
                "permit 10.10.1.0 0.0.0.255",
                "permit any",
            ]
        }
    }
    rule.expected_value = [
        "permit host 192.168.1.1",
        "permit 10.10.1.0 0.0.0.255",
        "deny 10.10.0.0 0.0.255.255",
        "permit any",
    ]
    db_session.commit()

    snap_adversarial = ConfigurationSnapshot(
        device_id=device.id,
        raw_config="raw",
        normalized_json=adversarial_tree,
        status="SUCCESS",
        collected_at=now,
    )
    db_session.add(snap_adversarial)
    db_session.commit()

    event_adversarial = detect_drift(db_session, device, snap_adversarial, baseline)
    assert event_adversarial is not None
    assert event_adversarial.label == "Drift-Unauthorized-High"
    assert event_adversarial.risk_score >= 80
    assert len(event_adversarial.details) == 1
    assert event_adversarial.details[0].change_type == "ACL_ORDER_SIGNIFICANT"


def test_cisco_ios_parser_preserves_ordered_acls():
    """Verify that normalize_config on Cisco IOS populates both access_list and access_list_ordered."""
    cfg = """
hostname lab-switch
!
access-list 10 permit 10.10.1.0 0.0.0.255
access-list 10 deny 10.10.0.0 0.0.255.255
access-list 10 permit any
!
ip access-list extended LAB_FILTER
 10 permit tcp 10.10.1.0 0.0.0.255 any eq 22
 20 deny ip 10.10.0.0 0.0.255.255 any
 30 permit ip any any
end
"""
    tree = normalize_config(cfg, "cisco_ios")

    # access_list_ordered strictly preserves sequence
    assert tree["access_list_ordered"]["10"] == [
        "permit 10.10.1.0 0.0.0.255",
        "deny 10.10.0.0 0.0.255.255",
        "permit any",
    ]
    assert tree["access_list_ordered"]["LAB_FILTER"] == [
        "10 permit tcp 10.10.1.0 0.0.0.255 any eq 22",
        "20 deny ip 10.10.0.0 0.0.255.255 any",
        "30 permit ip any any",
    ]
