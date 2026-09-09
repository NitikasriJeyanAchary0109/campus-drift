"""
Dashboard API Router
--------------------
Exposes unified endpoint for frontend dashboard overview per §9 and §14 of architecture.md.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rbac import require_viewer
from app.models.users import User
from app.schemas.dashboard import DashboardSummaryOut
from app.services.dashboard import get_dashboard_summary

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/summary", response_model=DashboardSummaryOut)
def api_get_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    Retrieve unified dashboard summary: total devices, status breakdown,
    compliance percentage (excluding NO_BASELINE devices per §14),
    actionable baseline gap count, taxonomy breakdown, recent alerts,
    recent remediations, and 14-day trend series.
    Role: Viewer+ (§9)
    """
    return get_dashboard_summary(db)
