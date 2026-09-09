"""
Drift Detection & Risk Scoring Engine
-------------------------------------
Implements the tree-diff comparison, ticket-matching integration, severity scoring,
label taxonomy classification, and evidence generation per §5, §8, §11, and §12 of architecture.md.
"""
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.devices import Device, DeviceGroup
from app.models.configurations import ConfigurationSnapshot
from app.models.baselines import Baseline, BaselineRule
from app.models.tickets import ChangeTicket
from app.models.drift import DriftEvent, DriftDetail
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.services.normalization import values_equal, resolve_wildcard_key_paths
from app.services.tickets import find_matching_ticket
from app.schemas.drift import EvidenceBundle, DriftDetailOut


LABEL_PRIORITY = {
    "Non-Compliant (Critical)": 6,
    "Drift-Unauthorized-High": 5,
    "Drift-Unauthorized-Medium": 4,
    "Drift-Unauthorized-Low": 3,
    "Drift-Authorized": 2,
    "Compliant": 1,
}


@dataclass
class DiffItem:
    rule: BaselineRule
    concrete_key_path: str
    change_type: str  # ADDED / REMOVED / MODIFIED
    expected_value: Optional[str]
    actual_value: Optional[str]
    matched_ticket: Optional[ChangeTicket] = None
    label: Optional[str] = None
    risk_score: Optional[int] = None
    raw_score: Optional[int] = None
    why_it_matters: Optional[str] = None


def generate_why_it_matters(key_path: str, rule_type: str, expected_val: Any, actual_val: Any) -> str:
    """Produce a clear, domain-specific security/compliance rationale for the evidence bundle."""
    lower_path = key_path.lower()
    if "transport_input" in lower_path:
        return (
            f"Insecure management transport '{actual_val}' enabled. Unencrypted protocols transmit "
            f"administrator credentials in cleartext across campus switches, enabling session hijacking."
        )
    if "snmp.community" in lower_path or "public" in lower_path:
        return (
            f"Unauthorized SNMP community string '{actual_val}' active. Allows untrusted hosts to query "
            f"device routing tables, interface counters, and network topology without authentication."
        )
    if "port_security" in lower_path:
        return (
            f"Port security violation on '{key_path}' (expected '{expected_val}', found '{actual_val}'). "
            f"Access ports without strict MAC limiting allow rogue hardware and network tapping."
        )
    if "ntp" in lower_path:
        return (
            f"NTP configuration deviation ('{actual_val}'). Desynchronized system clocks break "
            f"forensic log correlation and undermine campus security auditing."
        )
    if "vlan" in lower_path:
        return (
            f"VLAN segmentation deviation on '{key_path}'. Improper VLAN tags risk leaking isolated traffic "
            f"between student, faculty, and administrative campus subnets."
        )
    return (
        f"Deviation from approved baseline for '{key_path}': expected '{expected_val}', "
        f"detected '{actual_val}'."
    )


def score_diff(severity_weight: int, criticality_weight: float) -> int:
    """Calculate raw risk score: severity_weight * criticality_weight, clamped to 1-100."""
    raw = severity_weight * criticality_weight
    return min(100, max(1, int(round(raw))))


def classify_diff(raw_score: int, hard_compliance: bool, ticket: Optional[ChangeTicket]) -> Tuple[str, int]:
    """
    Classify a diff into taxonomy label and mapped score band per §12:
    - hard_compliance -> Non-Compliant (Critical), score band 95-100 (never suppressed by ticket)
    - ticket matched  -> Drift-Authorized, score band 1-30
    - unmatched:
        raw_score <= 50 -> Drift-Unauthorized-Low (31-50)
        raw_score <= 79 -> Drift-Unauthorized-Medium (51-79)
        raw_score >= 80 -> Drift-Unauthorized-High (80-94)
    """
    if hard_compliance:
        return "Non-Compliant (Critical)", max(95, raw_score)

    if ticket is not None:
        auth_score = min(30, max(1, int(round(raw_score * 0.3))))
        return "Drift-Authorized", auth_score

    if raw_score <= 50:
        return "Drift-Unauthorized-Low", min(50, max(31, raw_score))
    elif raw_score <= 79:
        return "Drift-Unauthorized-Medium", min(79, max(51, raw_score))
    else:
        return "Drift-Unauthorized-High", min(94, max(80, raw_score))


def detect_drift(
    db: Session,
    device: Device,
    snapshot: ConfigurationSnapshot,
    baseline: Optional[Baseline] = None,
) -> Optional[DriftEvent]:
    """
    Execute full drift detection pipeline for a device snapshot against active baseline:
    1. Check for PARSE_ERROR — do not evaluate drift on corrupt configs (§14).
    2. Load active baseline for device group and vendor if not provided.
    3. Evaluate rules (EXACT, REGEX, MUST_EXIST, MUST_NOT_EXIST) with wildcard support.
    4. Match tickets with temporal grace windows and specificity resolution.
    5. Score and classify diffs.
    6. Persist DriftEvent and DriftDetail records.
    7. Generate alerts and evidence bundles for risk_score >= 80.
    """
    # 1. Check for parser failure: avoid false negatives
    if snapshot.status == "PARSE_ERROR":
        return None

    # 2. Retrieve active baseline
    if not baseline:
        baseline = (
            db.query(Baseline)
            .filter(
                Baseline.device_group_id == device.device_group_id,
                func.lower(Baseline.vendor) == device.vendor.lower(),
                Baseline.is_active == True,
            )
            .first()
        )

    if not baseline:
        # Flag device as having NO_BASELINE per §14 (do not report Compliant!)
        group_name = device.device_group.name if device.device_group else "Unknown"
        now = datetime.now(timezone.utc)

        existing_nobase = (
            db.query(DriftEvent)
            .filter(
                DriftEvent.device_id == device.id,
                DriftEvent.status == "OPEN",
                DriftEvent.label == "NO_BASELINE",
            )
            .first()
        )
        if existing_nobase:
            existing_nobase.snapshot_id = snapshot.id
            db.commit()
            db.refresh(existing_nobase)
            return existing_nobase

        event = DriftEvent(
            device_id=device.id,
            snapshot_id=snapshot.id,
            baseline_id=None,
            label="NO_BASELINE",
            risk_score=0,
            underlying_severity=None,
            matched_ticket_id=None,
            status="OPEN",
            detected_at=now,
        )
        db.add(event)
        db.flush()

        alert = Alert(
            type="CRITICAL_DRIFT",
            related_id=event.id,
            message=f"No active baseline configured for device group '{group_name}' and vendor '{device.vendor}' (device: {device.hostname})",
        )
        audit = AuditLog(
            user_id=None,
            action="NO_BASELINE_DETECTED",
            target_type="device",
            target_id=device.id,
            after_state={"status": "NO_BASELINE", "device": device.hostname, "group": group_name},
        )
        db.add(alert)
        db.add(audit)
        db.commit()
        db.refresh(event)
        return event

    normalized_tree = snapshot.normalized_json or {}
    group_criticality = device.device_group.criticality_weight if device.device_group else 1.0

    diffs: List[DiffItem] = []

    # 3. Diff Engine: Evaluate rules
    for rule in baseline.rules:
        concrete_paths = resolve_wildcard_key_paths(normalized_tree, rule.key_path)

        for concrete_path, actual_val in concrete_paths:
            rule_type = rule.rule_type.upper()
            is_diff = False
            change_type = "MODIFIED"

            if rule_type == "MUST_EXIST":
                if actual_val is None or (str(rule.expected_value).lower() == "true" and values_equal(actual_val, "false")):
                    is_diff = True
                    change_type = "REMOVED"

            elif rule_type == "MUST_NOT_EXIST":
                if actual_val is not None and not (str(rule.expected_value).lower() == "false" and values_equal(actual_val, "false")):
                    is_diff = True
                    change_type = "ADDED"

            elif rule_type == "EXACT":
                if not values_equal(actual_val, rule.expected_value):
                    is_diff = True
                    change_type = "REMOVED" if actual_val is None else ("ADDED" if rule.expected_value is None else "MODIFIED")

            elif rule_type == "REGEX":
                if actual_val is None or not re.search(rule.expected_value, str(actual_val)):
                    is_diff = True
                    change_type = "MODIFIED"

            if is_diff:
                # 4. Ticket Matcher
                ticket = find_matching_ticket(
                    db=db,
                    device=device,
                    key_path=concrete_path,
                    timestamp=snapshot.collected_at,
                )

                # 5. Severity scoring & Label classification
                raw_score = score_diff(rule.severity_weight, group_criticality)
                label, mapped_score = classify_diff(raw_score, rule.hard_compliance, ticket)

                why_matters = rule.description or generate_why_it_matters(
                    key_path=concrete_path,
                    rule_type=rule_type,
                    expected_val=rule.expected_value,
                    actual_val=actual_val,
                )

                diff_item = DiffItem(
                    rule=rule,
                    concrete_key_path=concrete_path,
                    change_type=change_type,
                    expected_value=str(rule.expected_value) if rule.expected_value is not None else None,
                    actual_value=str(actual_val) if actual_val is not None else None,
                    matched_ticket=ticket,
                    label=label,
                    risk_score=mapped_score,
                    raw_score=raw_score,
                    why_it_matters=why_matters,
                )
                diffs.append(diff_item)

    # 6. Aggregate into DriftEvent
    now = datetime.now(timezone.utc)

    # Check for an existing OPEN drift event for this device
    existing_event = (
        db.query(DriftEvent)
        .filter(DriftEvent.device_id == device.id, DriftEvent.status == "OPEN")
        .order_by(DriftEvent.detected_at.desc())
        .first()
    )

    if not diffs:
        # Device is fully compliant
        if existing_event:
            existing_event.status = "RESOLVED"
            existing_event.label = "Compliant"
            existing_event.risk_score = 0
            db.commit()
            db.refresh(existing_event)
            return existing_event

        event = DriftEvent(
            device_id=device.id,
            snapshot_id=snapshot.id,
            baseline_id=baseline.id,
            label="Compliant",
            risk_score=0,
            matched_ticket_id=None,
            status="RESOLVED",
            detected_at=now,
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        return event

    # Find dominant diff based on taxonomy priority
    diffs.sort(key=lambda d: (-LABEL_PRIORITY.get(d.label, 0), -d.risk_score))
    dominant_diff = diffs[0]

    event_label = dominant_diff.label
    event_score = max(d.risk_score for d in diffs)
    underlying_sev = max(d.raw_score for d in diffs)
    dominant_ticket = dominant_diff.matched_ticket.id if dominant_diff.matched_ticket else None

    # Check if any ticket authorized the primary drift
    if not dominant_ticket:
        for d in diffs:
            if d.matched_ticket:
                dominant_ticket = d.matched_ticket.id
                break

    previous_score = None
    if existing_event:
        # Re-use persistently open drift event
        previous_score = existing_event.risk_score
        existing_event.snapshot_id = snapshot.id
        existing_event.baseline_id = baseline.id
        existing_event.label = event_label
        existing_event.risk_score = event_score
        existing_event.underlying_severity = underlying_sev
        existing_event.matched_ticket_id = dominant_ticket
        
        # Replace drift details
        db.query(DriftDetail).filter(DriftDetail.drift_event_id == existing_event.id).delete()
        for d in diffs:
            detail = DriftDetail(
                drift_event_id=existing_event.id,
                key_path=d.concrete_key_path,
                expected_value=d.expected_value,
                actual_value=d.actual_value,
                change_type=d.change_type,
                rule_id=d.rule.id,
            )
            db.add(detail)
        event = existing_event
    else:
        # Create fresh drift event
        event = DriftEvent(
            device_id=device.id,
            snapshot_id=snapshot.id,
            baseline_id=baseline.id,
            label=event_label,
            risk_score=event_score,
            underlying_severity=underlying_sev,
            matched_ticket_id=dominant_ticket,
            status="OPEN",
            detected_at=now,
        )
        db.add(event)
        db.flush()

        for d in diffs:
            detail = DriftDetail(
                drift_event_id=event.id,
                key_path=d.concrete_key_path,
                expected_value=d.expected_value,
                actual_value=d.actual_value,
                change_type=d.change_type,
                rule_id=d.rule.id,
            )
            db.add(detail)

    # 7. Alert Deduplication & High-priority threshold alert (score >= 80) per §14
    if event_score >= 80:
        prior_alert = (
            db.query(Alert)
            .filter(Alert.type == "CRITICAL_DRIFT", Alert.related_id == event.id)
            .order_by(Alert.created_at.desc())
            .first()
        )
        # ---------------------------------------------------------------------
        # ALERT DEDUPLICATION (§14):
        # Suppress re-alerting for the same (device, drift_event) pair while
        # status remains OPEN, unless the risk_score has increased since the
        # last alert (escalation trigger).
        #
        # Rationale for escalation-trigger choice:
        # In continuous automated polling, repeatedly firing identical
        # CRITICAL_DRIFT alerts for a known, open issue causes alert fatigue.
        # However, if a device's risk score increases (e.g. from 80 to 95 due
        # to an additional security rule violation), an immediate new alert is
        # generated to inform network engineers of the escalated threat.
        # ---------------------------------------------------------------------
        if not prior_alert or (previous_score is not None and event_score > previous_score):
            alert = Alert(
                type="CRITICAL_DRIFT",
                related_id=event.id,
                message=f"High-priority drift ({event_label}, score: {event_score}) detected on {device.hostname}",
            )
            db.add(alert)

    # Audit log drift event detection
    audit = AuditLog(
        user_id=None,  # Automated system action
        action="DRIFT_DETECTED",
        target_type="drift_event",
        target_id=event.id,
        after_state={
            "device": device.hostname,
            "label": event_label,
            "risk_score": event_score,
            "underlying_severity": underlying_sev,
            "diffs_count": len(diffs),
        },
    )
    db.add(audit)

    db.commit()
    db.refresh(event)
    return event


def build_evidence_bundle(db: Session, event: DriftEvent) -> EvidenceBundle:
    """
    Generate complete evidence bundle for a drift event per §12:
    Includes expected value, actual value, affected device, section/path,
    ticket match status, underlying severity, and why-it-matters narrative.
    """
    device = event.device
    group_name = device.device_group.name if device and device.device_group else "Unknown"

    details_out = []
    summaries = []
    for d in event.details:
        rule = d.rule
        why_matters = (rule.description if rule and rule.description else None) or generate_why_it_matters(
            key_path=d.key_path,
            rule_type=rule.rule_type if rule else "EXACT",
            expected_val=d.expected_value,
            actual_val=d.actual_value,
        )
        details_out.append(
            DriftDetailOut(
                id=d.id,
                key_path=d.key_path,
                expected_value=d.expected_value,
                actual_value=d.actual_value,
                change_type=d.change_type,
                rule_id=d.rule_id,
                why_it_matters=why_matters,
            )
        )
        summaries.append(why_matters)

    why_summary = " ".join(summaries) if summaries else "Configuration conforms to approved baseline."

    matched_ticket = event.matched_ticket
    ticket_ref = matched_ticket.ticket_ref if matched_ticket else None

    return EvidenceBundle(
        event_id=event.id,
        device_hostname=device.hostname if device else "unknown",
        device_ip=device.ip_address if device else "unknown",
        device_group=group_name,
        risk_score=event.risk_score,
        underlying_severity=event.underlying_severity,
        label=event.label,
        is_high_priority=event.risk_score >= 80,
        ticket_matched=matched_ticket is not None,
        ticket_ref=ticket_ref,
        why_it_matters_summary=why_summary,
        details=details_out,
    )
