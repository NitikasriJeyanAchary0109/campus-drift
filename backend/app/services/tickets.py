"""
Change Ticket Matching Service
------------------------------
Matches configuration diff key-paths and devices to authorized change tickets
using temporal grace windows and specificity-based resolution per §8 and §11 of architecture.md.
"""
import fnmatch
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_

from app.models.tickets import ChangeTicket
from app.models.devices import Device


def _scope_covers_key_path(scope: str, key_path: str) -> bool:
    """
    Check if a ticket's key_path_scope covers the diff's concrete key path:
    - Exact match
    - Prefix match (e.g. 'interface.FastEthernet0/1' covers 'interface.FastEthernet0/1.port_security.enabled')
    - Glob/wildcard match (e.g. 'interface.*.port_security.*' or '*')
    """
    if not scope or not key_path:
        return False
    if scope == "*" or scope == key_path:
        return True
    if key_path.startswith(scope.rstrip(".") + "."):
        return True
    if fnmatch.fnmatch(key_path, scope):
        return True
    return False


def find_matching_ticket(
    db: Session,
    device: Device,
    key_path: str,
    timestamp: datetime,
    grace_period_minutes: int = 30,
) -> Optional[ChangeTicket]:
    """
    Find the best matching change ticket that authorizes a configuration deviation:
    1. Filter OPEN tickets whose temporal window (valid_from to valid_to +/- grace window) includes timestamp.
    2. Filter tickets matching device scope (device_id == device.id, or group scope).
    3. Filter tickets whose key_path_scope covers the diff key_path.
    4. Resolve overlapping tickets deterministically by specificity:
       - Device-scoped over group/global-scoped
       - More specific key_path_scope (length / depth)
       - Closest valid_from
    """
    grace = timedelta(minutes=grace_period_minutes)
    window_start = timestamp - grace
    window_end = timestamp + grace

    # Query candidate open tickets in time window
    candidates: List[ChangeTicket] = (
        db.query(ChangeTicket)
        .filter(
            ChangeTicket.status == "OPEN",
            ChangeTicket.valid_from <= window_end,
            ChangeTicket.valid_to >= window_start,
        )
        .all()
    )

    matching_tickets = []
    for t in candidates:
        # Check device scope
        if t.device_id and t.device_id != device.id:
            continue
        if not t.device_id and t.device_group_id and t.device_group_id != device.device_group_id:
            continue

        # Check key path scope
        if _scope_covers_key_path(t.key_path_scope, key_path):
            matching_tickets.append(t)

    if not matching_tickets:
        return None

    # Resolve overlapping tickets by specificity:
    # 1. Device-specific (weight 2) vs Group-specific (weight 1) vs Global (weight 0)
    # 2. Length of key_path_scope (longer = more specific)
    # 3. Absolute time difference from timestamp to valid_from
    def ticket_sort_key(t: ChangeTicket):
        device_specificity = 2 if t.device_id else (1 if t.device_group_id else 0)
        scope_length = len(t.key_path_scope)
        # normalize naive/aware timestamps
        t_from = t.valid_from.replace(tzinfo=timezone.utc) if t.valid_from.tzinfo is None else t.valid_from
        ts = timestamp.replace(tzinfo=timezone.utc) if timestamp.tzinfo is None else timestamp
        time_diff = abs((ts - t_from).total_seconds())
        return (-device_specificity, -scope_length, time_diff)

    matching_tickets.sort(key=ticket_sort_key)
    return matching_tickets[0]
