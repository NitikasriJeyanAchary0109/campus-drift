"""
Baseline Management Service
---------------------------
Implements baseline lifecycle, rule validation, auto-incrementing versioning,
active-version exclusivity, and hybrid YAML loading per §8, §9, and §12 of architecture.md.
"""
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
import yaml
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.baselines import Baseline, BaselineRule
from app.models.devices import DeviceGroup
from app.models.users import User
from app.schemas.baselines import BaselineCreate, BaselineRuleCreate


def parse_yaml_baseline(yaml_text: str) -> Dict[str, Any]:
    """Parse raw YAML text conforming to §12 into a validated dictionary."""
    try:
        data = yaml.safe_load(yaml_text)
        if not isinstance(data, dict):
            raise ValueError("YAML content must be a dictionary")
        return data
    except Exception as e:
        raise ValueError(f"Failed to parse YAML baseline: {e}") from e


def get_next_baseline_version(db: Session, device_group_id: UUID, vendor: str) -> int:
    """Auto-increment version per (device_group_id, vendor) combination."""
    max_ver = (
        db.query(func.max(Baseline.version))
        .filter(
            Baseline.device_group_id == device_group_id,
            func.lower(Baseline.vendor) == vendor.lower(),
        )
        .scalar()
    )
    return (max_ver or 0) + 1


def create_baseline(
    db: Session,
    baseline_in: BaselineCreate,
    creator_user_id: UUID,
    activate_on_create: bool = False,
) -> Baseline:
    """
    Create a new baseline and associated rules.
    Supports hybrid YAML input as well as structured JSON.
    Auto-increments version and enforces single active baseline per group+vendor.
    """
    name = baseline_in.name
    device_group_id = baseline_in.device_group_id
    vendor = baseline_in.vendor
    rule_inputs: List[BaselineRuleCreate] = baseline_in.rules or []

    # 1. Handle hybrid YAML input if provided
    if baseline_in.yaml_content:
        parsed_yaml = parse_yaml_baseline(baseline_in.yaml_content)
        name = name or parsed_yaml.get("name")
        vendor = vendor or parsed_yaml.get("vendor")

        # Resolve device group from YAML if not explicitly passed as UUID
        group_identifier = parsed_yaml.get("device_group") or parsed_yaml.get("device_group_name")
        if not device_group_id and group_identifier:
            group = (
                db.query(DeviceGroup)
                .filter(
                    (DeviceGroup.name.ilike(group_identifier))
                    | (DeviceGroup.name.ilike(f"%{group_identifier}%"))
                )
                .first()
            )
            if group:
                device_group_id = group.id

        # Parse and validate rules from YAML through Pydantic
        yaml_rules = parsed_yaml.get("rules", [])
        for r in yaml_rules:
            rule_inputs.append(BaselineRuleCreate(**r))

    # Resolve device group from name if passed in JSON
    if not device_group_id and baseline_in.device_group_name:
        group = (
            db.query(DeviceGroup)
            .filter(DeviceGroup.name.ilike(baseline_in.device_group_name))
            .first()
        )
        if group:
            device_group_id = group.id

    if not name:
        raise ValueError("Baseline 'name' is required")
    if not device_group_id:
        raise ValueError("Valid 'device_group_id' or 'device_group_name' is required")
    if not vendor:
        raise ValueError("Baseline 'vendor' is required")

    # Confirm device group exists
    group = db.query(DeviceGroup).filter(DeviceGroup.id == device_group_id).first()
    if not group:
        raise ValueError(f"DeviceGroup with ID {device_group_id} does not exist")

    # 2. Compute next version number for (device_group_id, vendor)
    vendor_canonical = vendor.lower().strip()
    next_version = get_next_baseline_version(db, device_group_id, vendor_canonical)

    # 3. Enforce single active baseline if activating
    if activate_on_create:
        db.query(Baseline).filter(
            Baseline.device_group_id == device_group_id,
            func.lower(Baseline.vendor) == vendor_canonical,
            Baseline.is_active == True,
        ).update({"is_active": False})

    # 4. Insert baseline record
    baseline = Baseline(
        name=name,
        device_group_id=device_group_id,
        vendor=vendor_canonical,
        version=next_version,
        is_active=activate_on_create,
        created_by=creator_user_id,
    )
    db.add(baseline)
    db.flush()

    # 5. Insert rules
    for r_in in rule_inputs:
        rule = BaselineRule(
            baseline_id=baseline.id,
            key_path=r_in.key_path,
            expected_value=r_in.expected_value,
            rule_type=r_in.rule_type,
            severity_weight=r_in.severity_weight,
            hard_compliance=r_in.hard_compliance,
            description=getattr(r_in, "description", None),
        )
        db.add(rule)

    db.commit()
    db.refresh(baseline)
    return baseline


def activate_baseline(db: Session, baseline_id: UUID) -> Tuple[Baseline, Optional[UUID]]:
    """
    Activate a baseline and deactivate all previous baselines for the same device_group and vendor.
    Returns (activated_baseline, previous_active_baseline_id).
    """
    target = db.query(Baseline).filter(Baseline.id == baseline_id).first()
    if not target:
        raise ValueError(f"Baseline with ID {baseline_id} not found")

    # Find currently active baseline for this group + vendor
    prev_active = (
        db.query(Baseline)
        .filter(
            Baseline.device_group_id == target.device_group_id,
            func.lower(Baseline.vendor) == target.vendor.lower(),
            Baseline.is_active == True,
            Baseline.id != target.id,
        )
        .first()
    )
    prev_active_id = prev_active.id if prev_active else None

    # Deactivate any active baselines for this group + vendor
    db.query(Baseline).filter(
        Baseline.device_group_id == target.device_group_id,
        func.lower(Baseline.vendor) == target.vendor.lower(),
        Baseline.is_active == True,
    ).update({"is_active": False})

    target.is_active = True
    db.commit()
    db.refresh(target)

    return target, prev_active_id
