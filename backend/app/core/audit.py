"""One place to write an audit entry, so every state change is recorded the same way and in the caller's transaction."""
import hashlib
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.audit import AuditLog

# A webhook body is kept in the trail only up to this size; the digest always covers the whole body
MAX_RECORDED_BODY = 8192


def record_audit(
    db: Session,
    action: str,
    target_type: str,
    target_id: Optional[UUID] = None,
    user_id: Optional[UUID] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
) -> AuditLog:
    """Add an audit entry to the session. The caller commits, so the entry and the change succeed or fail together."""
    entry = AuditLog(user_id=user_id, action=action, target_type=target_type, target_id=target_id,
                     before_state=before, after_state=after)
    db.add(entry)
    return entry


def body_evidence(raw: bytes, record_body: bool) -> dict[str, Any]:
    """Digest and size of a received body, plus the body itself (capped) when the sender has been authenticated."""
    evidence: dict[str, Any] = {"body_sha256": hashlib.sha256(raw).hexdigest(), "body_bytes": len(raw)}
    if record_body:
        # PostgreSQL JSONB cannot hold a NUL character
        evidence["body"] = raw[:MAX_RECORDED_BODY].decode("utf-8", errors="replace").replace("\x00", "\ufffd")
        evidence["body_truncated"] = len(raw) > MAX_RECORDED_BODY
    return evidence
