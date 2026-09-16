"""P3.2 production-surface hardening tests.

Covers the three P3.2 work items:

1. API documentation exposure:
   - development  -> /docs, /redoc, /openapi.json served (developer-friendly)
   - production   -> documentation/schema not mounted (404), driven by the
     existing production configuration model, with authenticated/private API
     functionality preserved.
2. Production security headers:
   - production emits X-Frame-Options, X-Content-Type-Options,
     Referrer-Policy on every HTTP response (including API and public demo
     routes), without breaking CORS.
   - development emits none of these.
3. Regression anchors: the P1 public/private boundary still holds under a
   production-built app (public remains open, private stays authenticated).
"""
import os
import tempfile
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch

from app.main import app, create_app
from app.config import get_settings
from app.database import get_db_manager
from app.models.database_models import User, UserStatus, UserRole
from app.auth import hash_password


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Isolated test database (mirrors the other suites' pattern)."""
    db_path = os.path.join(tempfile.gettempdir(), f"test_prod_surface_{uuid.uuid4().hex}.db")
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


@pytest.fixture
def prod_app():
    """A CareerPilot app instance built under a valid production environment."""
    with patch.dict(
        os.environ,
        {
            "ENVIRONMENT": "production",
            "SECRET_KEY": "prod-test-secret-not-the-default",
            "CORS_ALLOWED_ORIGINS": "https://app.example.com",
            "DATABASE_URL": "sqlite+aiosqlite:////tmp/careerpilot_prod_surface_test.db",
        },
        clear=True,
    ):
        get_settings.cache_clear()
        try:
            yield create_app()
        finally:
            get_settings.cache_clear()


@pytest_asyncio.fixture
async def dev_client(db_manager):
    """Client against the module-global (development-built) app."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def prod_client(prod_app, db_manager):
    """Client against the production-built app."""
    async with AsyncClient(transport=ASGITransport(app=prod_app), base_url="http://test") as ac:
        yield ac


async def create_user(email: str, role: UserRole = UserRole.USER) -> User:
    async with get_db_manager().session() as session:
        user = User(
            name="Prod Surface User",
            email=email,
            password_hash=hash_password("password123"),
            status=UserStatus.ACTIVE,
            role=role,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


# ──────────────────────────────────────────────────────────────────────────────
# 1. API documentation exposure
# ──────────────────────────────────────────────────────────────────────────────

class TestApiDocumentationExposure:
    async def test_development_serves_docs_and_schema(self, dev_client):
        """Development keeps the developer-friendly API documentation."""
        assert (await dev_client.get("/docs")).status_code == 200
        assert (await dev_client.get("/redoc")).status_code == 200
        assert (await dev_client.get("/openapi.json")).status_code == 200
        root = await dev_client.get("/")
        assert root.status_code == 200
        assert root.json()["docs"] == "/docs"

    def test_development_app_registers_openapi(self):
        assert app.openapi_url == "/openapi.json"
        assert app.docs_url == "/docs"
        assert app.redoc_url == "/redoc"

    async def test_production_hides_docs_and_schema(self, prod_client):
        """Production must not expose docs/schema to unauthenticated browsers."""
        assert (await prod_client.get("/docs")).status_code == 404
        assert (await prod_client.get("/redoc")).status_code == 404
        assert (await prod_client.get("/openapi.json")).status_code == 404
        root = await prod_client.get("/")
        assert root.status_code == 200
        assert root.json()["docs"] is None

    def test_production_app_does_not_register_openapi(self, prod_app):
        assert prod_app.openapi_url is None
        assert prod_app.docs_url is None
        assert prod_app.redoc_url is None

    async def test_production_private_endpoints_still_require_auth(self, prod_client):
        """Production hides docs but keeps private API protection intact."""
        for path in ("/api/health", "/api/jobs", "/api/ranked/top5", "/api/applications"):
            resp = await prod_client.get(path)
            assert resp.status_code == 401, f"{path} should be 401 without auth"

    async def test_production_public_demo_routes_still_open(self, prod_client):
        """The P1 public/demo boundary is unchanged under a production app."""
        resp = await prod_client.get("/api/public/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "active_jobs_count" in data or "status" in data

    async def test_production_authenticated_flow_still_works(self, prod_client, db_manager):
        """Authenticated/private API functionality is preserved in production."""
        await create_user("auth_prod@example.com")
        login = await prod_client.post(
            "/api/auth/login",
            json={"email": "auth_prod@example.com", "password": "password123"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        resp = await prod_client.get("/api/health", headers=headers)
        assert resp.status_code == 200


# ──────────────────────────────────────────────────────────────────────────────
# 2. Production security headers
# ──────────────────────────────────────────────────────────────────────────────

class TestProductionSecurityHeaders:
    EXPECTED = {
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
    }

    async def test_production_sets_headers_on_api_response(self, prod_client):
        resp = await prod_client.get("/api/health")  # 401, still a response
        for name, value in self.EXPECTED.items():
            assert resp.headers.get(name) == value, f"missing/invalid {name}"

    async def test_production_sets_headers_on_public_demo_routes(self, prod_client):
        resp = await prod_client.get("/api/public/status")
        assert resp.status_code == 200
        for name, value in self.EXPECTED.items():
            assert resp.headers.get(name) == value, f"missing/invalid {name}"

    async def test_production_sets_headers_on_root_and_not_found(self, prod_client):
        resp = await prod_client.get("/")
        assert resp.status_code == 200
        assert resp.headers.get("x-frame-options") == "DENY"
        # A 404 (e.g. docs in production) still carries the headers.
        resp = await prod_client.get("/docs")
        assert resp.status_code == 404
        assert resp.headers.get("x-content-type-options") == "nosniff"

    async def test_development_does_not_emit_security_headers(self, dev_client):
        resp = await dev_client.get("/api/public/status")
        assert resp.status_code == 200
        assert "x-frame-options" not in resp.headers
        assert "x-content-type-options" not in resp.headers
        assert "referrer-policy" not in resp.headers

    async def test_production_cors_still_served(self, prod_client):
        """CORS behavior is preserved alongside the new headers."""
        resp = await prod_client.get(
            "/api/public/status",
            headers={"Origin": "https://app.example.com"},
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "https://app.example.com"
        # And the security headers are present on the same response.
        assert resp.headers.get("x-frame-options") == "DENY"

    def test_production_header_set_matches_policy(self):
        from app.security_headers import production_security_headers
        headers = production_security_headers()
        assert headers["X-Frame-Options"] == "DENY"
        assert headers["X-Content-Type-Options"] == "nosniff"
        assert headers["Referrer-Policy"] == "strict-origin-when-cross-origin"