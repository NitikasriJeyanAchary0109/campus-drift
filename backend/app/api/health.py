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
    redis: str
    environment: str


@router.get("/health", response_model=HealthResponse)
def get_health(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Health check: the API answers, the database accepts a query and Redis (the job queue) answers a ping.
    A degraded dependency is reported in the body and the status field; the call itself still returns 200 so a load balancer can read it.
    """
    db_status = "connected"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"unavailable: {str(e)}"

    redis_status = "connected"
    try:
        import redis
        redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=0.5, socket_timeout=0.5).ping()
    except Exception as e:
        redis_status = f"unavailable: {type(e).__name__}"

    return {
        "status": "ok" if "unavailable" not in db_status and "unavailable" not in redis_status else "degraded",
        "project": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": db_status,
        "redis": redis_status,
        "environment": settings.ENVIRONMENT,
    }
