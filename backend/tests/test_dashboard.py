"""Tests for the authenticated User Workspace dashboard - Checkpoint 3."""
import os
import tempfile
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import get_db_manager
from app.models.database_models import (
    Application,
    CandidateProfile,
    Resume,
    SearchPreferences,
    SearchRun,
    User,
    UserStatus,
)
from app.auth import hash_password


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Create an isolated test database."""
    db_path = os.path.join(tempfile.gettempdir(), f"test_dashboard_db_{uuid.uuid4().hex}.db")

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


@pytest_asyncio.fixture
async def client(db_manager):
    """Create test client."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def user_a(db_manager):
    """User A - a fully set-up user with user-owned records."""
    async with db_manager.session() as session:
        user = User(
            name="User A",
            email="user_a@example.com",
            password_hash=hash_password("password123"),
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        session.add_all([
            Resume(
                user_id=user.id,
                original_filename="cv.pdf",
                storage_key=f"resumes/{uuid.uuid4().hex}.pdf",
                file_type="application/pdf",
                file_size=1234,
            ),
            CandidateProfile(user_id=user.id, full_name="User A"),
            SearchPreferences(user_id=user.id, target_roles='["IT Support"]'),
            SearchRun(user_id=user.id),
            Application(
                user_id=user.id,
                job_stable_id="job-abc",
                company="Acme",
                role="IT Support Specialist",
            ),
        ])
        await session.commit()
        return user


@pytest_asyncio.fixture
async def user_b(db_manager):
    """User B - a brand-new user with no setup records."""
    async with db_manager.session() as session:
        user = User(
            name="User B",
            email="user_b@example.com",
            password_hash=hash_password("password123"),
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def auth_header(client, email: str, password: str = "password123") -> dict:
    """Login and return an Authorization header."""
    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


class TestDashboardAuthorization:
    """The dashboard endpoint must be authenticated and user-scoped."""

    async def test_requires_auth(self, client):
        resp = await client.get("/api/dashboard")
        assert resp.status_code == 401

    async def test_rejects_invalid_token(self, client):
        resp = await client.get(
            "/api/dashboard", headers={"Authorization": "Bearer not.a.jwt"}
        )
        assert resp.status_code == 401

    async def test_authenticated_success(self, client, user_a):
        headers = await auth_header(client, user_a.email)
        resp = await client.get("/api/dashboard", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["user"]["email"] == user_a.email
        assert data["user"]["id"] == user_a.id


class TestDashboardReadiness:
    """New users get honest empty/readiness state; no sensitive fields."""

    async def test_new_user_empty_state(self, client, user_b):
        headers = await auth_header(client, user_b.email)
        resp = await client.get("/api/dashboard", headers=headers)
        assert resp.status_code == 200
        data = resp.json()

        pr = data["profile_readiness"]
        assert pr["resume_uploaded"] is False
        assert pr["candidate_profile_configured"] is False
        assert pr["search_preferences_configured"] is False
        assert pr["completed_steps"] == 0
        assert pr["total_steps"] == 3
        assert pr["ready"] is False

        activity = data["user_activity"]
        assert activity["search_run_count"] == 0
        assert activity["saved_job_count"] == 0
        assert activity["application_count"] == 0
        assert activity["has_activity"] is False

        # Honest future-action steps are recommended
        step_ids = {s["id"] for s in data["next_steps"]}
        assert "upload_resume" in step_ids
        assert "set_preferences" in step_ids
        assert "configure_profile" in step_ids

        # Resume upload and profile configuration are real routes now (Checkpoint 4 & 5)
        steps_by_id = {s["id"]: s for s in data["next_steps"]}
        assert steps_by_id["upload_resume"]["href"] == "/resume"
        assert steps_by_id["upload_resume"]["coming_soon"] is False
        assert steps_by_id["configure_profile"]["href"] == "/profile"
        assert steps_by_id["configure_profile"]["coming_soon"] is False

        # Set search preferences is a real route now (Checkpoint 6)
        assert steps_by_id["set_preferences"]["href"] == "/preferences"
        assert steps_by_id["set_preferences"]["coming_soon"] is False

    async def test_setup_complete_reflects_state(self, client, user_a):
        headers = await auth_header(client, user_a.email)
        resp = await client.get("/api/dashboard", headers=headers)
        assert resp.status_code == 200
        data = resp.json()

        pr = data["profile_readiness"]
        assert pr["resume_uploaded"] is True
        assert pr["candidate_profile_configured"] is True
        assert pr["search_preferences_configured"] is True
        assert pr["completed_steps"] == 3
        assert pr["ready"] is True

        activity = data["user_activity"]
        assert activity["application_count"] == 1
        assert activity["search_run_count"] == 1
        assert activity["has_activity"] is True

        step_ids = {s["id"] for s in data["next_steps"]}
        assert "upload_resume" not in step_ids
        assert "track_applications" not in step_ids

    async def test_no_sensitive_fields(self, client, user_a):
        headers = await auth_header(client, user_a.email)
        resp = await client.get("/api/dashboard", headers=headers)
        assert resp.status_code == 200
        raw = resp.text
        assert "password" not in raw.lower()
        assert "access_token" not in raw
        assert "secret" not in raw.lower()
        data = resp.json()
        assert set(data["user"]) == {"id", "email", "created_at"}

    async def test_system_overview_is_global_not_user_owned(self, client, user_b):
        headers = await auth_header(client, user_b.email)
        resp = await client.get("/api/dashboard", headers=headers)
        data = resp.json()
        overview = data["system_overview"]
        # Global pipeline data may be present but is clearly separate from user activity
        assert "status" in overview
        assert "active_jobs" in overview
        assert data["user_activity"]["has_activity"] is False


class TestDashboardCrossUserIsolation:
    """User records must never leak across accounts."""

    async def test_user_b_never_sees_user_a_records(self, client, user_a, user_b):
        headers_b = await auth_header(client, user_b.email)
        resp = await client.get("/api/dashboard", headers=headers_b)
        assert resp.status_code == 200
        data = resp.json()

        assert data["user"]["email"] == user_b.email
        assert data["user"]["id"] == user_b.id
        assert data["profile_readiness"]["resume_uploaded"] is False
        assert data["profile_readiness"]["candidate_profile_configured"] is False
        assert data["profile_readiness"]["search_preferences_configured"] is False
        assert data["user_activity"]["application_count"] == 0
        assert data["user_activity"]["search_run_count"] == 0

    async def test_user_a_keeps_own_records(self, client, user_a, user_b):
        headers_a = await auth_header(client, user_a.email)
        resp = await client.get("/api/dashboard", headers=headers_a)
        assert resp.status_code == 200
        data = resp.json()

        assert data["user"]["email"] == user_a.email
        assert data["profile_readiness"]["resume_uploaded"] is True
        assert data["user_activity"]["application_count"] == 1