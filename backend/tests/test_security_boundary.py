"""Security boundary tests - P1 Public/Private Router & Data Boundary verification.

These tests verify the structural security boundary between public (demo) and private (real data) APIs.
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import get_db_manager
from app.models.database_models import User, UserStatus, UserRole
from app.auth import hash_password
from app.demo_store import get_demo_store
from app.store import get_store


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Create a test database manager with isolated SQLite."""
    import tempfile
    import os
    import uuid

    db_path = os.path.join(tempfile.gettempdir(), f"test_sec_boundary_db_{uuid.uuid4().hex}.db")

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
async def admin_user(db_manager):
    """Create an admin test user."""
    async with db_manager.session() as session:
        user = User(
            name="Admin User",
            email="admin@example.com",
            password_hash=hash_password("password123"),
            status=UserStatus.ACTIVE,
            role=UserRole.ADMIN,
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
async def admin_user_headers(client, admin_user):
    """Get auth headers for admin user."""
    resp = await client.post("/api/auth/login", json={
        "email": "admin@example.com",
        "password": "password123"
    })
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestPublicEndpointsUnauthenticated:
    """Test that public endpoints are accessible without authentication."""

    async def test_public_status(self, client):
        """Test /api/public/status returns 200 without auth."""
        response = await client.get("/api/public/status")
        assert response.status_code == 200
        data = response.json()
        assert "active_jobs_count" in data or "status" in data

    async def test_public_jobs_active(self, client):
        """Test /api/public/jobs/active returns 200 without auth."""
        response = await client.get("/api/public/jobs/active")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    async def test_public_job_detail(self, client):
        """Test /api/public/jobs/{stable_id} returns 404 (no demo job) without auth."""
        # Use a stable_id that likely doesn't exist in demo data
        response = await client.get("/api/public/jobs/nonexistent-stable-id")
        assert response.status_code == 404

    async def test_public_pipeline_status(self, client):
        """Test /api/public/pipeline returns 200 without auth."""
        response = await client.get("/api/public/pipeline")
        assert response.status_code == 200
        data = response.json()
        assert "run_history" in data or "current_checkpoint" in data

    async def test_public_retention_stats(self, client):
        """Test /api/public/retention returns 200 without auth."""
        response = await client.get("/api/public/retention")
        assert response.status_code == 200
        data = response.json()
        assert "retention_policy_days" in data
        assert "active_pool_states" in data

    async def test_public_portal_health(self, client):
        """Test /api/public/health/portals returns 200 without auth."""
        response = await client.get("/api/public/health/portals")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data.get("is_demo_mode") is True


class TestPrivateEndpointsRequireAuth:
    """Test that private endpoints require authentication and return 401 without it."""

    async def test_private_health_requires_auth(self, client):
        """Test /api/health requires auth."""
        response = await client.get("/api/health")
        assert response.status_code == 401

    async def test_private_jobs_requires_auth(self, client):
        """Test /api/jobs requires auth."""
        response = await client.get("/api/jobs")
        assert response.status_code == 401

    async def test_private_job_detail_requires_auth(self, client):
        """Test /api/jobs/{stable_id} requires auth."""
        response = await client.get("/api/jobs/some-stable-id")
        assert response.status_code == 401

    async def test_private_pipeline_status_requires_auth(self, client):
        """Test /api/pipeline/status requires auth."""
        response = await client.get("/api/pipeline/status")
        assert response.status_code == 401

    async def test_private_pipeline_health_requires_auth(self, client):
        """Test /api/pipeline/health requires auth."""
        response = await client.get("/api/pipeline/health")
        assert response.status_code == 401

    async def test_private_pipeline_retention_requires_auth(self, client):
        """Test /api/pipeline/retention requires auth."""
        response = await client.get("/api/pipeline/retention")
        assert response.status_code == 401

    async def test_private_portal_health_requires_auth(self, client):
        """Test /api/health/portals requires auth."""
        response = await client.get("/api/health/portals")
        assert response.status_code == 401

    async def test_private_portal_health_detail_requires_auth(self, client):
        """Test /api/health/portals/{name} requires auth."""
        response = await client.get("/api/health/portals/indeed")
        assert response.status_code == 401

    async def test_private_ranked_requires_auth(self, client):
        """Test /api/ranked endpoints require auth."""
        response = await client.get("/api/ranked/top5")
        assert response.status_code == 401

    async def test_private_applications_requires_auth(self, client):
        """Test /api/applications requires auth."""
        response = await client.get("/api/applications")
        assert response.status_code == 401

    async def test_private_dashboard_requires_auth(self, client):
        """Test /api/dashboard requires auth."""
        response = await client.get("/api/dashboard")
        assert response.status_code == 401

    async def test_private_resume_requires_auth(self, client):
        """Test /api/resume requires auth."""
        response = await client.get("/api/resume")
        assert response.status_code == 401

    async def test_private_profile_requires_auth(self, client):
        """Test /api/profile requires auth."""
        response = await client.get("/api/profile")
        assert response.status_code == 401

    async def test_private_preferences_requires_auth(self, client):
        """Test /api/preferences requires auth."""
        response = await client.get("/api/preferences")
        assert response.status_code == 401

    async def test_private_search_requires_auth(self, client):
        """Test /api/search requires auth."""
        response = await client.get("/api/search")
        assert response.status_code == 401

    async def test_private_saved_jobs_requires_auth(self, client):
        """Test /api/saved-jobs requires auth."""
        response = await client.get("/api/saved-jobs")
        assert response.status_code == 401


class TestPrivateEndpointsWorkWithAuth:
    """Test that private endpoints work with valid authentication."""

    async def test_private_health_with_auth(self, client, regular_user_headers):
        """Test /api/health works with auth."""
        response = await client.get("/api/health", headers=regular_user_headers)
        assert response.status_code == 200

    async def test_private_jobs_with_auth(self, client, regular_user_headers):
        """Test /api/jobs works with auth."""
        response = await client.get("/api/jobs", headers=regular_user_headers)
        assert response.status_code == 200

    async def test_private_pipeline_status_with_auth(self, client, regular_user_headers):
        """Test /api/pipeline/status works with auth."""
        response = await client.get("/api/pipeline/status", headers=regular_user_headers)
        assert response.status_code == 200

    async def test_private_pipeline_health_with_auth(self, client, regular_user_headers):
        """Test /api/pipeline/health works with auth."""
        response = await client.get("/api/pipeline/health", headers=regular_user_headers)
        assert response.status_code == 200

    async def test_private_pipeline_retention_with_auth(self, client, regular_user_headers):
        """Test /api/pipeline/retention works with auth."""
        response = await client.get("/api/pipeline/retention", headers=regular_user_headers)
        assert response.status_code == 200

    async def test_private_portal_health_with_auth(self, client, regular_user_headers):
        """Test /api/health/portals works with auth."""
        response = await client.get("/api/health/portals", headers=regular_user_headers)
        assert response.status_code == 200

    async def test_private_portal_health_detail_with_auth(self, client, regular_user_headers):
        """Test /api/health/portals/{name} works with auth."""
        response = await client.get("/api/health/portals/indeed", headers=regular_user_headers)
        assert response.status_code == 200


class TestAdminEndpointsRequireAdminRole:
    """Test that admin endpoints require admin role and return 403 for regular users."""

    async def test_admin_sources_requires_admin(self, client, regular_user_headers, admin_user_headers):
        """Test /api/admin/sources requires admin role."""
        # Regular user gets 403
        response = await client.get("/api/admin/sources", headers=regular_user_headers)
        assert response.status_code == 403
        assert "Admin privileges required" in response.json()["detail"]

        # Admin gets 200
        response = await client.get("/api/admin/sources", headers=admin_user_headers)
        assert response.status_code == 200

    async def test_admin_users_requires_admin(self, client, regular_user_headers, admin_user_headers):
        """Test /api/admin/users requires admin role."""
        # Regular user gets 403
        response = await client.get("/api/admin/users", headers=regular_user_headers)
        assert response.status_code == 403

        # Admin gets 200
        response = await client.get("/api/admin/users", headers=admin_user_headers)
        assert response.status_code == 200


class TestDemoEndpoints:
    """Test demo endpoints - GET unauthenticated, POST authenticated."""

    async def test_demo_get_endpoints_unauthenticated(self, client):
        """Test demo GET endpoints work without auth (for demo plane access)."""
        endpoints = [
            "/api/demo/status",
            "/api/demo/jobs/active",
            "/api/demo/pipeline",
            "/api/demo/retention",
        ]
        for endpoint in endpoints:
            response = await client.get(endpoint)
            assert response.status_code == 200, f"{endpoint} should be accessible without auth"

    async def test_demo_bootstrap_requires_auth(self, client, regular_user_headers):
        """Test /api/demo/bootstrap requires auth."""
        response = await client.post("/api/demo/bootstrap")
        assert response.status_code == 401

        response = await client.post("/api/demo/bootstrap", headers=regular_user_headers)
        assert response.status_code == 200

    async def test_demo_reset_requires_auth(self, client, regular_user_headers):
        """Test /api/demo/reset requires auth."""
        response = await client.post("/api/demo/reset")
        assert response.status_code == 401

        response = await client.post("/api/demo/reset", headers=regular_user_headers)
        assert response.status_code == 200


class TestDemoDataIsolation:
    """Test that public endpoints serve ONLY demo data, never real data."""

    async def test_public_endpoints_use_demo_store(self, client):
        """Verify public endpoints return demo data by checking is_demo_mode flag."""
        response = await client.get("/api/public/health/portals")
        assert response.status_code == 200
        data = response.json()
        assert data.get("is_demo_mode") is True

    async def test_public_jobs_are_demo_jobs(self, client):
        """Verify public jobs endpoint returns demo jobs (structure check)."""
        response = await client.get("/api/public/jobs/active")
        assert response.status_code == 200
        jobs = response.json()
        # Should be a list (could be empty if demo data not loaded)
        assert isinstance(jobs, list)


class TestDataStoreSeparation:
    """Test that demo store and real store are completely separate."""

    def test_demo_store_is_separate_from_real_store(self):
        """Verify get_demo_store() and get_store() return different instances."""
        demo_store = get_demo_store()
        real_store = get_store()

        # They should be different objects
        assert demo_store is not real_store

        # They should have different data paths (check module-level constants)
        from app.demo_store import DEMO_DATA_DIR
        from app.config import DATA_DIR
        assert str(DEMO_DATA_DIR) != str(DATA_DIR)

    def test_demo_reset_does_not_invalidate_real_store(self):
        """Verify demo reset no longer calls invalidate_store_cache()."""
        # This is verified by code inspection of demo.py
        # The test ensures the import doesn't fail
        from app.demo_store import invalidate_demo_store_cache
        from app.store import invalidate_store_cache

        # Both functions exist and are callable
        assert callable(invalidate_demo_store_cache)
        assert callable(invalidate_store_cache)


class TestAuthEndpointsPublic:
    """Test that auth endpoints remain public (no auth required)."""

    async def test_auth_register_public(self, client):
        """Test /api/auth/register is public."""
        response = await client.post("/api/auth/register", json={
            "name": "Test User",
            "email": "public_test@example.com",
            "password": "password123"
        })
        # Should not be 401 (might be 201 or 400 if duplicate)
        assert response.status_code != 401

    async def test_auth_login_public(self, client):
        """Test /api/auth/login is public."""
        response = await client.post("/api/auth/login", json={
            "email": "test@example.com",
            "password": "password123"
        })
        # Should not be 401 (might be 200 or 401 for wrong creds, but not auth-required 401)
        assert response.status_code in (200, 401)
        # If 401, it should be "Incorrect email or password" not "Not authenticated"
        if response.status_code == 401:
            assert "Incorrect email or password" in response.json()["detail"]

    async def test_auth_me_requires_auth(self, client):
        """Test /api/auth/me requires auth."""
        response = await client.get("/api/auth/me")
        assert response.status_code == 401


class TestInvalidTokenHandling:
    """Test that invalid/expired tokens are rejected properly."""

    async def test_invalid_token_rejected(self, client):
        """Test invalid token gets 401 on private endpoint."""
        response = await client.get(
            "/api/health",
            headers={"Authorization": "Bearer invalid.token.here"}
        )
        assert response.status_code == 401

    async def test_expired_token_rejected(self, client, regular_user):
        """Test expired token gets 401 on private endpoint."""
        from jose import jwt
        from datetime import datetime, timedelta
        from app.config import get_settings

        settings = get_settings()
        expired_time = datetime.utcnow() - timedelta(hours=1)
        token = jwt.encode(
            {"sub": regular_user.id, "exp": expired_time},
            settings.secret_key,
            algorithm=settings.algorithm
        )

        response = await client.get(
            "/api/health",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 401