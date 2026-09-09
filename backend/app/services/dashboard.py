"""
Dashboard Aggregation Service
-----------------------------
Computes high-performance aggregate metrics for the dashboard overview per §9 and §14:
- Device inventory breakdown by status.
- Overall compliance percentage with strict §14 NO_BASELINE denominator exclusion.
- Open drift events grouped by taxonomy label.
- Recent 10 alerts and recent 10 remediation executions.
- 14-day daily drift risk score trendline.
"""
from datetime import datetime, timezone, timedelta
from typing import Dict, List
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.devices import Device
from app.models.baselines import Baseline
from app.models.drift import DriftEvent
from app.models.alerts import Alert
from app.models.remediation import RemediationAction, RemediationPlan
from app.schemas.alerts import AlertOut
from app.schemas.dashboard import (
    DashboardSummaryOut,
    RecentRemediationSummary,
    DriftTrendPoint,
)


def calculate_compliance_percentage(
    total_devices: int,
    no_baseline_count: int,
    compliant_count: int,
) -> float:
    """
    CRITICAL COMPLIANCE FORMULA PER §14:
    Devices without an active baseline (NO_BASELINE state) are STRICTLY EXCLUDED
    from the denominator of the compliance calculation:
    
        denominator = total_devices - no_baseline_count
        compliance_percentage = (compliant_count / denominator) * 100
        
    Example:
        10 total devices, 2 NO_BASELINE, 6 compliant, 2 drifted:
        compliance = 6 / (10 - 2) = 6 / 8 = 75.0%, NOT 6 / 10 = 60.0%.
    """
    assessed_denominator = total_devices - no_baseline_count
    if assessed_denominator <= 0:
        return 100.0 if compliant_count == 0 else 0.0
    return round((compliant_count / assessed_denominator) * 100.0, 2)


def get_dashboard_summary(db: Session) -> DashboardSummaryOut:
    """
    Aggregate all dashboard metrics in a single performant service call.
    """
    # 1. Total devices & Status breakdown
    devices = db.query(Device).all()
    total_devices = len(devices)

    devices_by_status: Dict[str, int] = {}
    for d in devices:
        st = d.status or "UNKNOWN"
        devices_by_status[st] = devices_by_status.get(st, 0) + 1

    # 2. Compliance and NO_BASELINE calculation
    # -------------------------------------------------------------------------
    # DEFINITION OF "COMPLIANT DEVICES" IN DASHBOARD NUMERATOR (§9 & §14):
    #
    # A device is counted as COMPLIANT in the numerator ONLY if its latest configuration
    # matches the active golden baseline (i.e. zero open drift events, or its latest
    # open event is explicitly labeled "Compliant").
    #
    # SPECIFIC HANDLING OF "Drift-Authorized" (TICKET-COVERED) EVENTS:
    # A device with an open "Drift-Authorized" event is counted as DRIFTED (NOT compliant)
    # in the compliance numerator.
    #
    # RATIONALE:
    # While an approved change ticket down-weights the display risk score to 1-30 per §12
    # and suppresses critical alerts (signaling an authorized maintenance window or approved
    # variance), the device's running configuration still physically deviates from the
    # approved golden baseline. In network operations and compliance audits, authorized
    # drift represents an active deviation under ticket tracking, not true baseline compliance.
    # To achieve true 100% baseline compliance, the engineer must either revert the device
    # to baseline upon ticket expiry or promote the change into a new baseline version
    # (POST /api/baselines + PUT /api/baselines/{id}/activate).
    # -------------------------------------------------------------------------
    # Preload active baselines by (device_group_id, vendor_lower)
    active_baselines = (
        db.query(Baseline.device_group_id, func.lower(Baseline.vendor))
        .filter(Baseline.is_active == True)
        .all()
    )
    active_baseline_set = {(b[0], b[1]) for b in active_baselines}

    no_baseline_count = 0
    compliant_count = 0
    drifted_count = 0

    for d in devices:
        # Check if device group + vendor has active baseline
        has_baseline = (d.device_group_id, d.vendor.lower()) in active_baseline_set if d.vendor else False

        # Get device's latest drift event
        latest_event = (
            db.query(DriftEvent)
            .filter(DriftEvent.device_id == d.id)
            .order_by(DriftEvent.detected_at.desc())
            .first()
        )

        if not has_baseline or (latest_event and latest_event.label == "NO_BASELINE"):
            no_baseline_count += 1
        elif latest_event and latest_event.status == "OPEN" and latest_event.label != "Compliant":
            # Any open non-compliant drift (including Drift-Authorized) is counted as drifted
            drifted_count += 1
        else:
            # Either latest event is Compliant, or latest drift is RESOLVED / FALSE_POSITIVE, or no drift detected
            compliant_count += 1

    compliance_percentage = calculate_compliance_percentage(
        total_devices=total_devices,
        no_baseline_count=no_baseline_count,
        compliant_count=compliant_count,
    )

    # 3. Open drift events breakdown by label
    drift_by_label: Dict[str, int] = {
        "Non-Compliant (Critical)": 0,
        "Drift-Unauthorized-High": 0,
        "Drift-Unauthorized-Medium": 0,
        "Drift-Unauthorized-Low": 0,
        "Drift-Authorized": 0,
        "NO_BASELINE": 0,
        "Compliant": 0,
    }

    open_label_counts = (
        db.query(DriftEvent.label, func.count(DriftEvent.id))
        .filter(DriftEvent.status == "OPEN")
        .group_by(DriftEvent.label)
        .all()
    )
    for label, count in open_label_counts:
        drift_by_label[label] = count

    # 4. Recent 10 alerts
    recent_alerts_raw = db.query(Alert).order_by(Alert.created_at.desc()).limit(10).all()
    recent_alerts = [AlertOut.model_validate(a) for a in recent_alerts_raw]

    # 5. Recent 10 remediations
    actions_raw = (
        db.query(RemediationAction)
        .options(
            joinedload(RemediationAction.remediation_plan)
            .joinedload(RemediationPlan.drift_event)
            .joinedload(DriftEvent.device)
        )
        .order_by(RemediationAction.executed_at.desc())
        .limit(10)
        .all()
    )

    recent_remediations: List[RecentRemediationSummary] = []
    for act in actions_raw:
        dev_name = None
        if act.remediation_plan and act.remediation_plan.drift_event and act.remediation_plan.drift_event.device:
            dev_name = act.remediation_plan.drift_event.device.hostname
        recent_remediations.append(
            RecentRemediationSummary(
                id=act.id,
                remediation_plan_id=act.remediation_plan_id,
                device_hostname=dev_name,
                result=act.result,
                executed_commands_count=len(act.executed_commands or []),
                executed_at=act.executed_at,
            )
        )

    # 6. 14-day daily drift score trendline
    now_utc = datetime.now(timezone.utc)
    today = now_utc.date()
    trend_points: List[DriftTrendPoint] = []

    for day_offset in range(13, -1, -1):
        target_date = today - timedelta(days=day_offset)
        start_dt = datetime.combine(target_date, datetime.min.time()).replace(tzinfo=timezone.utc)
        end_dt = datetime.combine(target_date, datetime.max.time()).replace(tzinfo=timezone.utc)

        events_on_day = (
            db.query(DriftEvent.risk_score)
            .filter(
                DriftEvent.detected_at >= start_dt,
                DriftEvent.detected_at <= end_dt,
                DriftEvent.label != "NO_BASELINE",
            )
            .all()
        )

        if events_on_day:
            avg = round(sum(e[0] for e in events_on_day) / len(events_on_day), 2)
            count = len(events_on_day)
        else:
            avg = 0.0
            count = 0

        trend_points.append(
            DriftTrendPoint(
                date=target_date.isoformat(),
                average_score=avg,
                event_count=count,
            )
        )

    return DashboardSummaryOut(
        total_devices=total_devices,
        devices_by_status=devices_by_status,
        compliance_percentage=compliance_percentage,
        no_baseline_gap_count=no_baseline_count,
        drift_by_label=drift_by_label,
        recent_alerts=recent_alerts,
        recent_remediations=recent_remediations,
        drift_trend=trend_points,
    )
