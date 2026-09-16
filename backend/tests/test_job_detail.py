"""Tests for the job detail endpoint - Checkpoint 10.

Covers:
  - Job detail retrieval by valid stable_id
  - Nonexistent job returns 404
  - Response matches the JobRecord schema
  - Scoring/ranking data from ranked_jobs.json is merged truthfully
  - No fabricated evaluation/rank data when the job was never scored
  - Authentication required for private job detail endpoints
  - No sensitive/internal fields leaked
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
from app.models.database_models import User, UserStatus, UserRole
from app.auth import hash_password


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Isolated SQLite manager."""
    db_path = os.path.join(tempfile.gettempdir(), f"test_job_detail_{uuid.uuid4().hex}.db")
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
async def regular_user(db_manager):
    """Create a regular test user."""
    async with db_manager.session() as session:
        user = User(
            name="Regular User",
            email="regular@example.com",
            password_hash=hash_password("password123"),
            status=UserStatus.ACTIVE,
            role=UserRole.USER,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


@pytest_asyncio.fixture
async def regular_user_headers(client, regular_user):
    """Get auth headers for regular user."""
    resp = await client.post("/api/auth/login", json={
        "email": "regular@example.com",
        "password": "password123"
    })
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def client(db_manager):
    """Async client fixture with DB for auth."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


SCORED_JOB = {
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

UNSCORED_JOB = {
    "stable_id": "xyz456",
    "title": "Junior Technician",
    "company": "Other Corp",
    "location": "Quezon City",
    "url": "https://example.com/job/2",
    "portal": "testportal",
    "arrangement": "onsite",
    "processing_state": "NEEDS_VERIFICATION",
    "first_seen": "2026-08-22",
}

RANKED_ENTRY = {
    "stable_id": "abc123",
    "title": "IT Support Specialist",
    "company": "Test Corp",
    "location": "Remote",
    "arrangement": "remote",
    "processing_state": "ACTIVE_VERIFIED",
    "rank_score": 85,
    "rank_verdict": "Strong Fit",
    "rank_date": "2026-08-25",
    "priority_tier": 1,
    "fit": "high",
    "strengths": ["Direct IT support experience"],
    "gaps": ["Live verification pending"],
    "evaluation": {
        "technical": 90,
        "experience": 85,
        "behavioral": 80,
        "location": "PASS",
        "location_note": "Remote",
        "career": 88,
        "overall": 87,
        "verdict": "Strong Fit",
        "key_strengths": ["Core match"],
        "gaps": ["Minor"],
        "recommendation": "Apply",
        "evaluated_at": "2026-08-25T10:00:00Z",
    },
}


@pytest.fixture
def store_files(tmp_path, monkeypatch):
    """Point the DataStore at isolated fixture files."""
    from app import store
    from app.config import ACTIVE_POOL_STATES

    files = {
        "canonical": tmp_path / "canonical_jobs.json",
        "seen": tmp_path / "seen_jobs.json",
        "ranked": tmp_path / "ranked_jobs.json",
        "tracker": tmp_path / "job_search_tracker.csv",
        "checkpoints": tmp_path / "checkpoints.json",
    }

    files["canonical"].write_text(
        json.dumps([SCORED_JOB, UNSCORED_JOB]), encoding="utf-8"
    )
    files["seen"].write_text(
        json.dumps({"seen": {j["stable_id"]: j for j in [SCORED_JOB, UNSCORED_JOB]}}),
        encoding="utf-8",
    )
    files["ranked"].write_text(json.dumps([RANKED_ENTRY]), encoding="utf-8")
    files["tracker"].write_text(
        "date,company,sector,role,role_type,channel,status,contact_person,fit_rating,notes,cv_file,cover_letter_file,source,stable_id\n",
        encoding="utf-8",
    )
    files["checkpoints"].write_text(json.dumps({}), encoding="utf-8")

    monkeypatch.setattr(store, "CANONICAL_JOBS_FILE", files["canonical"])
    monkeypatch.setattr(store, "SEEN_JOBS_FILE", files["seen"])
    monkeypatch.setattr(store, "RANKED_JOBS_FILE", files["ranked"])
    monkeypatch.setattr(store, "TRACKER_FILE", files["tracker"])
    monkeypatch.setattr(store, "CHECKPOINTS_FILE", files["checkpoints"])
    monkeypatch.setattr(store, "STALE_JOB_DAYS", 28)
    monkeypatch.setattr(store, "ACTIVE_POOL_STATES", ACTIVE_POOL_STATES)

    # Force a fresh store instance so cached prior reads are discarded.
    store.invalidate_store_cache()
    yield files
    store.invalidate_store_cache()


async def test_job_detail_success(store_files, client, regular_user_headers):
    resp = await client.get("/api/jobs/abc123", headers=regular_user_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["stable_id"] == "abc123"
    assert data["title"] == "IT Support Specialist"
    assert data["company"] == "Test Corp"


async def test_job_detail_unknown_stable_id_404(store_files, client, regular_user_headers):
    resp = await client.get("/api/jobs/does-not-exist", headers=regular_user_headers)
    assert resp.status_code == 404


async def test_job_detail_response_schema(store_files, client, regular_user_headers):
    resp = await client.get("/api/jobs/abc123", headers=regular_user_headers)
    assert resp.status_code == 200
    data = resp.json()
    required = [
        "stable_id", "title", "company", "location", "salary", "url", "portal",
        "arrangement", "processing_state", "rank_score", "rank_verdict",
        "strengths", "gaps", "fit", "evaluation",
    ]
    for field in required:
        assert field in data, f"missing JobRecord field: {field}"


async def test_job_detail_merges_scored_evaluation(store_files, client, regular_user_headers):
    """ranked_jobs.json scoring output is surfaced when present."""
    resp = await client.get("/api/jobs/abc123", headers=regular_user_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["rank_score"] == 85
    assert data["rank_verdict"] == "Strong Fit"
    assert data["fit"] == "high"
    assert data["strengths"] == ["Direct IT support experience"]
    ev = data["evaluation"]
    assert ev is not None
    assert ev["overall"] == 87
    assert ev["technical"] == 90
    assert ev["verdict"] == "Strong Fit"
    # Provenance preserved
    assert ev["evaluated_at"] == "2026-08-25T10:00:00Z"


async def test_job_detail_no_fabricated_evaluation(store_files, client, regular_user_headers):
    """Unscored jobs must not be given invented rank/evaluation data."""
    resp = await client.get("/api/jobs/xyz456", headers=regular_user_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["rank_score"] is None
    assert data["rank_verdict"] is None
    assert data["evaluation"] is None
    assert data["strengths"] == []
    assert data["gaps"] == []


async def test_job_detail_requires_auth(store_files, client):
    """Private job detail endpoints require authentication."""
    resp = await client.get("/api/jobs/abc123")
    assert resp.status_code == 401


async def test_job_detail_no_sensitive_fields(store_files, client, regular_user_headers):
    """Response never leaks internal pipeline/schema details."""
    resp = await client.get("/api/jobs/abc123", headers=regular_user_headers)
    assert resp.status_code == 200
    data = resp.json()
    lowered = json.dumps(data).lower()
    for secret in ("password", "secret", "token", "api_key", "private_key"):
        assert secret not in lowered, f"sensitive field leaked: {secret}"
    for internal in ("__pycache__", "\\app\\", "c:\\", "/app/"):
        assert internal not in lowered, f"filesystem path leaked: {internal}"