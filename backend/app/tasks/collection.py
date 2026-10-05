"""
Celery background tasks for asynchronous device collection and periodic polling.
"""
import logging
from typing import Optional, Dict, Any, List
from uuid import UUID

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.models.devices import Device
from app.services.collection import collect_device_configuration

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.collection.poll_device_task")
def poll_device_task(
    self,
    device_id: str,
    triggered_by_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Asynchronously collect configuration from a device via SSH, normalize it,
    and trigger drift detection.
    """
    logger.info("Executing async poll task for device ID: %s (task: %s)", device_id, self.request.id)
    db = SessionLocal()
    try:
        snapshot = collect_device_configuration(
            db=db,
            device_id=UUID(device_id),
            triggered_by_user_id=UUID(triggered_by_user_id) if triggered_by_user_id else None,
        )
        return {
            "status": snapshot.status,
            "snapshot_id": str(snapshot.id),
            "device_id": device_id,
            "collected_at": snapshot.collected_at.isoformat() if snapshot.collected_at else None,
            "message": f"Configuration collected (snapshot: {snapshot.id}) with status {snapshot.status}",
        }
    except Exception as exc:
        logger.error("Failed async poll task for device %s: %s", device_id, exc)
        return {
            "status": "FAILED",
            "device_id": device_id,
            "error": str(exc),
            "message": f"Polling failed for device {device_id}: {exc}",
        }
    finally:
        db.close()


@celery_app.task(name="app.tasks.collection.poll_all_devices_task")
def poll_all_devices_task() -> List[str]:
    """
    Periodic sweep: enqueues individual polling tasks for all active devices.
    """
    db = SessionLocal()
    try:
        devices = db.query(Device).filter(Device.status != "DECOMMISSIONED").all()
        task_ids = []
        for dev in devices:
            task = poll_device_task.delay(str(dev.id))
            task_ids.append(task.id)
        logger.info("Enqueued %d device polling tasks", len(task_ids))
        return task_ids
    finally:
        db.close()
