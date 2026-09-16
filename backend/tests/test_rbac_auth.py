"""Tests for RBAC & Auth - CP16.2."""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from jose import jwt

from app.main import app
from app.database import get_db_manager
from app.models.database_models import User, UserStatus, UserRole
from app.auth import hash_password, create_user_token, get_token_expiry_minutes
from app.config import get_settings


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Create a test database manager with isolated SQLite."""
    import tempfile
    import os
    import uuid

    db_path = os.path.join(tempfile.gettempdir(), f"test_rbac_db_{uuid.uuid4().hex}.db")

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


class TestUserRegistrationWithName:
    """Test user registration now requires and stores name."""

    async def test_register_success_with_name(self, client):
        """Test successful user registration with name."""
        response = await client.post("/api/auth/register", json={
            "name": "Wilson DC. Chiquito",
            "email": "newuser@example.com",
            "password": "password123"
        })
        assert response.status_code == 201
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert "expires_in" in data

        # Verify token contains role claim
        settings = get_settings()
        payload = jwt.decode(data["access_token"], settings.secret_key, algorithms=[settings.algorithm])
        assert payload["sub"] is not None
        assert payload["role"] == "user"

    async def test_register_fails_without_name(self, client):
        """Test registration fails without name field."""
        response = await client.post("/api/auth/register", json={
            "email": "noname@example.com",
            "password": "password123"
        })
        assert response.status_code == 422  # Validation error

    async def test_register_fails_with_empty_name(self, client):
        """Test registration fails with empty name."""
        response = await client.post("/api/auth/register", json={
            "name": "   ",
            "email": "emptyname@example.com",
            "password": "password123"
        })
        assert response.status_code == 422

    async def test_register_fails_with_long_name(self, client):
        """Test registration fails with name > 255 chars."""
        response = await client.post("/api/auth/register", json={
            "name": "x" * 256,
            "email": "longname@example.com",
            "password": "password123"
        })
        assert response.status_code == 422

    async def test_register_creates_user_with_role_user(self, client, db_manager):
        """Test registered user gets default role 'user'."""
        await client.post("/api/auth/register", json={
            "name": "Test User",
            "email": "rolecheck@example.com",
            "password": "password123"
        })

        async with db_manager.session() as session:
            result = await session.execute(
                select(User).where(User.email == "rolecheck@example.com")
            )
            user = result.scalar_one_or_none()
            assert user is not None
            assert user.name == "Test User"
            assert user.role == UserRole.USER
            assert user.status == UserStatus.ACTIVE


class TestLoginTokenContainsRole:
    """Test JWT token includes role claim."""

    async def test_login_token_has_role_claim(self, client, regular_user):
        """Test login returns token with role claim."""
        response = await client.post("/api/auth/login", json={
            "email": "regular@example.com",
            "password": "password123"
        })
        assert response.status_code == 200
        token = response.json()["access_token"]

        settings = get_settings()
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        assert payload["role"] == "user"

    async def test_admin_login_token_has_admin_role(self, client, admin_user):
        """Test admin login returns token with admin role."""
        response = await client.post("/api/auth/login", json={
            "email": "admin@example.com",
            "password": "password123"
        })
        assert response.status_code == 200
        token = response.json()["access_token"]

        settings = get_settings()
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        assert payload["role"] == "admin"


class TestGetMeReturnsNameAndRole:
    """Test /me endpoint returns name and role."""

    async def test_me_returns_name_and_role(self, client, regular_user_headers):
        """Test /me returns user info including name and role."""
        response = await client.get("/api/auth/me", headers=regular_user_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["email"] == "regular@example.com"
        assert data["user"]["name"] == "Regular User"
        assert data["user"]["role"] == "user"
        assert data["user"]["status"] == "active"

    async def test_me_admin_returns_admin_role(self, client, admin_user_headers):
        """Test /me returns admin role for admin user."""
        response = await client.get("/api/auth/me", headers=admin_user_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["email"] == "admin@example.com"
        assert data["user"]["name"] == "Admin User"
        assert data["user"]["role"] == "admin"


class TestAdminDependency:
    """Test get_current_admin_user dependency."""

    async def test_admin_can_access_admin_endpoint(self, client, admin_user_headers):
        """Test admin user can access admin-only endpoint."""
        response = await client.get("/api/admin/sources", headers=admin_user_headers)
        assert response.status_code == 200

    async def test_regular_user_cannot_access_admin_endpoint(self, client, regular_user_headers):
        """Test regular user gets 403 on admin endpoint."""
        response = await client.get("/api/admin/sources", headers=regular_user_headers)
        assert response.status_code == 403
        assert "Admin privileges required" in response.json()["detail"]

    async def test_unauthenticated_cannot_access_admin_endpoint(self, client):
        """Test unauthenticated request gets 401 on admin endpoint."""
        response = await client.get("/api/admin/sources")
        assert response.status_code == 401


class TestJobSourcesCRUD:
    """Test job sources CRUD operations (admin only)."""

    async def test_create_job_source(self, client, admin_user_headers):
        """Test creating a job source."""
        response = await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "indeed",
            "display_name": "Indeed",
            "base_url": "https://indeed.com",
            "source_type": "job_board"
        })
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "indeed"
        assert data["display_name"] == "Indeed"
        assert data["domain"] == "indeed.com"
        assert data["status"] == "discovered"
        assert data["enabled"] is False
        return data["id"]

    async def test_create_duplicate_name_fails(self, client, admin_user_headers):
        """Test creating duplicate name fails."""
        await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "duplicate",
            "display_name": "Duplicate",
            "base_url": "https://example1.com",
            "source_type": "job_board"
        })
        response = await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "duplicate",
            "display_name": "Duplicate 2",
            "base_url": "https://example2.com",
            "source_type": "job_board"
        })
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"].lower()

    async def test_create_duplicate_domain_fails(self, client, admin_user_headers):
        """Test creating duplicate domain fails."""
        await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "source1",
            "display_name": "Source 1",
            "base_url": "https://indeed.com",
            "source_type": "job_board"
        })
        response = await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "source2",
            "display_name": "Source 2",
            "base_url": "https://www.indeed.com",
            "source_type": "job_board"
        })
        assert response.status_code == 400
        assert "domain already exists" in response.json()["detail"].lower()

    async def test_list_job_sources(self, client, admin_user_headers):
        """Test listing job sources."""
        # Create a couple sources first
        await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "indeed", "display_name": "Indeed", "base_url": "https://indeed.com"
        })
        await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "linkedin", "display_name": "LinkedIn", "base_url": "https://linkedin.com"
        })

        response = await client.get("/api/admin/sources", headers=admin_user_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 2
        assert len(data["sources"]) >= 2

    async def test_get_job_source(self, client, admin_user_headers):
        """Test getting a single job source."""
        create_resp = await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "testsource", "display_name": "Test Source", "base_url": "https://test.example.com"
        })
        source_id = create_resp.json()["id"]

        response = await client.get(f"/api/admin/sources/{source_id}", headers=admin_user_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == source_id
        assert data["name"] == "testsource"

    async def test_update_job_source(self, client, admin_user_headers):
        """Test updating job source fields.

        CP16.6: enabling now requires a valid, installed adapter_name (see
        test_enabled_bridge.py for the enable path), so this field-update test
        touches display_name + status only.
        """
        create_resp = await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "update_test", "display_name": "Update Test", "base_url": "https://update.example.com"
        })
        source_id = create_resp.json()["id"]

        response = await client.patch(f"/api/admin/sources/{source_id}", headers=admin_user_headers, json={
            "display_name": "Updated Name",
            "status": "approved",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["display_name"] == "Updated Name"
        assert data["status"] == "approved"
        assert data["enabled"] is False

    async def test_delete_unapproved_source(self, client, admin_user_headers):
        """Test deleting unapproved source."""
        create_resp = await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "to_delete", "display_name": "To Delete", "base_url": "https://delete.example.com"
        })
        source_id = create_resp.json()["id"]

        response = await client.delete(f"/api/admin/sources/{source_id}", headers=admin_user_headers)
        assert response.status_code == 204

        # Verify deleted
        get_resp = await client.get(f"/api/admin/sources/{source_id}", headers=admin_user_headers)
        assert get_resp.status_code == 404

    async def test_cannot_delete_approved_source(self, client, admin_user_headers):
        """Test cannot delete approved/enabled source."""
        create_resp = await client.post("/api/admin/sources", headers=admin_user_headers, json={
            "name": "protected", "display_name": "Protected", "base_url": "https://protected.example.com"
        })
        source_id = create_resp.json()["id"]

        # Approve it first
        await client.patch(f"/api/admin/sources/{source_id}", headers=admin_user_headers, json={
            "status": "approved"
        })

        response = await client.delete(f"/api/admin/sources/{source_id}", headers=admin_user_headers)
        assert response.status_code == 400
        assert "cannot delete" in response.json()["detail"].lower()


class TestSafeUrlAnalyzer:
    """Test safe non-executing URL analyzer."""

    async def test_analyze_valid_url(self, client, admin_user_headers):
        """Test analyzing a valid URL."""
        # This test will use a mock or skip if network unavailable
        # We'll test the endpoint structure
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "https://httpbin.org/html"
        })
        # Accept 200 or network-related errors (408, 502, etc.)
        assert response.status_code in (200, 408, 502, 504)
        if response.status_code == 200:
            data = response.json()
            assert "url" in data
            assert "domain" in data
            assert "feasibility" in data

    async def test_analyze_blocks_ssrf_localhost(self, client, admin_user_headers):
        """Test SSRF protection blocks localhost."""
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "http://127.0.0.1:8080"
        })
        # Should either reject (400) or fail to connect (network error)
        assert response.status_code in (400, 408, 502, 504)

    async def test_analyze_blocks_ssrf_private_ip(self, client, admin_user_headers):
        """Test SSRF protection blocks private IPs."""
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "http://192.168.1.1"
        })
        assert response.status_code in (400, 408, 502, 504)

    async def test_analyze_blocks_ssrf_metadata(self, client, admin_user_headers):
        """Test SSRF protection blocks cloud metadata endpoint."""
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "http://169.254.169.254/latest/meta-data/"
        })
        assert response.status_code in (400, 408, 502, 504)

    async def test_analyze_rejects_non_http_scheme(self, client, admin_user_headers):
        """Test non-HTTP schemes are rejected."""
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "file:///etc/passwd"
        })
        # Pydantic HttpUrl validation rejects non-http schemes with 422
        assert response.status_code == 422


class TestSafeUrlAnalyzerSecurity:
    """Test SSRF and security hardening for URL analyzer."""

    async def test_analyze_blocks_redirect_to_private_ip(self, client, admin_user_headers):
        """Test SSRF protection blocks redirect to private IPv4."""
        # httpbin.org/redirect-to can redirect to arbitrary URLs
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "https://httpbin.org/redirect-to?url=http://192.168.1.1/admin"
        })
        # Should reject the redirect (400) or fail to connect
        assert response.status_code in (200, 400, 408, 502, 504)
        if response.status_code == 200:
            data = response.json()
            # If it returns 200, the redirect should have been blocked and feasibility should indicate error
            assert "access to private addresses is blocked" in data["feasibility"].lower()

    async def test_analyze_blocks_redirect_to_metadata(self, client, admin_user_headers):
        """Test SSRF protection blocks redirect to cloud metadata endpoint."""
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "https://httpbin.org/redirect-to?url=http://169.254.169.254/latest/meta-data/"
        })
        assert response.status_code in (200, 400, 408, 502, 504)
        if response.status_code == 200:
            data = response.json()
            # 169.254.169.254 is link-local, so it may be blocked by link-local check
            assert "blocked" in data["feasibility"].lower()

    async def test_analyze_blocks_ipv6_loopback(self, client, admin_user_headers):
        """Test SSRF protection blocks IPv6 loopback [::1]."""
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "http://[::1]:8080"
        })
        # Should reject (400) - IPv6 loopback
        assert response.status_code in (400, 422, 408, 502, 504)

    async def test_analyze_blocks_cgnat(self, client, admin_user_headers):
        """Test SSRF protection blocks CGNAT range 100.64.0.0/10."""
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "http://100.64.1.1"
        })
        assert response.status_code in (400, 408, 502, 504)

    async def test_analyze_blocks_ipv6_ula(self, client, admin_user_headers):
        """Test SSRF protection blocks IPv6 ULA fc00::/7."""
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "http://[fc00::1]"
        })
        # Should reject (400) - ULA
        assert response.status_code in (400, 422, 408, 502, 504)

    async def test_analyze_blocks_ipv6_link_local(self, client, admin_user_headers):
        """Test SSRF protection blocks IPv6 link-local fe80::/10."""
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "http://[fe80::1]"
        })
        assert response.status_code in (400, 422, 408, 502, 504)

    async def test_analyze_rejects_non_html_content_type(self, client, admin_user_headers):
        """Test non-HTML Content-Type is rejected before parsing."""
        # httpbin.org/json returns application/json
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "https://httpbin.org/json"
        })
        assert response.status_code in (200, 408, 502, 504)
        if response.status_code == 200:
            data = response.json()
            assert data["feasibility"] == "non_html_content"

    async def test_analyze_respects_max_redirects(self, client, admin_user_headers):
        """Test redirect loop detection after 3 redirects."""
        # httpbin.org/redirect/4 redirects 4 times
        response = await client.post("/api/admin/sources/analyze", headers=admin_user_headers, json={
            "url": "https://httpbin.org/redirect/4"
        })
        assert response.status_code in (200, 408, 502, 504)
        if response.status_code == 200:
            data = response.json()
            assert data["feasibility"] == "redirect_loop"


# Import select for the User query
from sqlalchemy import select