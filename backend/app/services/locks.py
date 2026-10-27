"""
Per-device mutual exclusion
---------------------------
A poll must not run while a remediation is pushing to the same device (it would snapshot a half-changed
configuration and raise a bogus drift event), and two workers must not poll the same device at once
(duplicate snapshots / drift events). Both take this lock.

On PostgreSQL it is a session-level advisory lock held on a *dedicated* autocommit connection: advisory locks
belong to a connection, and the ORM session releases and re-acquires connections at every commit, so the lock
must not live on the session's own connection. If the process dies, the connection closes and the lock is
released by the server. On other dialects (SQLite in unit tests, single process) the lock is a no-op.
"""
import contextlib
import hashlib
from typing import Iterator
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


class DeviceBusyError(RuntimeError):
    """Another poll or remediation currently holds the device."""


def _lock_key(device_id: UUID) -> int:
    digest = hashlib.sha256(f"campus-drift-device:{device_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


@contextlib.contextmanager
def device_lock(db: Session, device_id: UUID) -> Iterator[bool]:
    """Yield True if the lock was acquired (and hold it for the block), False if the device is busy."""
    engine = db.get_bind()
    if engine.dialect.name != "postgresql":
        yield True
        return
    key = _lock_key(device_id)
    conn = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    acquired = False
    try:
        acquired = bool(conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key}).scalar())
        yield acquired
    finally:
        try:
            if acquired:
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
        finally:
            conn.close()
