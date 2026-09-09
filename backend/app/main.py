from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.health import router as health_router
from app.api.auth import router as auth_router
from app.api.devices import router as devices_router
from app.api.baselines import router as baselines_router
from app.api.tickets import router as tickets_router
from app.api.drift import router as drift_router
from app.api.remediation import router as remediation_router
from app.api.approvals import router as approvals_router
from app.api.alerts import router as alerts_router
from app.api.audit import router as audit_router
from app.api.dashboard import router as dashboard_router

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Network Configuration-Drift Detector with Approved-Baseline and Remediation for Campus Networks",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# CORS Middleware setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health routes exposed at both /health and /api/health for flexible proxying
app.include_router(health_router)
app.include_router(health_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(devices_router, prefix="/api")
app.include_router(baselines_router, prefix="/api")
app.include_router(tickets_router, prefix="/api")
app.include_router(drift_router, prefix="/api")
app.include_router(remediation_router, prefix="/api")
app.include_router(approvals_router, prefix="/api")
app.include_router(alerts_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")


@app.get("/")
def root():
    return {
        "message": f"Welcome to {settings.PROJECT_NAME}",
        "docs": "/docs",
        "health": "/health",
        "version": settings.VERSION,
    }
