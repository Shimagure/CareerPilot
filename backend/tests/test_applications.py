"""Tests for the Applications API - Checkpoint 12.

Covers:
  - Authentication (anonymous GET/POST/PATCH/DELETE must 401)
  - Create / list / get / patch / delete lifecycle (user-scoped)
  - Company/role derived from the global dataset (anti-fabrication)
  - Missing job -> 404, duplicate open application -> 409
  - Timeline timestamps set honestly on status transitions
  - Cross-user isolation (A can never read/patch/delete B's rows)
  - Honest availability when a job leaves the global dataset
  - Deleting an application never destroys saved-job state
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import get_db_manager
from app.models.database_models import User, UserStatus, UserJob, UserJobStatus
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


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    db_path = os.path.join(tempfile.gettempdir(), f"test_applications_db_{uuid.uuid4().hex}.db")
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


async def create_application(client, headers, stable_id: str = "abc123", **extra):
    resp = await client.post("/api/applications", json={"stable_id": stable_id, **extra}, headers=headers)
    return resp


class TestApplicationsAuthorization:
    """All application operations require JWT authentication."""

    async def test_get_requires_auth(self, client, store_files):
        resp = await client.get("/api/applications")
        assert resp.status_code == 401

    async def test_post_requires_auth(self, client, store_files):
        resp = await client.post("/api/applications", json={"stable_id": "abc123"})
        assert resp.status_code == 401

    async def test_patch_requires_auth(self, client, store_files):
        resp = await client.patch("/api/applications/some-id", json={"status": "submitted"})
        assert resp.status_code == 401

    async def test_delete_requires_auth(self, client, store_files):
        resp = await client.delete("/api/applications/some-id")
        assert resp.status_code == 401


class TestApplicationsLifecycle:
    """Create / list / get / patch / delete for the authenticated user."""

    async def test_create_application(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await create_application(client, headers)
        assert resp.status_code == 201, resp.text
        detail = resp.json()
        assert detail["job_stable_id"] == "abc123"
        assert detail["status"] == "draft"
        assert detail["available"] is True
        assert detail["job"] is not None
        # Company/role derived from the dataset, never client input.
        assert detail["company"] == "Test Corp"
        assert detail["role"] == "IT Support Specialist"
        assert detail["applied_at"] is None  # draft has not been submitted

    async def test_list_applications(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await create_application(client, headers)
        app_id = resp.json()["id"]
        resp = await client.get("/api/applications", headers=headers)
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["id"] == app_id
        assert items[0]["company"] == "Test Corp"

    async def test_list_empty_for_user_with_no_applications(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await client.get("/api/applications", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_get_single_application(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await create_application(client, headers)
        app_id = resp.json()["id"]
        resp = await client.get(f"/api/applications/{app_id}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == app_id

    async def test_create_missing_job_returns_404(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await send_missing(client, headers)
        assert resp.status_code == 404

    async def test_duplicate_open_application_returns_409(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        r1 = await create_application(client, headers)
        assert r1.status_code == 201
        r2 = await create_application(client, headers)
        assert r2.status_code == 409

    async def test_duplicate_after_terminal_status_allowed(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        r1 = await create_application(client, headers)
        app_id = r1.json()["id"]
        # Close the first application; a new one becomes allowed.
        resp = await client.patch(
            f"/api/applications/{app_id}", json={"status": "rejected"}, headers=headers
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "rejected"
        r2 = await create_application(client, headers)
        assert r2.status_code == 201, r2.text
        assert r2.json()["status"] == "draft"

    async def test_patch_updates_fields(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        app_id = (await create_application(client, headers)).json()["id"]
        resp = await client.patch(
            f"/api/applications/{app_id}",
            json={"fit_rating": 75, "notes": "Good technical match", "channel": "jobstreet"},
            headers=headers,
        )
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["fit_rating"] == 75
        assert detail["notes"] == "Good technical match"
        assert detail["channel"] == "jobstreet"

    async def test_patch_invalid_status_is_rejected(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        app_id = (await create_application(client, headers)).json()["id"]
        resp = await client.patch(
            f"/api/applications/{app_id}", json={"status": "not-a-status"}, headers=headers
        )
        assert resp.status_code == 422

    async def test_patch_and_get_unknown_application_404(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await client.patch(
            "/api/applications/does-not-exist", json={"status": "submitted"}, headers=headers
        )
        assert resp.status_code == 404
        resp = await client.get("/api/applications/does-not-exist", headers=headers)
        assert resp.status_code == 404

    async def test_delete_application(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        app_id = (await create_application(client, headers)).json()["id"]
        resp = await client.delete(f"/api/applications/{app_id}", headers=headers)
        assert resp.status_code == 204
        resp = await client.get("/api/applications", headers=headers)
        assert resp.json() == []

    async def test_delete_unknown_application_404(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await client.delete("/api/applications/does-not-exist", headers=headers)
        assert resp.status_code == 404


class TestApplicationsTimeline:
    """Timeline timestamps are set honestly on status transitions."""

    async def test_submitted_sets_applied_at(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        app_id = (await create_application(client, headers)).json()["id"]
        resp = await client.patch(
            f"/api/applications/{app_id}", json={"status": "submitted"}, headers=headers
        )
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["applied_at"] is not None

    async def test_interview_sets_responded_and_interview_dates(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        app_id = (await create_application(client, headers)).json()["id"]
        await client.patch(f"/api/applications/{app_id}", json={"status": "submitted"}, headers=headers)
        resp = await client.patch(
            f"/api/applications/{app_id}", json={"status": "interview"}, headers=headers
        )
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["applied_at"] is not None
        assert detail["responded_at"] is not None
        assert detail["interview_at"] is not None

    async def test_terminal_status_sets_decided_at(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        app_id = (await create_application(client, headers)).json()["id"]
        await client.patch(f"/api/applications/{app_id}", json={"status": "submitted"}, headers=headers)
        resp = await client.patch(
            f"/api/applications/{app_id}", json={"status": "rejected"}, headers=headers
        )
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["applied_at"] is not None
        assert detail["responded_at"] is not None
        assert detail["decided_at"] is not None

    async def test_timestamps_do_not_overwrite(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        app_id = (await create_application(client, headers)).json()["id"]
        r1 = await client.patch(f"/api/applications/{app_id}", json={"status": "submitted"}, headers=headers)
        applied_at = r1.json()["applied_at"]
        r2 = await client.patch(f"/api/applications/{app_id}", json={"status": "submitted"}, headers=headers)
        assert r2.json()["applied_at"] == applied_at  # never overwritten


class TestApplicationsCrossUser:
    """User A can never read or mutate User B's application rows."""

    async def test_user_b_cannot_see_user_a_applications(self, client, store_files):
        await create_user("a@example.com")
        await create_user("b@example.com")
        headers_a = await auth_header(client, "a@example.com")
        headers_b = await auth_header(client, "b@example.com")
        await create_application(client, headers_a)
        resp_b = await client.get("/api/applications", headers=headers_b)
        assert resp_b.status_code == 200
        assert resp_b.json() == []

    async def test_user_b_cannot_patch_user_a_application(self, client, store_files):
        await create_user("a@example.com")
        await create_user("b@example.com")
        headers_a = await auth_header(client, "a@example.com")
        headers_b = await auth_header(client, "b@example.com")
        app_id = (await create_application(client, headers_a)).json()["id"]
        resp = await client.patch(
            f"/api/applications/{app_id}", json={"status": "rejected"}, headers=headers_b
        )
        assert resp.status_code == 404  # existence not leaked
        # A's row is untouched.
        resp_a = await client.get(f"/api/applications/{app_id}", headers=headers_a)
        assert resp_a.json()["status"] == "draft"

    async def test_user_b_cannot_delete_user_a_application(self, client, store_files):
        await create_user("a@example.com")
        await create_user("b@example.com")
        headers_a = await auth_header(client, "a@example.com")
        headers_b = await auth_header(client, "b@example.com")
        app_id = (await create_application(client, headers_a)).json()["id"]
        resp = await client.delete(f"/api/applications/{app_id}", headers=headers_b)
        assert resp.status_code == 404
        resp_a = await client.get("/api/applications", headers=headers_a)
        assert len(resp_a.json()) == 1

    async def test_users_keep_separate_application_lists(self, client, store_files):
        await create_user("a@example.com")
        await create_user("b@example.com")
        headers_a = await auth_header(client, "a@example.com")
        headers_b = await auth_header(client, "b@example.com")
        await create_application(client, headers_a)
        await create_application(client, headers_b)
        # A deletes own; only A's view changes.
        app_id_a = (await client.get("/api/applications", headers=headers_a)).json()[0]["id"]
        await client.delete(f"/api/applications/{app_id_a}", headers=headers_a)
        assert (await client.get("/api/applications", headers=headers_a)).json() == []
        assert len((await client.get("/api/applications", headers=headers_b)).json()) == 1


class TestApplicationsHonesty:
    """A job that leaves the global dataset is reported honestly."""

    async def test_removed_job_is_available_false(self, client, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        resp = await create_application(client, headers)
        assert resp.json()["available"] is True
        # Simulate the job disappearing from the global dataset.
        store_files["seen"].write_text(json.dumps({"seen": {}}), encoding="utf-8")
        store_files["canonical"].write_text(json.dumps([]), encoding="utf-8")
        from app import store as store_module
        store_module.invalidate_store_cache()
        resp = await client.get("/api/applications", headers=headers)
        item = resp.json()[0]
        assert item["available"] is False
        assert item["job"] is None  # no fabricated fields
        # The snapshotted company/role remain the honest record.
        assert item["company"] == "Test Corp"
        assert item["role"] == "IT Support Specialist"


class TestDeletePreservesSavedState:
    """Deleting an application must never remove the user's saved-job state."""

    async def test_delete_application_keeps_saved_job(self, client, db_manager, store_files):
        await create_user("a@example.com")
        headers = await auth_header(client, "a@example.com")
        # Save the job first (CP11 UserJob row).
        resp = await client.post("/api/saved-jobs/abc123", headers=headers)
        assert resp.status_code == 200
        # Create + delete an application for the same job.
        app_id = (await create_application(client, headers)).json()["id"]
        resp = await client.delete(f"/api/applications/{app_id}", headers=headers)
        assert resp.status_code == 204
        # The saved-job row survives.
        resp = await client.get("/api/saved-jobs", headers=headers)
        items = resp.json()
        assert len(items) == 1
        assert items[0]["stable_id"] == "abc123"


# Helper: attempt to create an application for a missing stable_id.
async def send_missing(client, headers):
    return await client.post("/api/applications", json={"stable_id": "does-not-exist"}, headers=headers)


@pytest.fixture
def generated_docs_root(tmp_path, monkeypatch):
    """Point the applications router's project root at an isolated temp tree."""
    from app.routers import applications as applications_router

    (tmp_path / "data" / "generated").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(applications_router, "get_project_root", lambda: tmp_path)
    return tmp_path


async def _set_document(app_id: str, field: str, value: str | None) -> None:
    """Rewrite a stored document path directly on an application row (bypasses the API)."""
    from sqlalchemy import select
    from app.models.database_models import Application

    async with get_db_manager().session() as session:
        result = await session.execute(select(Application).where(Application.id == app_id))
        row = result.scalar_one()
        setattr(row, field, value)
        await session.commit()


class TestDocumentDownload:
    """Secure streaming of generated CV/cover-letter PDFs (CP14 frontend gap)."""

    PDF_BYTES = b"%PDF-1.4\n%% test document\n%%EOF"

    async def _setup_app_with_cv(self, client, email="a@example.com", generated_docs_root=None):
        await create_user(email)
        headers = await auth_header(client, email)
        app_id = (await create_application(client, headers)).json()["id"]
        if generated_docs_root is not None:
            (generated_docs_root / "data" / "generated" / "cv_test.pdf").write_bytes(self.PDF_BYTES)
            await _set_document(app_id, "cv_file", "data/generated/cv_test.pdf")
        return headers, app_id

    async def test_download_requires_auth(self, client, store_files, generated_docs_root):
        headers, app_id = await self._setup_app_with_cv(client, generated_docs_root=generated_docs_root)
        resp = await client.get(f"/api/applications/{app_id}/documents/cv")
        assert resp.status_code == 401

    async def test_unknown_doc_kind_returns_404(self, client, store_files, generated_docs_root):
        headers, app_id = await self._setup_app_with_cv(client, generated_docs_root=generated_docs_root)
        resp = await client.get(f"/api/applications/{app_id}/documents/teenager", headers=headers)
        assert resp.status_code == 404

    async def test_no_document_returns_404(self, client, store_files, generated_docs_root):
        headers, app_id = await self._setup_app_with_cv(client)  # no cv_file stored
        resp = await client.get(f"/api/applications/{app_id}/documents/cv", headers=headers)
        assert resp.status_code == 404

    async def test_cv_download_streams_pdf(self, client, store_files, generated_docs_root):
        headers, app_id = await self._setup_app_with_cv(client, generated_docs_root=generated_docs_root)
        resp = await client.get(f"/api/applications/{app_id}/documents/cv", headers=headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/pdf")
        assert "attachment" in resp.headers.get("content-disposition", "").lower()
        assert '"cv_test.pdf"' in resp.headers["content-disposition"]
        assert resp.content == self.PDF_BYTES

    async def test_cover_letter_download_streams_pdf(self, client, store_files, generated_docs_root):
        headers, app_id = await self._setup_app_with_cv(client, generated_docs_root=generated_docs_root)
        (generated_docs_root / "data" / "generated" / "cover_test.pdf").write_bytes(self.PDF_BYTES)
        await _set_document(app_id, "cover_letter_file", "data/generated/cover_test.pdf")
        resp = await client.get(f"/api/applications/{app_id}/documents/cover_letter", headers=headers)
        assert resp.status_code == 200
        assert '"cover_test.pdf"' in resp.headers["content-disposition"]

    async def test_other_user_cannot_download(self, client, store_files, generated_docs_root):
        headers, app_id = await self._setup_app_with_cv(client, generated_docs_root=generated_docs_root)
        await create_user("b@example.com")
        headers_b = await auth_header(client, "b@example.com")
        resp = await client.get(f"/api/applications/{app_id}/documents/cv", headers=headers_b)
        assert resp.status_code == 404  # existence not leaked

    async def test_path_escape_outside_generated_dir_refused(self, client, store_files, generated_docs_root):
        # A stored relative path resolving outside data/generated must never stream.
        (generated_docs_root / "secret.txt").write_text("top secret", encoding="utf-8")
        headers, app_id = await self._setup_app_with_cv(client, generated_docs_root=generated_docs_root)
        await _set_document(app_id, "cv_file", "data/generated/../secret.txt")
        resp = await client.get(f"/api/applications/{app_id}/documents/cv", headers=headers)
        assert resp.status_code == 404

    async def test_absolute_path_refused(self, client, store_files, generated_docs_root):
        headers, app_id = await self._setup_app_with_cv(client, generated_docs_root=generated_docs_root)
        await _set_document(app_id, "cv_file", str(generated_docs_root / "data" / "generated" / "cv_test.pdf"))
        resp = await client.get(f"/api/applications/{app_id}/documents/cv", headers=headers)
        assert resp.status_code == 404  # absolute-server-path storage is invalid

    async def test_missing_file_returns_404(self, client, store_files, generated_docs_root):
        headers, app_id = await self._setup_app_with_cv(client, generated_docs_root=generated_docs_root)
        # File was never written; only the relative path is stored.
        await _set_document(app_id, "cv_file", "data/generated/missing.pdf")
        resp = await client.get(f"/api/applications/{app_id}/documents/cv", headers=headers)
        assert resp.status_code == 404