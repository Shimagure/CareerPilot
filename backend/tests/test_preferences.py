"""Tests for the search preferences API - Checkpoint 6.

Covers authentication, create/retrieve/update/persistence, server-side
validation, whitespace/duplicate normalization, honest default/empty state,
dashboard readiness reflection, and cross-user isolation.

Preferences are user-controlled intent: they are only ever written from the
request body and are never populated from resumes/profiles/jobs.
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
    db_path = os.path.join(tempfile.gettempdir(), f"test_preferences_db_{uuid.uuid4().hex}.db")
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


class TestPreferencesAuthorization:
    """Preference endpoints must require authentication and be user-scoped."""

    async def test_get_preferences_requires_auth(self, client):
        resp = await client.get("/api/preferences")
        assert resp.status_code == 401

    async def test_put_preferences_requires_auth(self, client):
        resp = await client.put("/api/preferences", json={"target_roles": ["IT Support"]})
        assert resp.status_code == 401

    async def test_get_preferences_invalid_token(self, client):
        resp = await client.get("/api/preferences", headers={"Authorization": "Bearer bad.token"})
        assert resp.status_code == 401


class TestPreferencesEmptyState:
    """A new user has no preferences and nothing is fabricated."""

    async def test_get_preferences_empty_initially(self, client, db_manager):
        user = await create_user("empty_prefs@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.get("/api/preferences", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["preferences"] is None

    async def test_no_auto_population_from_profile(self, client, db_manager):
        """Preferences are never silently filled from anything else."""
        user = await create_user("no_autofill@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.get("/api/preferences", headers=headers)
        assert resp.json()["preferences"] is None

    async def test_put_empty_body_rejected(self, client, db_manager):
        user = await create_user("empty_put@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={})
        assert resp.status_code == 400


class TestPreferencesPersistence:
    """Create, retrieve, update, and confirm persistence across requests."""

    async def test_create_and_retrieve(self, client, db_manager):
        user = await create_user("create_prefs@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={
            "target_roles": ["IT Support Specialist", "Systems Administrator"],
            "preferred_locations": ["Metro Manila", "Remote"],
            "work_arrangements": ["remote", "hybrid"],
            "salary_min": 30000,
            "salary_max": 45000,
            "salary_currency": "PHP",
            "career_direction": "Move toward systems and cloud administration.",
        })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["target_roles"] == ["IT Support Specialist", "Systems Administrator"]
        assert data["preferred_locations"] == ["Metro Manila", "Remote"]
        assert data["work_arrangements"] == ["remote", "hybrid"]
        assert data["salary_min"] == 30000
        assert data["salary_max"] == 45000
        assert data["salary_currency"] == "PHP"
        assert data["salary_period"] == "monthly"
        assert data["configured"] is True

        # A second request sees the same data (persisted in the session's DB).
        resp2 = await client.get("/api/preferences", headers=headers)
        assert resp2.status_code == 200
        got = resp2.json()["preferences"]
        assert got["target_roles"] == ["IT Support Specialist", "Systems Administrator"]
        assert got["salary_max"] == 45000

    async def test_update_merge(self, client, db_manager):
        user = await create_user("update_prefs@example.com")
        headers = await auth_header(client, user.email)
        await client.put("/api/preferences", headers=headers, json={
            "target_roles": ["IT Support"],
            "salary_min": 30000,
        })
        # Sparse update: add salary_max without resending target_roles.
        resp = await client.put("/api/preferences", headers=headers, json={"salary_max": 45000})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["target_roles"] == ["IT Support"]
        assert data["salary_min"] == 30000
        assert data["salary_max"] == 45000

    async def test_explicit_empty_list_clears(self, client, db_manager):
        user = await create_user("clear_prefs@example.com")
        headers = await auth_header(client, user.email)
        await client.put("/api/preferences", headers=headers, json={"target_roles": ["IT Support"]})
        resp = await client.put("/api/preferences", headers=headers, json={"target_roles": []})
        assert resp.status_code == 200
        assert resp.json()["target_roles"] == []

    async def test_work_arrangements_map_flags_and_persist(self, client, db_manager):
        user = await create_user("arrangements@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={"work_arrangements": ["onsite"]})
        assert resp.status_code == 200
        assert resp.json()["work_arrangements"] == ["onsite"]
        resp2 = await client.get("/api/preferences", headers=headers)
        assert resp2.json()["preferences"]["work_arrangements"] == ["onsite"]

    async def test_salary_period_explicit(self, client, db_manager):
        user = await create_user("period@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={"salary_period": "annual"})
        assert resp.status_code == 200
        assert resp.json()["salary_period"] == "annual"
        bad = await client.put("/api/preferences", headers=headers, json={"salary_period": "per-paycheck"})
        assert bad.status_code == 422


class TestPreferencesNormalization:
    """Whitespace trimming, empty drops, and duplicate prevention."""

    async def test_list_normalization(self, client, db_manager):
        user = await create_user("norm@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={
            "target_roles": ["  IT Support  ", "it support", "", "  ", "SysAdmin"],
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["target_roles"] == ["IT Support", "SysAdmin"]

    async def test_arrangement_dedup(self, client, db_manager):
        user = await create_user("dedup@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={
            "work_arrangements": ["remote", "remote", "hybrid"],
        })
        assert resp.status_code == 200
        assert resp.json()["work_arrangements"] == ["remote", "hybrid"]


class TestPreferencesValidation:
    """Server-side validation rejects pathological payloads."""

    async def test_invalid_salary_range(self, client, db_manager):
        user = await create_user("bad_range@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={
            "salary_min": 50000,
            "salary_max": 30000,
        })
        assert resp.status_code == 422

    async def test_sparse_update_creates_invalid_range(self, client, db_manager):
        """A sparse PUT that would conflict with the stored value must be rejected."""
        user = await create_user("sparse_range@example.com")
        headers = await auth_header(client, user.email)
        await client.put("/api/preferences", headers=headers, json={"salary_max": 30000})
        resp = await client.put("/api/preferences", headers=headers, json={"salary_min": 50000})
        assert resp.status_code == 422

    async def test_negative_salary_rejected(self, client, db_manager):
        user = await create_user("neg_salary@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={"salary_min": -1})
        assert resp.status_code == 422

    async def test_salary_upper_bound(self, client, db_manager):
        user = await create_user("big_salary@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={"salary_max": 99_000_000})
        assert resp.status_code == 422

    async def test_invalid_arrangement_rejected(self, client, db_manager):
        user = await create_user("bad_arr@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={"work_arrangements": ["mars"]})
        assert resp.status_code == 422

    async def test_oversized_list_rejected(self, client, db_manager):
        user = await create_user("too_many@example.com")
        headers = await auth_header(client, user.email)
        roles = [f"Role {i}" for i in range(51)]
        resp = await client.put("/api/preferences", headers=headers, json={"target_roles": roles})
        assert resp.status_code == 422

    async def test_oversized_string_rejected(self, client, db_manager):
        user = await create_user("too_long@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={"target_roles": ["x" * 201]})
        assert resp.status_code == 422

    async def test_invalid_currency_rejected(self, client, db_manager):
        user = await create_user("bad_currency@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={"salary_currency": "12"})
        assert resp.status_code == 422

    async def test_oversized_career_direction_rejected(self, client, db_manager):
        user = await create_user("long_career@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={"career_direction": "x" * 2001})
        assert resp.status_code == 422

    async def test_non_list_field_rejected(self, client, db_manager):
        user = await create_user("not_list@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/preferences", headers=headers, json={"target_roles": "IT Support"})
        assert resp.status_code == 422


class TestPreferencesDefaults:
    """The 'configured' signal is honest: meaningful values only."""

    async def test_configured_false_until_saved(self, client, db_manager):
        user = await create_user("config_state@example.com")
        headers = await auth_header(client, user.email)
        # Default-only save (arrangements left at remote+hybrid) is not 'configured'.
        resp = await client.put("/api/preferences", headers=headers, json={"work_arrangements": ["remote", "hybrid"]})
        assert resp.status_code == 200
        assert resp.json()["configured"] is False

        # A real signal flips it on.
        resp = await client.put("/api/preferences", headers=headers, json={"target_roles": ["IT Support"]})
        assert resp.json()["configured"] is True

    async def test_dashboard_reflects_preferences_honestly(self, client, db_manager):
        user = await create_user("dash_prefs@example.com")
        headers = await auth_header(client, user.email)

        resp = await client.get("/api/dashboard", headers=headers)
        assert resp.json()["profile_readiness"]["search_preferences_configured"] is False

        # Detecting a departure from arrangement defaults counts.
        await client.put("/api/preferences", headers=headers, json={"work_arrangements": ["onsite"]})
        resp = await client.get("/api/dashboard", headers=headers)
        assert resp.json()["profile_readiness"]["search_preferences_configured"] is True

        # Additional second user: still not configured before its own save.
        user_b = await create_user("dash_prefs_b@example.com")
        headers_b = await auth_header(client, user_b.email)
        resp = await client.get("/api/dashboard", headers=headers_b)
        assert resp.json()["profile_readiness"]["search_preferences_configured"] is False


class TestPreferencesIsolation:
    """User A's preferences are never visible to or modifiable by User B."""

    async def test_cross_user_isolation(self, client, db_manager):
        user_a = await create_user("iso_a@example.com")
        user_b = await create_user("iso_b@example.com")
        headers_a = await auth_header(client, user_a.email)
        headers_b = await auth_header(client, user_b.email)

        await client.put("/api/preferences", headers=headers_a, json={
            "target_roles": ["A's secret role"],
            "salary_min": 90000,
        })

        # B starts empty and never sees A's data.
        resp_b = await client.get("/api/preferences", headers=headers_b)
        assert resp_b.status_code == 200
        assert resp_b.json()["preferences"] is None

        # B writes its own preferences.
        resp_b = await client.put("/api/preferences", headers=headers_b, json={"target_roles": ["B's role"]})
        assert resp_b.status_code == 200

        # A's data remains intact after B's write.
        resp_a = await client.get("/api/preferences", headers=headers_a)
        assert resp_a.json()["preferences"]["target_roles"] == ["A's secret role"]
        assert resp_a.json()["preferences"]["salary_min"] == 90000

        # B still only sees B's own data.
        resp_b2 = await client.get("/api/preferences", headers=headers_b)
        assert resp_b2.json()["preferences"]["target_roles"] == ["B's role"]

        # A's response never contains B's values.
        assert all("B's role" not in str(v) for v in resp_a.json()["preferences"].values())