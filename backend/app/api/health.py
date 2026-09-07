from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any

from app.core.database import get_db
from app.core.config import settings

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: str
    project: str
    version: str
    timestamp: str
    database: str
    environment: str


@router.get("/health", response_model=HealthResponse)
def get_health(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Health check endpoint verifying API service and database connectivity.
    """
    db_status = "connected"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"unavailable: {str(e)}"

    return {
        "status": "ok" if "unavailable" not in db_status else "degraded",
        "project": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": db_status,
        "environment": settings.ENVIRONMENT,
    }
