"""Lightweight, bounded, in-process rate limiting (P3.1).

Design goals (from the P3.1 scope):
  * bounded and predictable — a sliding window per key, a hard cap on the
    number of tracked keys (LRU eviction + periodic sweep), and never more
    than ``limit`` recorded events per key, so memory stays bounded;
  * no external service — the app is a single-host, single-worker uvicorn
    process (SQLite backend), so a process-local limiter is correct here;
  * safe client identity — authenticated endpoints key on the user id (from
    the JWT, never client-controlled); unauthenticated endpoints key on the
    client IP drawn from the request peer, with an explicit, opt-in trust of
    ``X-Forwarded-For`` for single-reverse-proxy deployments;
  * deliberate 429s — ``RateLimitExceeded`` carries a ``retry_after`` and the
    routers translate it to an HTTP 429 with a generic detail (no internals).

Known limitation (documented in the P3.1 report): limits are per-process. If
the app is later run with multiple worker processes, each worker keeps its own
window; production should run a single worker (as today) or accept per-worker
limits.
"""

from __future__ import annotations

import math
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Callable, Optional

from fastapi import HTTPException, Request

from app.config import get_settings


@dataclass(frozen=True)
class RateLimitPolicy:
    """A fixed limit over a sliding window, in seconds."""

    limit: int
    window_seconds: float


class RateLimitExceeded(Exception):
    """Raised when a rate limit is exceeded. Carries a retry delay."""

    def __init__(self, retry_after: float) -> None:
        self.retry_after = retry_after
        super().__init__("rate limit exceeded")


class SlidingWindowLimiter:
    """Sliding-window limiter with a bounded, evictable key store.

    Thread-safe (the app is asyncio-based but the critical sections are
    microsecond-level and must not interleave). Time is monotonic so windows
    are unaffected by wall-clock changes.
    """

    def __init__(self, max_keys: int = 10_000) -> None:
        self._max_keys = max_keys
        # key -> _Bucket(window, deque[timestamp]) ; OrderedDict gives LRU eviction.
        self._buckets: "OrderedDict[str, _Bucket]" = OrderedDict()
        self._lock = threading.Lock()
        self._checks_since_sweep = 0

    def _now(self) -> float:
        return time.monotonic()

    def check(self, policy: RateLimitPolicy, key: str) -> None:
        """Record an event for ``key``; raise if the window is over its limit."""
        limit = policy.limit
        window = policy.window_seconds
        if limit <= 0 or window <= 0:
            return

        now = self._now()
        cutoff = now - window

        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                self._evict_if_full()
                bucket = _Bucket(window=window, events=deque())
                self._buckets[key] = bucket
            else:
                bucket.window = window
                self._buckets.move_to_end(key)

            events = bucket.events
            while events and events[0] <= cutoff:
                events.popleft()

            if len(events) >= limit:
                retry_after = window - (now - events[0])
                raise RateLimitExceeded(retry_after=max(0.0, retry_after))

            events.append(now)

            self._checks_since_sweep += 1
            if self._checks_since_sweep >= 1000:
                self._sweep()
                self._checks_since_sweep = 0

    def _evict_if_full(self) -> None:
        """Enforce the key cap: drop fully-expired buckets, then LRU-evict."""
        self._sweep()
        while len(self._buckets) >= self._max_keys:
            self._buckets.popitem(last=False)

    def _sweep(self) -> None:
        """Drop buckets whose window has fully elapsed (empty after pruning)."""
        now = self._now()
        for key in list(self._buckets.keys()):
            bucket = self._buckets[key]
            cutoff = now - bucket.window
            events = bucket.events
            while events and events[0] <= cutoff:
                events.popleft()
            if not events:
                del self._buckets[key]

    def reset(self) -> None:
        """Clear all rate-limit state (used between tests)."""
        with self._lock:
            self._buckets.clear()
            self._checks_since_sweep = 0


class _Bucket:
    __slots__ = ("window", "events")

    def __init__(self, window: float, events: deque) -> None:
        self.window = window
        self.events = events


class KeyedConcurrencyGuard:
    """Bounds how many in-flight operations a key (e.g. one user) may have.

    Used to prevent one user from launching unbounded simultaneous expensive
    operations (e.g. parallel LaTeX compiles) within a single rate window.
    """

    def __init__(self, max_per_key: int) -> None:
        self._max_per_key = max_per_key
        self._counts: dict[str, int] = {}
        self._lock = threading.Lock()

    def acquire(self, key: str) -> bool:
        with self._lock:
            current = self._counts.get(key, 0)
            if current >= self._max_per_key:
                return False
            self._counts[key] = current + 1
            return True

    def release(self, key: str) -> None:
        with self._lock:
            current = self._counts.get(key, 0)
            if current <= 1:
                self._counts.pop(key, None)
            else:
                self._counts[key] = current - 1

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()


# ──────────────────────────────────────────────────────────────────────────────
# Global registry + endpoint-facing helpers
# ──────────────────────────────────────────────────────────────────────────────

def _initial_policies() -> dict[str, RateLimitPolicy]:
    s = get_settings()
    return {
        "auth.login": RateLimitPolicy(s.login_limit_per_ip, s.login_window_seconds),
        "auth.login.account": RateLimitPolicy(
            s.login_limit_per_account, s.login_account_window_seconds
        ),
        "auth.register": RateLimitPolicy(
            s.register_limit_per_ip, s.register_window_seconds
        ),
        "search.start": RateLimitPolicy(
            s.search_start_limit_per_user, s.search_start_window_seconds
        ),
        "docgen.generate": RateLimitPolicy(
            s.docgen_limit_per_user, s.docgen_window_seconds
        ),
        # Anonymous read budget for the public demo plane (/api/public/*); keyed
        # by client IP. Bounded by the same evictable key store as all other
        # scopes, so a crawler cannot exhaust memory or CPU on public reads.
        "public.read": RateLimitPolicy(
            s.public_read_limit_per_ip, s.public_read_window_seconds
        ),
    }


Settings = dict[str, RateLimitPolicy]

_POLICIES: Settings = _initial_policies()
_LIMITER = SlidingWindowLimiter(max_keys=get_settings().rate_limit_max_clients)
DOCGEN_GUARD = KeyedConcurrencyGuard(
    max_per_key=get_settings().docgen_max_concurrent_per_user
)


def check_rate_limit(scope: str, identity: str) -> None:
    """Record an event for ``identity`` under ``scope``; raise on exceed.

    Returns immediately (no state, no denial) when rate limiting is disabled.
    """
    settings = get_settings()
    if not settings.rate_limit_enabled:
        return
    policy = _POLICIES.get(scope)
    if policy is None:
        return
    _LIMITER.check(policy, f"{scope}:{identity}")


def raise_if_rate_limited(scope: str, identity: str) -> None:
    """Enforce a rate limit inside a handler body, raising HTTP 429 on exceed.

    Same as :func:`check_rate_limit` but translates the violation into a
    deliberate, safe 429. Preferred over a dependency when the limit should
    only count requests whose body already validated (e.g. expensive search
    initiation — invalid payloads are rejected with 422 and never reach the
    pipeline, so they must not consume a budget slot).
    """
    try:
        check_rate_limit(scope, identity)
    except RateLimitExceeded as exc:
        raise rate_limit_http_429(exc) from exc


def get_client_ip(request: Request) -> str:
    """Return the client identity used for unauthenticated rate limits.

    Default: the immediate connection peer (request.client.host). When
    ``rate_limit_trust_proxy`` is enabled, the first entry of
    ``X-Forwarded-For`` is trusted instead — which is correct ONLY behind a
    single reverse proxy that itself sets that header (the header is written
    by the proxy, and clients cannot contact the app directly). See config.py
    for the setting comment.
    """
    settings = get_settings()
    if settings.rate_limit_trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    client = request.client
    return client.host if (client and client.host) else "unknown"


def rate_limit_http_429(
    exc: RateLimitExceeded,
    detail: str = "Too many requests. Please try again later.",
) -> HTTPException:
    """Translate a rate-limit violation into a safe, deliberate HTTP 429."""
    retry_after = str(max(1, math.ceil(exc.retry_after)))
    return HTTPException(
        status_code=429,
        detail=detail,
        headers={"Retry-After": retry_after},
    )


def reset() -> None:
    """Clear all limiter state and restore policies from settings (test hook)."""
    _LIMITER.reset()
    DOCGEN_GUARD.reset()
    _POLICIES.clear()
    _POLICIES.update(_initial_policies())


def set_policy(scope: str, limit: int, window_seconds: float) -> None:
    """Override a policy at runtime (test hook)."""
    _POLICIES[scope] = RateLimitPolicy(limit=limit, window_seconds=window_seconds)


# Re-exported for the public surface without exposing internals.
_IdentityProvider = Callable[[Request], str]