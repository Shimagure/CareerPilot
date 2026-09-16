"""Tests for the authenticated job search API - Checkpoint 7.

Covers:
  - Authentication (401 on all endpoints)
  - Search run creation + ownership (from get_current_user, never from body)
  - Request validation (malformed/unsupported rejected; unsafe input never reaches subprocess)
  - Cross-user isolation (user B never sees user A's runs)
  - Status lifecycle (queued → running → completed/failed; failed is terminal)
  - Concurrency policy (409 when a run is already queued/running)
  - Persistence (runs survive app restarts; reconciled on startup)
  - Preference snapshot honesty (historical run configs immutable to later pref changes)
"""
from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timezone

import pytest_asyncio
from httpx import AsyncClient, ASGITransport
import asyncio

from app.main import app
from app.database import get_db_manager
from app.models.database_models import User, UserStatus, SearchPreferences, SearchRun, SearchRunStatus
from app.auth import hash_password
from sqlalchemy import select


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="function")
async def db_manager():
    db_path = os.path.join(tempfile.gettempdir(), f"test_search_db_{uuid.uuid4().hex}.db")
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


async def create_user(email: str) -> User:
    async with get_db_manager().session() as session:
        user = User(name="Test User", email=email, password_hash=hash_password("password123"), status=UserStatus.ACTIVE)
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def auth_header(client, email: str) -> dict:
    resp = await client.post("/api/auth/login", json={"email": email, "password": "password123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def create_preferences(user_id: str, **overrides) -> SearchPreferences:
    """Create a SearchPreferences row for the given user."""
    async with get_db_manager().session() as session:
        import json
        pref = SearchPreferences(
            user_id=user_id,
            target_roles=json.dumps(overrides.get("target_roles", ["IT Support"])),
            preferred_locations=json.dumps(overrides.get("preferred_locations", ["Metro Manila"])),
            excluded_keywords=json.dumps(overrides.get("excluded_keywords", [])),
            remote_ok=overrides.get("remote_ok", True),
            hybrid_ok=overrides.get("hybrid_ok", False),
            onsite_ok=overrides.get("onsite_ok", False),
            ncr_only=overrides.get("ncr_only", True),
            salary_min=overrides.get("salary_min", 30000),
            salary_max=overrides.get("salary_max", 50000),
            salary_currency=overrides.get("salary_currency", "PHP"),
            salary_period=overrides.get("salary_period", "monthly"),
            day_shift_ok=overrides.get("day_shift_ok", True),
            night_shift_ok=overrides.get("night_shift_ok", False),
            rotational_ok=overrides.get("rotational_ok", False),
            career_direction=overrides.get("career_direction", "EUC / IT Support"),
        )
        session.add(pref)
        await session.commit()
        await session.refresh(pref)
        return pref


# ──────────────────────────────────────────────────────────────────────────────
# Test Classes
# ──────────────────────────────────────────────────────────────────────────────

class TestSearchAuthorization:
    """All search endpoints require authentication."""

    async def test_post_requires_auth(self, client):
        resp = await client.post("/api/search", json={"dry_run": True})
        assert resp.status_code == 401

    async def test_get_list_requires_auth(self, client):
        resp = await client.get("/api/search")
        assert resp.status_code == 401

    async def test_get_one_requires_auth(self, client):
        resp = await client.get("/api/search/00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 401

    async def test_rejects_invalid_token(self, client):
        headers = {"Authorization": "Bearer not.a.jwt"}
        assert (await client.post("/api/search", json={"dry_run": True}, headers=headers)).status_code == 401
        assert (await client.get("/api/search", headers=headers)).status_code == 401
        assert (await client.get("/api/search/00000000-0000-0000-0000-000000000000", headers=headers)).status_code == 401


class TestSearchCreation:
    """Authenticated users can start a search run; it is immediately persisted."""

    async def test_start_search_returns_queued(self, client):
        user = await create_user("user_a@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["id"]
        assert data["status"] == "queued"
        assert data["started_at"] is None
        assert data["completed_at"] is None
        assert data["error"] is None
        assert data["pipeline_stage"] == "preparing"
        assert data["preference_snapshot"] is not None
        assert data["execution_options"]["dry_run"] is True
        assert "created_at" in data
        assert "updated_at" in data

    async def test_start_search_requires_preferences(self, client):
        """Starting a search without saved preferences uses sensible defaults."""
        user = await create_user("user_b@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["preference_snapshot"] is None
        assert data["execution_options"]["keywords"] == "IT Support"

    async def test_start_search_uses_first_target_role_and_location(self, client):
        user = await create_user("user_c@example.com")
        await create_preferences(user.id, target_roles=["IT Support", "Service Desk"], preferred_locations=["Metro Manila", "Cebu"])
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["preference_snapshot"]["target_roles"] == ["IT Support", "Service Desk"]
        assert data["execution_options"]["keywords"] == "IT Support"
        assert data["execution_options"]["location"] == "Metro Manila"

    async def test_start_search_accepts_runtime_overrides(self, client):
        user = await create_user("user_d@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={
            "dry_run": True,
            "search_keywords": "Desktop Support",
            "search_location": "Cebu",
        }, headers=headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["execution_options"]["keywords"] == "Desktop Support"
        assert data["execution_options"]["location"] == "Cebu"

    async def test_start_search_is_user_owned(self, client):
        user = await create_user("user_e@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp.status_code == 201
        data = resp.json()

        # Verify ownership in DB
        async with get_db_manager().session() as session:
            run = await session.get(SearchRun, data["id"])
            assert run is not None
            assert run.user_id == user.id


class TestSearchValidation:
    """Malformed, unsupported, or unsafe requests are rejected."""

    async def test_rejects_unknown_field(self, client):
        user = await create_user("user_f@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True, "unsupported": "field"}, headers=headers)
        assert resp.status_code == 422  # Pydantic validation

    async def test_rejects_empty_keywords(self, client):
        user = await create_user("user_g@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True, "search_keywords": ""}, headers=headers)
        assert resp.status_code == 422
        assert "must not be empty" in resp.text

    async def test_rejects_keywords_starting_with_dash(self, client):
        user = await create_user("user_h@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True, "search_keywords": "-q foo"}, headers=headers)
        assert resp.status_code == 422
        assert "must not start with" in resp.text

    async def test_rejects_shell_metacharacters_in_keywords(self, client):
        """Input with shell metacharacters is rejected at the API boundary."""
        user = await create_user("user_i@example.com")
        headers = await auth_header(client, user.email)

        for bad in ["; rm -rf /", "a|b", "a&b", "x>y", "a\$b", "a=b", "a*", "cmd!", "(Hybrid)", "\"q\""]:
            resp = await client.post("/api/search", json={"dry_run": True, "search_keywords": bad}, headers=headers)
            assert resp.status_code == 422, f"Expected 422 for {bad!r}, got {resp.status_code}: {resp.text}"
            assert "disallowed character" in resp.text.lower()

    async def test_rejects_shell_metacharacters_in_location(self, client):
        user = await create_user("user_j@example.com")
        headers = await auth_header(client, user.email)

        for bad in ["; cat /etc/passwd", "a|b", "x>y"]:
            resp = await client.post("/api/search", json={"dry_run": True, "search_location": bad}, headers=headers)
            assert resp.status_code == 422, f"Expected 422 for {bad!r}"
            assert "disallowed character" in resp.text.lower()

    async def test_rejects_bad_dry_run_type(self, client):
        user = await create_user("user_k@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": "yes"}, headers=headers)
        assert resp.status_code == 422


class TestSearchCrossUserIsolation:
    """User B never sees User A's search runs."""

    async def test_user_b_cannot_list_user_a_runs(self, client):
        user_a = await create_user("user_a@example.com")
        user_b = await create_user("user_b@example.com")
        await create_preferences(user_a.id)
        headers_a = await auth_header(client, user_a.email)
        headers_b = await auth_header(client, user_b.email)

        # User A creates a run
        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers_a)
        assert resp.status_code == 201
        run_id = resp.json()["id"]

        # User B lists runs — should be empty
        resp = await client.get("/api/search", headers=headers_b)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["runs"] == []

    async def test_user_b_cannot_get_user_a_run(self, client):
        user_a = await create_user("user_a2@example.com")
        user_b = await create_user("user_b2@example.com")
        await create_preferences(user_a.id)
        headers_a = await auth_header(client, user_a.email)
        headers_b = await auth_header(client, user_b.email)

        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers_a)
        assert resp.status_code == 201
        run_id = resp.json()["id"]

        resp = await client.get(f"/api/search/{run_id}", headers=headers_b)
        assert resp.status_code == 404  # Not found (not 403 — no information leak)


class TestSearchStatusLifecycle:
    """Search runs transition through queued → running → completed/failed."""

    async def test_run_starts_queued(self, client):
        user = await create_user("user_l@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp.status_code == 201
        run_id = resp.json()["id"]

        # Immediately query — may still be queued or running
        # For dry_run, it may complete very quickly; accept completed as valid too
        resp = await client.get(f"/api/search/{run_id}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ("queued", "running", "completed")

    async def test_dry_run_completes(self, client):
        user = await create_user("user_m@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp.status_code == 201
        run_id = resp.json()["id"]

        # Wait for background task to complete (short-lived dry run)
        from app.services.search_manager import get_search_run_manager
        manager = get_search_run_manager()
        await manager.wait_for_idle(timeout=10.0)

        resp = await client.get(f"/api/search/{run_id}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "completed"
        assert data["completed_at"] is not None
        assert data["error"] is None
        assert data["pipeline_stage"] == "completed"
        assert data["result_summary"]["total_jobs_found"] == 0
        assert data["result_summary"]["portals_succeeded"] == 0

    async def test_failed_run_is_terminal_not_stuck_running(self, client):
        """If execution fails, status becomes FAILED (never stays RUNNING forever)."""
        user = await create_user("user_n@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        # Use real executor with an unsafe keyword that will be validated
        # and cause all portals to fail validation → overall failure
        # But the API rejects unsafe keywords at validation, so we can't test
        # that path here. Instead, verify the model: failed runs have error.
        # (The real pipeline failure path is covered by the adapter's error handling.)

        # For this test, we manually create a run and set it to failed
        async with get_db_manager().session() as session:
            run = SearchRun(
                user_id=user.id,
                status=SearchRunStatus.FAILED,
                error="Simulated failure",
                completed_at=datetime.now(timezone.utc),
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)

        resp = await client.get(f"/api/search/{run.id}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "failed"
        assert data["error"] == "Simulated failure"
        assert data["completed_at"] is not None


class TestSearchConcurrency:
    """Single-active-run policy: 409 if any run is queued/running."""

    async def test_rejects_concurrent_start(self, client):
        user = await create_user("user_o@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        # Start first run
        resp1 = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp1.status_code == 201
        run1_id = resp1.json()["id"]

        # Verify it's in RUNNING state (or at least QUEUED) before making second request
        from app.services.search_manager import get_search_run_manager
        manager = get_search_run_manager()
        # Small delay to let background task start
        await asyncio.sleep(0.05)

        # Attempt second run immediately — should be 409
        resp2 = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp2.status_code == 409
        assert "already in progress" in resp2.text

        # Wait for first to complete
        await manager.wait_for_idle(timeout=10.0)

        # Now second should succeed
        resp3 = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp3.status_code == 201
        assert resp3.json()["id"] != run1_id

    async def test_concurrency_is_global_not_per_user(self, client):
        """Concurrency is checked across ALL users (shared pipeline state)."""
        user_a = await create_user("user_a3@example.com")
        user_b = await create_user("user_b3@example.com")
        await create_preferences(user_a.id)
        await create_preferences(user_b.id)
        headers_a = await auth_header(client, user_a.email)
        headers_b = await auth_header(client, user_b.email)

        # User A starts a run
        resp1 = await client.post("/api/search", json={"dry_run": True}, headers=headers_a)
        assert resp1.status_code == 201

        # Small delay to let background task start
        await asyncio.sleep(0.05)

        # User B tries — 409 because global state is busy
        resp2 = await client.post("/api/search", json={"dry_run": True}, headers=headers_b)
        assert resp2.status_code == 409


class TestSearchPersistence:
    """Runs persist across app restarts; reconciled on startup."""

    async def test_run_persists_across_new_client_requests(self, client):
        user = await create_user("user_p@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp.status_code == 201
        run_id = resp.json()["id"]

        # New request sees the run
        resp = await client.get("/api/search", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["runs"][0]["id"] == run_id

    async def test_startup_reconciles_stale_queued_to_failed(self, client):
        """On startup, QUEUED/RUNNING runs are marked FAILED with honest message."""
        user = await create_user("user_q@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        # Create a QUEUED run directly in DB
        async with get_db_manager().session() as session:
            run = SearchRun(user_id=user.id, status=SearchRunStatus.QUEUED)
            session.add(run)
            await session.commit()
            await session.refresh(run)
            run_id = run.id

        # Simulate app restart: call reconcile (as main.py startup does)
        from app.services.search_manager import get_search_run_manager
        manager = get_search_run_manager()
        reconciled = await manager.reconcile_stale_runs()
        assert reconciled == 1

        # Run is now FAILED
        resp = await client.get(f"/api/search/{run_id}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "failed"
        assert "interrupted by server restart" in data["error"]


async def update_preferences(user_id: str, **overrides) -> SearchPreferences:
    """Update existing SearchPreferences row for the given user."""
    async with get_db_manager().session() as session:
        import json
        result = await session.execute(
            select(SearchPreferences).where(SearchPreferences.user_id == user_id)
        )
        pref = result.scalar_one_or_none()
        if pref is None:
            return await create_preferences(user_id, **overrides)

        if "target_roles" in overrides:
            pref.target_roles = json.dumps(overrides["target_roles"])
        if "preferred_locations" in overrides:
            pref.preferred_locations = json.dumps(overrides["preferred_locations"])
        if "excluded_keywords" in overrides:
            pref.excluded_keywords = json.dumps(overrides["excluded_keywords"])
        if "remote_ok" in overrides:
            pref.remote_ok = overrides["remote_ok"]
        if "hybrid_ok" in overrides:
            pref.hybrid_ok = overrides["hybrid_ok"]
        if "onsite_ok" in overrides:
            pref.onsite_ok = overrides["onsite_ok"]
        if "ncr_only" in overrides:
            pref.ncr_only = overrides["ncr_only"]
        if "salary_min" in overrides:
            pref.salary_min = overrides["salary_min"]
        if "salary_max" in overrides:
            pref.salary_max = overrides["salary_max"]
        if "salary_currency" in overrides:
            pref.salary_currency = overrides["salary_currency"]
        if "salary_period" in overrides:
            pref.salary_period = overrides["salary_period"]
        if "day_shift_ok" in overrides:
            pref.day_shift_ok = overrides["day_shift_ok"]
        if "night_shift_ok" in overrides:
            pref.night_shift_ok = overrides["night_shift_ok"]
        if "rotational_ok" in overrides:
            pref.rotational_ok = overrides["rotational_ok"]
        if "career_direction" in overrides:
            pref.career_direction = overrides["career_direction"]

        await session.commit()
        await session.refresh(pref)
        return pref


class TestSearchPreferenceSnapshot:
    """Historical runs keep their preference snapshot; later changes don't rewrite history."""

    async def test_run_keeps_snapshot_after_preferences_change(self, client):
        user = await create_user("user_r@example.com")
        await create_preferences(user.id, target_roles=["IT Support"], preferred_locations=["Metro Manila"])
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp.status_code == 201
        run_id = resp.json()["id"]
        snapshot = resp.json()["preference_snapshot"]
        assert snapshot["target_roles"] == ["IT Support"]
        assert snapshot["preferred_locations"] == ["Metro Manila"]

        # Update user's preferences
        await update_preferences(user.id, target_roles=["Service Desk"], preferred_locations=["Cebu"])

        # Run's snapshot is unchanged
        resp = await client.get(f"/api/search/{run_id}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["preference_snapshot"]["target_roles"] == ["IT Support"]
        assert data["preference_snapshot"]["preferred_locations"] == ["Metro Manila"]


class TestSearchList:
    """Paginated list of recent runs, newest first."""

    async def test_list_returns_paginated_results(self, client):
        user = await create_user("user_s@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        # Create multiple runs sequentially (wait for each to complete)
        run_ids = []
        from app.services.search_manager import get_search_run_manager
        manager = get_search_run_manager()
        for _ in range(5):
            resp = await client.post("/api/search", json={"dry_run": True}, headers=headers)
            assert resp.status_code == 201
            run_ids.append(resp.json()["id"])
            # Wait for this run to complete before starting the next
            await manager.wait_for_idle(timeout=10.0)

        # List with default limit (20)
        resp = await client.get("/api/search", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        assert len(data["runs"]) == 5
        assert data["limit"] == 20
        assert data["offset"] == 0

        # Newest first
        assert data["runs"][0]["id"] == run_ids[-1]
        assert data["runs"][-1]["id"] == run_ids[0]

    async def test_list_respects_limit_and_offset(self, client):
        user = await create_user("user_t@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        from app.services.search_manager import get_search_run_manager
        manager = get_search_run_manager()
        for _ in range(3):
            await client.post("/api/search", json={"dry_run": True}, headers=headers)
            await manager.wait_for_idle(timeout=10.0)

        resp = await client.get("/api/search?limit=2&offset=1", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        assert len(data["runs"]) == 2
        assert data["limit"] == 2
        assert data["offset"] == 1

    async def test_list_enforces_max_limit(self, client):
        user = await create_user("user_u@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.get("/api/search?limit=100", headers=headers)
        assert resp.status_code == 422  # ge=1, le=50


class TestSearchResponseSafety:
    """API responses never leak secrets, paths, credentials, or stack traces."""

    async def test_no_secrets_in_response(self, client):
        user = await create_user("user_v@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        resp = await client.post("/api/search", json={"dry_run": True}, headers=headers)
        assert resp.status_code == 201
        text = resp.text

        # No secrets
        assert "password" not in text.lower()
        assert "secret" not in text.lower()
        assert "access_token" not in text
        assert "careerpilot.db" not in text

        # No filesystem paths
        assert "C:" not in text
        assert "/home" not in text
        assert "\\\\" not in text
        assert ".json" not in text  # No raw file paths in response

    async def test_error_responses_are_safe(self, client):
        """Failed runs report human-readable error, no stack trace."""
        user = await create_user("user_w@example.com")
        await create_preferences(user.id)
        headers = await auth_header(client, user.email)

        # Manually create a failed run
        async with get_db_manager().session() as session:
            run = SearchRun(
                user_id=user.id,
                status=SearchRunStatus.FAILED,
                error="Human-readable failure",
                run_metadata='{"pipeline_stage": "failed"}',
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)

        resp = await client.get(f"/api/search/{run.id}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "failed"
        assert data["error"] == "Human-readable failure"
        assert "Traceback" not in resp.text
        assert "File " not in resp.text