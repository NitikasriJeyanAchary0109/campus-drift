"""
Baselines API Router
--------------------
Exposes baseline endpoints per §9 of architecture.md:
- GET /api/baselines (Viewer+)
- POST /api/baselines (Admin / NetEng)
- PUT /api/baselines/{id}/activate (Admin only)
- GET /api/baselines/{id}/rules (Viewer+)
- GET /api/baselines/{id} (Viewer+)
"""
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rbac import require_admin, require_neteng, require_viewer
from app.models.baselines import Baseline, BaselineRule
from app.models.users import User
from app.schemas.baselines import (
    BaselineCreate,
    BaselineOut,
    BaselineDetailOut,
    BaselineRuleOut,
    BaselineActivateResponse,
)
from app.services.baseline import create_baseline, activate_baseline

router = APIRouter(prefix="/baselines", tags=["Baselines"])


@router.get("", response_model=List[BaselineOut])
def list_baselines(
    group_id: Optional[UUID] = Query(None, description="Filter by device group UUID"),
    vendor: Optional[str] = Query(None, description="Filter by vendor"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    List baselines with optional filtering by group, vendor, or active status.
    Role: Viewer+
    """
    query = db.query(Baseline)
    if group_id:
        query = query.filter(Baseline.device_group_id == group_id)
    if vendor:
        query = query.filter(Baseline.vendor.ilike(vendor))
    if is_active is not None:
        query = query.filter(Baseline.is_active == is_active)

    baselines = query.order_by(Baseline.created_at.desc()).all()

    result = []
    for b in baselines:
        b_out = BaselineOut(
            id=b.id,
            name=b.name,
            device_group_id=b.device_group_id,
            device_group_name=b.device_group.name if b.device_group else None,
            vendor=b.vendor,
            version=b.version,
            is_active=b.is_active,
            created_by=b.created_by,
            created_at=b.created_at,
            rules_count=len(b.rules),
        )
        result.append(b_out)

    return result


@router.post("", response_model=BaselineDetailOut, status_code=status.HTTP_201_CREATED)
def create_baseline_endpoint(
    baseline_in: BaselineCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Create a new baseline version.
    Accepts JSON body or hybrid YAML payload.
    Auto-increments version and creates baseline with is_active=False by default.
    Activation requires explicit Admin call to PUT /api/baselines/{id}/activate per §9.
    Role: Admin / NetworkEngineer
    """
    try:
        baseline = create_baseline(
            db=db,
            baseline_in=baseline_in,
            creator_user_id=current_user.id,
            activate_on_create=False,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    rules_out = [BaselineRuleOut.model_validate(r) for r in baseline.rules]

    return BaselineDetailOut(
        id=baseline.id,
        name=baseline.name,
        device_group_id=baseline.device_group_id,
        device_group_name=baseline.device_group.name if baseline.device_group else None,
        vendor=baseline.vendor,
        version=baseline.version,
        is_active=baseline.is_active,
        created_by=baseline.created_by,
        created_at=baseline.created_at,
        rules_count=len(baseline.rules),
        rules=rules_out,
    )


@router.get("/{baseline_id}", response_model=BaselineDetailOut)
def get_baseline_detail(
    baseline_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    Get baseline details and all associated rules.
    Role: Viewer+
    """
    baseline = db.query(Baseline).filter(Baseline.id == baseline_id).first()
    if not baseline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Baseline with ID {baseline_id} not found",
        )

    rules_out = [BaselineRuleOut.model_validate(r) for r in baseline.rules]

    return BaselineDetailOut(
        id=baseline.id,
        name=baseline.name,
        device_group_id=baseline.device_group_id,
        device_group_name=baseline.device_group.name if baseline.device_group else None,
        vendor=baseline.vendor,
        version=baseline.version,
        is_active=baseline.is_active,
        created_by=baseline.created_by,
        created_at=baseline.created_at,
        rules_count=len(baseline.rules),
        rules=rules_out,
    )


@router.get("/{baseline_id}/rules", response_model=List[BaselineRuleOut])
def get_baseline_rules(
    baseline_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    List all rules for a specific baseline.
    Role: Viewer+
    """
    baseline = db.query(Baseline).filter(Baseline.id == baseline_id).first()
    if not baseline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Baseline with ID {baseline_id} not found",
        )

    return [BaselineRuleOut.model_validate(r) for r in baseline.rules]


@router.put("/{baseline_id}/activate", response_model=BaselineActivateResponse)
def activate_baseline_endpoint(
    baseline_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Activate a baseline version.
    Deactivates any previously active baseline for that device group + vendor.
    Role: Admin only
    """
    try:
        target, prev_active_id = activate_baseline(db, baseline_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )

    return BaselineActivateResponse(
        message=f"Baseline '{target.name}' v{target.version} activated successfully",
        baseline_id=target.id,
        activated=True,
        previous_active_baseline_id=prev_active_id,
    )
