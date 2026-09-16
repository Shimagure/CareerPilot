"""P3.1 tests: abuse controls and resource-exhaustion hardening.

Required coverage:
  - below-threshold requests are allowed
  - HTTP 429 after the threshold, with a safe Retry-After, no internals leaked
  - rate-limit state never grows without bound (LRU cap + pruning)
  - login / registration abuse protection (per-IP, per-account)
  - search initiation + docgen abuse protection (per-user) and concurrency
  - authenticated users cannot bypass by changing client-controlled identifiers
  - legitimate flows stay functional under the default policies
  - unauthenticated rate-limited endpoints stay unauthenticated-safe

Regression for the P1 boundary and P2 config lives in test_security_boundary.py
and test_config.py respectively (validated in the P3.1 test run).
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch

from app.main import app
from app.database import get_db_manager
from app.models.database_models import (
    CandidateProfile,
    SearchPreferences,
    User,
    UserStatus,
)
from app.auth import hash_password
from app.config import Settings, get_settings
from app import rate_limit
from app.rate_limit import RateLimitPolicy, RateLimitExceeded, SlidingWindowLimiter
from app.services import application_assistant
from app.services.application_assistant import GeneratedDocuments


# A job present in the fixture global dataset (mirrors test_applications.py).
JOB = {
    "stable_id": "abc123",
    "title": "IT Support Specialist",
    "company": "Test Corp",
    "location": "Remote",
    "salary": "PHP 30,000 a month",
    "url": "https://example.com/job/1",
    "portal": "testportal",
    "arrangement": "remote",
    "work_mode": "remote",
    "processing_state": "ACTIVE_VERIFIED",
    "first_seen": "2026-08-20",
    "last_verified": "2026-08-25T10:00:00Z",
}


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures (same per-test isolation pattern as the other backend test modules)
# ──────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="function")
async def db_manager():
    db_path = os.path.join(tempfile.gettempdir(), f"test_rate_limit_db_{uuid.uuid4().hex}.db")
    manager = get_db_manager()
    manager._engine = None
    manager._session_factory = None
    manager.initialize(f"sqlite+aiosqlite:///{db_path}", echo=False)
    await manager.create_all()
    yield manager
    await manager.drop_all()
    await manager.close()
    if os.path.exists(db_path):
        os.unlink(db_path)


@pytest_asyncio.fixture(scope="function")
async def client(db_manager):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def store_files(tmp_path, monkeypatch):
    """Point the DataStore at isolated fixture files (global job dataset)."""
    from app import store
    from app.config import ACTIVE_POOL_STATES

    files = {
        "canonical": tmp_path / "canonical_jobs.json",
        "seen": tmp_path / "seen_jobs.json",
        "ranked": tmp_path / "ranked_jobs.json",
        "tracker": tmp_path / "job_search_tracker.csv",
        "checkpoints": tmp_path / "checkpoints.json",
    }
    files["canonical"].write_text(json.dumps([JOB]), encoding="utf-8")
    files["seen"].write_text(json.dumps({"seen": {JOB["stable_id"]: JOB}}), encoding="utf-8")
    files["ranked"].write_text(json.dumps([]), encoding="utf-8")
    files["tracker"].write_text("", encoding="utf-8")
    files["checkpoints"].write_text(json.dumps({}), encoding="utf-8")

    from app.config import (  # re-import within fixture scope to match module
        CANONICAL_JOBS_FILE, SEEN_JOBS_FILE, RANKED_JOBS_FILE, TRACKER_FILE, CHECKPOINTS_FILE)
    monkeypatch.setattr(store, "CANONICAL_JOBS_FILE", files["canonical"])
    monkeypatch.setattr(store, "SEEN_JOBS_FILE", files["seen"])
    monkeypatch.setattr(store, "RANKED_JOBS_FILE", files["ranked"])
    monkeypatch.setattr(store, "TRACKER_FILE", files["tracker"])
    monkeypatch.setattr(store, "CHECKPOINTS_FILE", files["checkpoints"])
    monkeypatch.setattr(store, "STALE_JOB_DAYS", 28)
    monkeypatch.setattr(store, "ACTIVE_POOL_STATES", ACTIVE_POOL_STATES)

    store.invalidate_store_cache()
    yield files
    store.invalidate_store_cache()


@pytest.fixture
def generated_docs_root(tmp_path, monkeypatch):
    """Point the applications router's project root at an isolated temp tree."""
    from app.routers import applications as applications_router

    (tmp_path / "data" / "generated").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(applications_router, "get_project_root", lambda: tmp_path)
    return tmp_path


async def create_user(email: str) -> User:
    async with get_db_manager().session() as session:
        user = User(
            name="Test User",
            email=email,
            password_hash=hash_password("password123"),
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def create_profile(user_id: str) -> CandidateProfile:
    async with get_db_manager().session() as session:
        profile = CandidateProfile(
            user_id=user_id,
            full_name="Test Candidate",
            headline="IT Support Specialist",
            professional_summary="Experience in end-user computing.",
            skills=json.dumps(["IT Support", "Microsoft 365"]),
            experience=json.dumps([{"role": "EUC Technician", "company": "Solaire"}]),
        )
        session.add(profile)
        await session.commit()
        await session.refresh(profile)
        return profile


async def create_preferences(user_id: str) -> SearchPreferences:
    async with get_db_manager().session() as session:
        pref = SearchPreferences(
            user_id=user_id,
            target_roles=json.dumps(["IT Support"]),
            preferred_locations=json.dumps(["Metro Manila"]),
            excluded_keywords=json.dumps([]),
            remote_ok=True,
            ncr_only=True,
            salary_min=30000,
            salary_max=50000,
            salary_currency="PHP",
            salary_period="monthly",
            day_shift_ok=True,
            career_direction="EUC / IT Support",
        )
        session.add(pref)
        await session.commit()
        await session.refresh(pref)
        return pref


async def auth_header(client, email: str) -> dict:
    resp = await client.post("/api/auth/login", json={"email": email, "password": "password123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _make_fake_docgen(generated_dir: Path, gate: asyncio.Event | None = None):
    """Fake generate_application_documents: fast, no LaTeX, optional gate."""
    async def _fake(profile, job_title="", company="", generate_cv=True, generate_cover=True, job_stable_id=None):
        if gate is not None:
            await gate.wait()
        out_dir = generated_dir / "data" / "generated"
        out_dir.mkdir(parents=True, exist_ok=True)
        base = job_stable_id or "job"
        cv_path = out_dir / f"{base}_cv.pdf"
        cover_path = out_dir / f"{base}_cover.pdf"
        if generate_cv:
            cv_path.write_bytes(b"%PDF-1.4 fake")
        if generate_cover:
            cover_path.write_bytes(b"%PDF-1.4 fake")
        return GeneratedDocuments(
            cv_success=generate_cv,
            cover_letter_success=generate_cover,
            cv_path=cv_path if generate_cv else None,
            cover_letter_path=cover_path if generate_cover else None,
            cv_error=None,
            cover_letter_error=None,
        )
    return _fake


# ──────────────────────────────────────────────────────────────────────────────
# Limiter semantics (no HTTP, no DB)
# ──────────────────────────────────────────────────────────────────────────────

class TestSlidingWindowLimiter:
    """The in-process limiter is bounded and enforces thresholds correctly."""

    def test_below_threshold_allowed(self):
        rate_limit.set_policy("test.scope", 3, 3600)
        for _ in range(3):
            rate_limit.check_rate_limit("test.scope", "client-A")

    def test_429_after_threshold_raises_with_retry_after(self):
        rate_limit.set_policy("test.scope", 3, 3600)
        for _ in range(3):
            rate_limit.check_rate_limit("test.scope", "client-A")
        with pytest.raises(RateLimitExceeded) as exc_info:
            rate_limit.check_rate_limit("test.scope", "client-A")
        assert exc_info.value.retry_after > 0

    def test_window_slides_and_recovers(self):
        rate_limit.set_policy("test.scope", 1, 0.2)
        rate_limit.check_rate_limit("test.scope", "client-A")
        with pytest.raises(RateLimitExceeded):
            rate_limit.check_rate_limit("test.scope", "client-A")
        time.sleep(0.25)
        rate_limit.check_rate_limit("test.scope", "client-A")  # window elapsed → allowed

    def test_state_does_not_grow_without_bound(self):
        """LRU key cap keeps tracked state bounded even under churn."""
        limiter = SlidingWindowLimiter(max_keys=10)
        policy = RateLimitPolicy(limit=5, window_seconds=3600)
        for i in range(200):
            limiter.check(policy, f"key-{i % 50}")  # 50 distinct keys, repeated
        # Never more than max_keys buckets; events per bucket never exceed limit.
        assert len(limiter._buckets) <= 10
        total_events = sum(len(b.events) for b in limiter._buckets.values())
        assert total_events <= 10 * 5

    def test_expired_buckets_are_pruned(self):
        limiter = SlidingWindowLimiter(max_keys=100)
        policy = RateLimitPolicy(limit=1, window_seconds=0.1)
        limiter.check(policy, "k")
        assert len(limiter._buckets) == 1
        time.sleep(0.2)
        limiter.check(policy, "k")  # access prunes the expired event
        assert len(limiter._buckets) == 1
        assert len(limiter._buckets["k"].events) == 1

    def test_distinct_keys_are_independent(self):
        rate_limit.set_policy("test.scope", 1, 3600)
        rate_limit.check_rate_limit("test.scope", "a")
        rate_limit.check_rate_limit("test.scope", "b")  # different key → allowed

    def test_scopes_are_independent(self):
        rate_limit.set_policy("test.one", 1, 3600)
        rate_limit.set_policy("test.two", 1, 3600)
        rate_limit.check_rate_limit("test.one", "client")
        rate_limit.check_rate_limit("test.two", "client")  # different scope limit


# ──────────────────────────────────────────────────────────────────────────────
# Login + registration abuse protection (per-IP and per-account)
# ──────────────────────────────────────────────────────────────────────────────

class TestLoginRateLimit:
    """Login is throttled per client IP and per targeted account."""

    async def _attempt_login(self, client, email, **overrides):
        return await client.post(
            "/api/auth/login",
            json={"email": email, "password": overrides.get("password", "password123")},
        )

    async def test_below_threshold_allowed(self, client):
        rate_limit.set_policy("auth.login", 3, 60)
        for email in ("a@example.com", "b@example.com", "c@example.com"):
            resp = await self._attempt_login(client, email)
            assert resp.status_code == 401  # wrong/unknown creds, NOT rate-limited

    async def test_429_after_threshold(self, client):
        rate_limit.set_policy("auth.login", 3, 60)
        for i in range(3):
            resp = await self._attempt_login(client, f"u{i}@example.com")
            assert resp.status_code == 401
        fourth = await self._attempt_login(client, "u4@example.com")
        assert fourth.status_code == 429, fourth.text

    async def test_rotating_accounts_cannot_bypass_ip_throttle(self, client):
        """Per-IP throttle still fires even when each attempt targets a new account."""
        rate_limit.set_policy("auth.login", 3, 60)
        rate_limit.set_policy("auth.login.account", 1000, 900)
        statuses = []
        for i in range(5):
            statuses.append((await self._attempt_login(client, f"new-acct-{i}@example.com")).status_code)
        assert statuses[:3] == [401, 401, 401]
        assert statuses[3] == 429
        assert statuses[4] == 429

    async def test_per_account_throttle_independent_of_ip(self, client):
        """A throttled account does not throttle other accounts from the same IP."""
        rate_limit.set_policy("auth.login", 1000, 60)  # per-IP effectively unlimited here
        rate_limit.set_policy("auth.login.account", 2, 900)
        target = "victim@example.com"
        first = await self._attempt_login(client, target)
        assert first.status_code == 401
        second = await self._attempt_login(client, target)
        assert second.status_code == 401
        third = await self._attempt_login(client, target)
        assert third.status_code == 429, third.text
        # A different account is unaffected.
        other = await self._attempt_login(client, "someone-else@example.com")
        assert other.status_code == 401

    async def test_429_response_is_safe_and_has_retry_after(self, client):
        rate_limit.set_policy("auth.login", 1, 60)
        await self._attempt_login(client, "x@example.com")
        resp = await self._attempt_login(client, "y@example.com")
        assert resp.status_code == 429
        assert resp.headers.get("retry-after") is not None
        assert int(resp.headers["retry-after"]) >= 1
        body = resp.text.lower()
        # No internals: no limiter vocabulary, no paths, no stack traces.
        for forbidden in ("window", "bucket", "rate limitexceeded", "traceback", "sqlite", "careerpilot"):
            assert forbidden not in body
        assert resp.json()["detail"] == "Too many requests. Please try again later."


class TestRegisterRateLimit:
    """Registration is throttled per client IP."""

    async def test_register_429_after_threshold(self, client):
        rate_limit.set_policy("auth.register", 2, 60)
        first = await client.post("/api/auth/register", json={
            "name": "One", "email": "first@example.com", "password": "password123",
        })
        assert first.status_code == 201
        second = await client.post("/api/auth/register", json={
            "name": "One", "email": "first@example.com", "password": "password123",
        })
        assert second.status_code == 400  # duplicate — but the attempt still counts
        third = await client.post("/api/auth/register", json={
            "name": "Two", "email": "brand-new@example.com", "password": "password123",
        })
        assert third.status_code == 429, third.text
        assert int(third.headers["retry-after"]) >= 1


# ──────────────────────────────────────────────────────────────────────────────
# Search initiation abuse protection (per-user) + concurrency precedence
# ──────────────────────────────────────────────────────────────────────────────

class TestSearchRateLimit:
    """Search runs are throttled per authenticated user (user id, not IP)."""

    async def _start(self, client, headers, **overrides):
        return await client.post("/api/search", json={"dry_run": True, **overrides}, headers=headers)

    async def test_below_threshold_allowed(self, client):
        rate_limit.set_policy("search.start", 3, 60)
        user = await create_user("search-a@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)
        for _ in range(2):
            assert (await self._start(client, headers)).status_code == 201
            from app.services.search_manager import get_search_run_manager
            await get_search_run_manager().wait_for_idle(timeout=10.0)

    async def test_429_after_threshold(self, client):
        rate_limit.set_policy("search.start", 2, 60)
        user = await create_user("search-b@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)
        from app.services.search_manager import get_search_run_manager
        for _ in range(2):
            assert (await self._start(client, headers)).status_code == 201
            await get_search_run_manager().wait_for_idle(timeout=10.0)
        third = await self._start(client, headers)
        assert third.status_code == 429, third.text
        assert int(third.headers["retry-after"]) >= 1

    async def test_per_user_independent(self, client):
        rate_limit.set_policy("search.start", 1, 60)
        user_a = await create_user("search-c@example.com")
        await create_preferences(user_a.id)
        headers_a = await auth_header(client, user_a.email)
        assert (await self._start(client, headers_a)).status_code == 201
        from app.services.search_manager import get_search_run_manager
        await get_search_run_manager().wait_for_idle(timeout=10.0)

        user_b = await create_user("search-d@example.com")
        await create_preferences(user_b.id)
        headers_b = await auth_header(client, user_b.email)
        assert (await self._start(client, headers_b)).status_code == 201  # B unaffected by A

    async def test_cannot_bypass_by_spoofing_proxy_header(self, client):
        """Identity is the JWT user id, so X-Forwarded-For cannot reset the window."""
        rate_limit.set_policy("search.start", 1, 60)
        user = await create_user("search-e@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)
        assert (await self._start(client, headers)).status_code == 201
        spoofed = {**headers, "X-Forwarded-For": "9.9.9.9"}
        assert (await self._start(client, spoofed)).status_code == 429

    async def test_rate_limit_precedes_concurrency_409(self, client):
        """When over the rate window the response is 429, not 409."""
        rate_limit.set_policy("search.start", 1, 60)
        user = await create_user("search-f@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)
        assert (await self._start(client, headers)).status_code == 201
        # Do not wait for completion: even while the global run lock is busy,
        # the rate-limit dependency (runs first) returns 429 deterministically.
        again = await self._start(client, headers)
        assert again.status_code == 429, again.text


# ──────────────────────────────────────────────────────────────────────────────
# Document generation abuse protection (per-user) + concurrency guard
# ──────────────────────────────────────────────────────────────────────────────

class TestDocgenRateLimit:
    """with-documents is throttled per user; at most one in-flight generation."""

    @pytest.fixture
    def fake_docgen(self, monkeypatch, generated_docs_root):
        """Install a fast fake generator; return the temp root."""
        monkeypatch.setattr(
            application_assistant,
            "generate_application_documents",
            _make_fake_docgen(generated_docs_root),
        )
        return generated_docs_root

    async def test_legitimate_generation_works(self, client, store_files, fake_docgen):
        """Default limits permit a normal generation (preserve legitimate workflow)."""
        user = await create_user("docgen-legit@example.com")
        await create_profile(user.id)
        headers = await auth_header(client, user.email)
        resp = await client.post(
            "/api/applications/with-documents",
            json={"stable_id": JOB["stable_id"]},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["cv_file"]  # fake produced a CV path
        assert "cover" in resp.json()["cover_letter_file"]

    async def test_429_after_threshold(self, client, store_files, fake_docgen):
        rate_limit.set_policy("docgen.generate", 3, 60)
        user = await create_user("docgen-rate@example.com")
        await create_profile(user.id)
        headers = await auth_header(client, user.email)

        statuses = []
        for _ in range(4):
            # Do not delete rows: later requests for the same job may 409 on the
            # open-application check and still consume a rate-limit slot.
            resp = await client.post(
                "/api/applications/with-documents",
                json={"stable_id": JOB["stable_id"]},
                headers=headers,
            )
            statuses.append(resp.status_code)
        assert statuses[0] == 201
        # Attempts 2 and 3 consume the window (201 or 409 on open-app), attempt 4 → 429.
        assert statuses[1] in (201, 409)
        assert statuses[2] in (201, 409)
        assert statuses[3] == 429
        # Reassure the reader this came from the rate limiter, not a 5xx.
        assert "Too many requests" in (await client.post(
            "/api/applications/with-documents",
            json={"stable_id": JOB["stable_id"]},
            headers=headers,
        )).json()["detail"]

    async def test_per_user_independent(self, client, store_files, fake_docgen):
        rate_limit.set_policy("docgen.generate", 1, 60)
        user_a = await create_user("docgen-a@example.com")
        await create_profile(user_a.id)
        headers_a = await auth_header(client, user_a.email)
        assert (await client.post(
            "/api/applications/with-documents", json={"stable_id": JOB["stable_id"]}, headers=headers_a,
        )).status_code == 201

        user_b = await create_user("docgen-b@example.com")
        await create_profile(user_b.id)
        headers_b = await auth_header(client, user_b.email)
        assert (await client.post(
            "/api/applications/with-documents", json={"stable_id": JOB["stable_id"]}, headers=headers_b,
        )).status_code == 201  # B unaffected by A's exhausted window

    async def test_concurrency_limited_to_one_in_flight(
        self, client, store_files, generated_docs_root, monkeypatch
    ):
        """A second simultaneous generation is 429 until the first releases."""
        user = await create_user("docgen-conc@example.com")
        await create_profile(user.id)
        headers = await auth_header(client, user.email)
        gate = asyncio.Event()
        monkeypatch.setattr(
            application_assistant,
            "generate_application_documents",
            _make_fake_docgen(generated_docs_root, gate=gate),
        )

        first = asyncio.create_task(
            client.post(
                "/api/applications/with-documents",
                json={"stable_id": JOB["stable_id"]},
                headers=headers,
            )
        )
        await asyncio.sleep(0.3)  # let request 1 acquire the guard and suspend on the gate

        second = await client.post(
            "/api/applications/with-documents",
            json={"stable_id": JOB["stable_id"]},
            headers=headers,
        )
        assert second.status_code == 429, second.text
        assert second.headers.get("retry-after") == str(
            get_settings().docgen_concurrency_retry_after_seconds
        )
        assert "already in progress" in second.json()["detail"].lower()

        gate.set()
        first_resp = await first
        assert first_resp.status_code == 201, first_resp.text


# ──────────────────────────────────────────────────────────────────────────────
# Defaults / configuration
# ──────────────────────────────────────────────────────────────────────────────

class TestRateLimitSettings:
    """New P3.1 settings have sane, bounded defaults (independent of .env)."""

    def test_settings_defaults(self):
        with patch.dict(os.environ, {}, clear=True):
            s = Settings()
        assert s.rate_limit_enabled is True
        assert s.rate_limit_max_clients == 10000
        assert s.rate_limit_trust_proxy is False
        assert s.login_limit_per_ip >= 1 and s.login_window_seconds > 0
        assert s.login_limit_per_account >= 1 and s.login_account_window_seconds > 0
        assert s.register_limit_per_ip >= 1 and s.register_window_seconds > 0
        assert s.search_start_limit_per_user >= 1 and s.search_start_window_seconds > 0
        assert s.search_run_max_duration_seconds > 0
        assert s.docgen_limit_per_user >= 1 and s.docgen_window_seconds > 0
        assert s.docgen_max_concurrent_per_user >= 1
        assert s.public_read_limit_per_ip >= 1 and s.public_read_window_seconds > 0

    def test_rate_limit_can_be_disabled(self):
        """When disabled, check_rate_limit is a no-op (restores behavior in tests that set it)."""
        with patch.dict(os.environ, {"RATE_LIMIT_ENABLED": "false"}, clear=True):
            get_settings.cache_clear()
            try:
                rate_limit.set_policy("test.off", 1, 3600)
                rate_limit.check_rate_limit("test.off", "k")
                rate_limit.check_rate_limit("test.off", "k")  # no 429 despite limit 1
            finally:
                get_settings.cache_clear()


# ──────────────────────────────────────────────────────────────────────────────
# Anonymous public demo reads (P5.1)
# ──────────────────────────────────────────────────────────────────────────────

class TestPublicReadRateLimit:
    """GET /api/public/* is bounded per anonymous client IP.

    P5.1 added the ``public.read`` scope so a crawler cannot consume unlimited
    resources on the public plane, while ordinary demo browsing and readiness
    probes stay unaffected. Identity comes from ``get_client_ip`` (same single-
    proxy trust model as the auth limits), and the budget lives in the same
    bounded, evictable limiter as every other scope.
    """

    async def test_below_threshold_allowed(self, client):
        rate_limit.set_policy("public.read", 5, 60)
        last = None
        for _ in range(5):
            last = await client.get("/api/public/status")
            assert last.status_code == 200, last.text
        assert last.json()["is_demo_mode"] is True

    async def test_429_after_threshold_with_safe_retry_after(self, client):
        rate_limit.set_policy("public.read", 3, 60)
        for _ in range(3):
            assert (await client.get("/api/public/status")).status_code == 200
        blocked = await client.get("/api/public/jobs/active")
        assert blocked.status_code == 429, blocked.text
        assert blocked.headers.get("retry-after") is not None
        assert int(blocked.headers["retry-after"]) >= 1
        body = blocked.text.lower()
        # No internals: no limiter vocabulary, no paths, no stack traces.
        for forbidden in ("window", "bucket", "rate limitexceeded", "traceback", "sqlite", "careerpilot"):
            assert forbidden not in body
        assert blocked.json()["detail"] == "Too many requests. Please try again later."

    async def test_public_read_does_not_interfere_with_auth_limits(self, client):
        """An exhausted public.read budget does not consume the login budget."""
        rate_limit.set_policy("public.read", 1, 60)
        rate_limit.set_policy("auth.login", 100, 60)  # generous login budget
        first = await client.get("/api/public/status")
        assert first.status_code == 200
        # public.read is now spent; a login attempt lives in a separate scope.
        login = await client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "wrong-password"},
        )
        # Invalid creds -> 401 (NOT a 429): the public-read budget did not leak
        # into the authenticated scope.
        assert login.status_code == 401, login.text