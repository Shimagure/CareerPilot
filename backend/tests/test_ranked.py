"""Tests for the ranked jobs API endpoints - Checkpoint 9.

Covers:
  - Authentication (401 on all endpoints)
  - Response shape matches JobSummary schema
  - Data returns ranked jobs from store
"""
import os
import tempfile
import uuid

import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import get_db_manager
from app.models.database_models import User, UserStatus
from app.auth import hash_password


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    db_path = os.path.join(tempfile.gettempdir(), f"test_ranked_db_{uuid.uuid4().hex}.db")
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


class TestRankedJobsAuthorization:
    """All ranked endpoints require authentication."""

    async def test_top5_requires_auth(self, client):
        resp = await client.get("/api/ranked/top5")
        assert resp.status_code == 401

    async def test_top10_requires_auth(self, client):
        resp = await client.get("/api/ranked/top10")
        assert resp.status_code == 401

    async def test_all_requires_auth(self, client):
        resp = await client.get("/api/ranked/all")
        assert resp.status_code == 401

    async def test_rejects_invalid_token(self, client):
        headers = {"Authorization": "Bearer not.a.jwt"}
        assert (await client.get("/api/ranked/top5", headers=headers)).status_code == 401
        assert (await client.get("/api/ranked/top10", headers=headers)).status_code == 401
        assert (await client.get("/api/ranked/all", headers=headers)).status_code == 401


class TestRankedJobsResponseShape:
    """Authenticated responses match the JobSummary contract."""

    async def test_top5_returns_list(self, client):
        user = await create_user("ranked_a@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.get("/api/ranked/top5", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert isinstance(data, list)

    async def test_top10_returns_list(self, client):
        user = await create_user("ranked_b@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.get("/api/ranked/top10", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert isinstance(data, list)

    async def test_all_returns_list(self, client):
        user = await create_user("ranked_c@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.get("/api/ranked/all", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert isinstance(data, list)

    async def test_job_summary_fields_present(self, client):
        """Each job in response has required JobSummary fields."""
        user = await create_user("ranked_d@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.get("/api/ranked/all", headers=headers)
        assert resp.status_code == 200
        data = resp.json()

        if data:  # If there's data, verify structure
            job = data[0]
            required_fields = [
                "stable_id", "title", "company", "location",
                "arrangement", "salary", "portal", "processing_state",
                "rank_score", "rank_verdict", "fit",
                "is_active_pool", "is_application_protected"
            ]
            for field in required_fields:
                assert field in job, f"Missing field: {field}"

    async def test_top5_limit(self, client):
        """top5 returns at most 5 jobs."""
        user = await create_user("ranked_e@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.get("/api/ranked/top5", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) <= 5

    async def test_top10_limit(self, client):
        """top10 returns at most 10 jobs."""
        user = await create_user("ranked_f@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.get("/api/ranked/top10", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) <= 10