from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "campus_drift",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.tasks.collection"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_always_eager=settings.CELERY_TASK_ALWAYS_EAGER,
    task_eager_propagates=True,
)

celery_app.conf.beat_schedule = {
    "periodic-device-poll-all": {
        "task": "app.tasks.collection.poll_all_devices_task",
        "schedule": settings.CELERY_POLL_INTERVAL_SECONDS,
    },
}
