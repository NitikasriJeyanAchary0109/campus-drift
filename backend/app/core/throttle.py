"""
Failed-login throttle: after MAX_FAILURES wrong passwords for the same username from the same address inside WINDOW seconds,
further attempts get HTTP 429 until the window passes. Counters live in Redis (shared by every API process); if Redis is
unreachable the throttle falls back to a per-process counter, so a Redis outage never blocks sign-in.
"""
import logging
import threading
import time
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)


class LoginThrottle:
    def __init__(self, redis_url: Optional[str], max_failures: int = 5, window_seconds: int = 900) -> None:
        self.max_failures = max_failures
        self.window = window_seconds
        self._redis_url = redis_url
        self._redis = None
        self._redis_checked = False
        self._local: Dict[str, Tuple[int, float]] = {}
        self._lock = threading.Lock()

    def _client(self):
        if not self._redis_checked:
            self._redis_checked = True
            if self._redis_url:
                try:
                    import redis
                    client = redis.Redis.from_url(self._redis_url, socket_connect_timeout=0.5, socket_timeout=0.5)
                    client.ping()
                    self._redis = client
                except Exception as exc:
                    logger.warning("Login throttle: Redis unavailable (%s); using a per-process counter", exc)
        return self._redis

    @staticmethod
    def key(username: str, ip: str) -> str:
        return f"login-fail:{username.strip().lower()}:{ip}"

    def retry_after(self, key: str) -> int:
        """Seconds to wait, or 0 when another attempt is allowed."""
        r = self._client()
        if r is not None:
            try:
                count = int(r.get(key) or 0)
                return int(max(r.ttl(key), 1)) if count >= self.max_failures else 0
            except Exception as exc:
                logger.warning("Login throttle: Redis read failed (%s)", exc)
        with self._lock:
            count, expires = self._local.get(key, (0, 0.0))
            if expires <= time.time():
                self._local.pop(key, None)
                return 0
            return int(expires - time.time()) + 1 if count >= self.max_failures else 0

    def record_failure(self, key: str) -> None:
        r = self._client()
        if r is not None:
            try:
                pipe = r.pipeline()
                pipe.incr(key)
                pipe.expire(key, self.window, nx=True)
                pipe.execute()
                return
            except Exception as exc:
                logger.warning("Login throttle: Redis write failed (%s)", exc)
        with self._lock:
            count, expires = self._local.get(key, (0, 0.0))
            if expires <= time.time():
                count, expires = 0, time.time() + self.window
            self._local[key] = (count + 1, expires)

    def reset(self, key: str) -> None:
        r = self._client()
        if r is not None:
            try:
                r.delete(key)
            except Exception:
                pass
        with self._lock:
            self._local.pop(key, None)
