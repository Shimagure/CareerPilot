"""Tests for the Saved Jobs API - Checkpoint 11.

Covers:
  - Authentication (anonymous GET/POST/DELETE must 401)
  - Save / list / unsave lifecycle
  - Idempotent save (no duplicate state)
  - Idempotent unsave (no-op when not saved)
  - Cross-user isolation (A can never read/unsave B's saved state)
  - Honest missing-job representation (available=False, job=None, no fabrication)
  - Unsave never destroys application/tracker state for the same job
"""
from __future__ import annotations

import csv
import json
import os
import tempfile
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import get_db_manager
from app.models.database_models import (
    User,
    UserStatus,
    UserJob,
    UserJobStatus,
    Application,
    ApplicationStatus,
)
from app.auth import hash_password


# A job present in the fixture global dataset.
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

TRACKER_HEADER = [
    "date", "company", "sector", "role", "role_type", "channel",
    "status", "contact_person", "fit_rating", "notes", "cv_file",
    "cover_letter_file", "source", "stable_id",
]


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    db_path = os.path.join(tempfile.gettempdir(), f"test_saved_jobs_db_{uuid.uuid4().hex}.db")
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
    files["seen"].write_text(
        json.dumps({"seen": {JOB["stable_id"]: JOB}}), encoding="utf-8"
    )
    files["ranked"].write_text(json.dumps([]), encoding="utf-8")
    files["tracker"].write_text("", encoding="utf-8")
    files["checkpoints"].write_text(json.dumps({}), encoding="utf-8")

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


class TestSavedJobsAuthorization:
    """All saved-jobs operations require JWT authentication."""

    async def test_get_requires_auth(self, client, store_files):
        resp = await client.get("/api/saved-jobs")
        assert resp.status_code == 401

    async def test_save_requires_auth(self, client, store_files):
        resp = await client.post("/api/saved-jobs/abc123")
        assert resp.status_code == 401

    async def test_unsave_requires_auth(self, client, store_files):
        resp = await client.delete("/api/saved-jobs/abc123")
        assert resp.status_code == 401


class TestSavedJobsLifecycle:
    """Save / list / unsave for the authenticated user."""

    async def test_save_job(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await client.post("/api/saved-jobs/abc123", headers=headers)
        assert resp.status_code == 200, resp.text
        item = resp.json()
        assert item["stable_id"] == "abc123"
        assert item["available"] is True
        assert item["saved_at"]
        assert item["job"] is not None
        assert item["job"]["title"] == "IT Support Specialist"

    async def test_list_saved_jobs(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        await client.post("/api/saved-jobs/abc123", headers=headers)
        resp = await client.get("/api/saved-jobs", headers=headers)
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["stable_id"] == "abc123"
        assert items[0]["job"]["company"] == "Test Corp"

    async def test_list_empty_for_user_with_no_saves(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await client.get("/api/saved-jobs", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_save_is_idempotent(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        r1 = await client.post("/api/saved-jobs/abc123", headers=headers)
        r2 = await client.post("/api/saved-jobs/abc123", headers=headers)
        assert r1.status_code == 200
        assert r2.status_code == 200
        resp = await client.get("/api/saved-jobs", headers=headers)
        assert len(resp.json()) == 1  # no duplicate rows

    async def test_unsave_job(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        await client.post("/api/saved-jobs/abc123", headers=headers)
        resp = await client.delete("/api/saved-jobs/abc123", headers=headers)
        assert resp.status_code == 204
        resp = await client.get("/api/saved-jobs", headers=headers)
        assert resp.json() == []

    async def test_unsave_when_not_saved_is_noop(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await client.delete("/api/saved-jobs/abc123", headers=headers)
        assert resp.status_code == 204
        resp = await client.get("/api/saved-jobs", headers=headers)
        assert resp.json() == []

    async def test_save_missing_job_returns_404(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await client.post("/api/saved-jobs/does-not-exist", headers=headers)
        assert resp.status_code == 404


class TestSavedJobsCrossUser:
    """User A cannot read or unsave User B's saved state."""

    async def test_user_b_cannot_see_user_a_saved_jobs(self, client, store_files):
        await create_user("a@example.com")
        await create_user("b@example.com")
        headers_a = await auth_header(client, "a@example.com")
        headers_b = await auth_header(client, "b@example.com")
        await client.post("/api/saved-jobs/abc123", headers=headers_a)
        resp_b = await client.get("/api/saved-jobs", headers=headers_b)
        assert resp_b.status_code == 200
        assert resp_b.json() == []  # A's saved job is invisible to B

    async def test_user_b_cannot_unsave_user_a_saved_job(self, client, store_files):
        await create_user("a@example.com")
        await create_user("b@example.com")
        headers_a = await auth_header(client, "a@example.com")
        headers_b = await auth_header(client, "b@example.com")
        await client.post("/api/saved-jobs/abc123", headers=headers_a)
        # B attempts to unsave A's job (B has nothing saved).
        resp = await client.delete("/api/saved-jobs/abc123", headers=headers_b)
        assert resp.status_code == 204
        # A's saved state is untouched.
        resp_a = await client.get("/api/saved-jobs", headers=headers_a)
        items = resp_a.json()
        assert len(items) == 1
        assert items[0]["stable_id"] == "abc123"

    async def test_users_keep_separate_saved_lists(self, client, store_files):
        await create_user("a@example.com")
        await create_user("b@example.com")
        headers_a = await auth_header(client, "a@example.com")
        headers_b = await auth_header(client, "b@example.com")
        await client.post("/api/saved-jobs/abc123", headers=headers_a)
        await client.post("/api/saved-jobs/abc123", headers=headers_b)
        # A unsaves; only A's view changes.
        await client.delete("/api/saved-jobs/abc123", headers=headers_a)
        resp_a = await client.get("/api/saved-jobs", headers=headers_a)
        assert resp_a.json() == []
        resp_b = await client.get("/api/saved-jobs", headers=headers_b)
        assert len(resp_b.json()) == 1


class TestSavedJobsMissingJob:
    """A saved job that leaves the global dataset is reported honestly."""

    async def test_removed_job_is_available_false(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        await client.post("/api/saved-jobs/abc123", headers=headers)
        # Simulate the job disappearing from the global dataset.
        store_files["seen"].write_text(json.dumps({"seen": {}}), encoding="utf-8")
        store_files["canonical"].write_text(json.dumps([]), encoding="utf-8")
        from app import store as store_module
        store_module.invalidate_store_cache()
        resp = await client.get("/api/saved-jobs", headers=headers)
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["available"] is False
        assert items[0]["job"] is None  # no fabricated fields


class TestUnsavePreservesApplicationState:
    """Unsave must never destroy application history for the same job."""

    async def test_unsave_keeps_db_application_and_tracker_row(self, client, db_manager, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        await client.post("/api/saved-jobs/abc123", headers=headers)

        # Application history for the same job lives in the DB Application table
        # and the CSV tracker (both separate from UserJob).
        async with get_db_manager().session() as session:
            from sqlalchemy import select
            user = (await session.execute(
                select(User).where(User.email == "a@example.com")
            )).scalar_one()
            app_row = Application(
                user_id=user.id,
                job_stable_id="abc123",
                company="Test Corp",
                role="IT Support Specialist",
                status=ApplicationStatus.DRAFT,
            )
            session.add(app_row)
            await session.commit()

        tracker_path = store_files["tracker"]
        with open(tracker_path, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if tracker_path.stat().st_size == 0:
                writer.writerow(TRACKER_HEADER)
            writer.writerow(["2026-09-09", "Test Corp", "", "IT Support Specialist", "", "", "drafted", "", "", "", "", "", "https://example.com/job/1", "abc123"])

        # Unsave the job.
        resp = await client.delete("/api/saved-jobs/abc123", headers=headers)
        assert resp.status_code == 204

        # The saved UserJob row is gone...
        async with get_db_manager().session() as session:
            from sqlalchemy import select
            user = (await session.execute(
                select(User).where(User.email == "a@example.com")
            )).scalar_one()
            saved_rows = (await session.execute(
                select(UserJob).where(
                    UserJob.user_id == user.id, UserJob.job_stable_id == "abc123"
                )
            )).scalars().all()
            assert len(saved_rows) == 0
            # ...but the DB Application row survives.
            app_rows = (await session.execute(
                select(Application).where(
                    Application.user_id == user.id, Application.job_stable_id == "abc123"
                )
            )).scalars().all()
            assert len(app_rows) == 1

        # ...and the CSV tracker still holds the application row.
        rows = list(csv.DictReader(open(tracker_path, encoding="utf-8"), skipinitialspace=True))
        assert any(r.get("stable_id") == "abc123" for r in rows), "tracker row lost"