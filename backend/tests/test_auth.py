"""Tests for authentication - Checkpoint 2 verification."""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import get_db_manager
from app.models.database_models import User, UserStatus
from app.auth import hash_password, verify_password, create_access_token, decode_token


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Create a test database manager with isolated SQLite."""
    import tempfile
    import os
    import uuid

    db_path = os.path.join(tempfile.gettempdir(), f"test_auth_db_{uuid.uuid4().hex}.db")

    manager = get_db_manager()
    # Reinitialize with test database
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
async def test_user(db_manager):
    """Create a test user."""
    async with db_manager.session() as session:
        user = User(
            name="Test User",
            email="test@example.com",
            password_hash=hash_password("password123"),
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


class TestPasswordHashing:
    """Test password hashing utilities."""

    def test_hash_password(self):
        """Test password hashing produces different hash each time."""
        password = "testpassword123"
        hash1 = hash_password(password)
        hash2 = hash_password(password)
        assert hash1 != hash2  # bcrypt uses salt
        assert hash1.startswith("$2b$")
        assert hash2.startswith("$2b$")

    def test_verify_password_correct(self):
        """Test verifying correct password."""
        password = "testpassword123"
        hashed = hash_password(password)
        assert verify_password(password, hashed) is True

    def test_verify_password_incorrect(self):
        """Test verifying incorrect password."""
        password = "testpassword123"
        hashed = hash_password(password)
        assert verify_password("wrongpassword", hashed) is False


class TestJWTToken:
    """Test JWT token creation and validation."""

    def test_create_and_decode_token(self):
        """Test creating and decoding a token."""
        data = {"sub": "user-id-123"}
        token = create_access_token(data)
        assert isinstance(token, str)
        assert len(token) > 0

        payload = decode_token(token)
        assert payload is not None
        assert payload["sub"] == "user-id-123"
        assert "exp" in payload

    def test_decode_invalid_token(self):
        """Test decoding invalid token returns None."""
        payload = decode_token("invalid.token.string")
        assert payload is None

    def test_decode_expired_token(self):
        """Test decoding expired token returns None."""
        import time
        from datetime import datetime, timedelta
        from app.config import get_settings

        settings = get_settings()
        # Create token that expired 1 hour ago
        expired_time = datetime.utcnow() - timedelta(hours=1)
        token = jwt.encode({"sub": "user-id", "exp": expired_time}, settings.secret_key, algorithm=settings.algorithm)

        payload = decode_token(token)
        assert payload is None


class TestAuthEndpoints:
    """Test authentication API endpoints."""

    async def test_register_success(self, client):
        """Test successful user registration."""
        response = await client.post("/api/auth/register", json={
            "name": "New User",
            "email": "newuser@example.com",
            "password": "password123"
        })
        assert response.status_code == 201
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert "expires_in" in data

    async def test_register_duplicate_email(self, client, test_user):
        """Test registration with duplicate email fails."""
        response = await client.post("/api/auth/register", json={
            "name": "Test User",
            "email": "test@example.com",
            "password": "password123"
        })
        assert response.status_code == 400
        assert response.json()["detail"] == "Email already registered"

    async def test_register_weak_password(self, client):
        """Test registration with weak password fails."""
        response = await client.post("/api/auth/register", json={
            "email": "weak@example.com",
            "password": "short"
        })
        assert response.status_code == 422  # Validation error

    async def test_login_success(self, client, test_user):
        """Test successful login."""
        response = await client.post("/api/auth/login", json={
            "email": "test@example.com",
            "password": "password123"
        })
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    async def test_login_wrong_password(self, client, test_user):
        """Test login with wrong password fails."""
        response = await client.post("/api/auth/login", json={
            "email": "test@example.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        assert response.json()["detail"] == "Incorrect email or password"

    async def test_login_nonexistent_user(self, client):
        """Test login with nonexistent user fails."""
        response = await client.post("/api/auth/login", json={
            "email": "nonexistent@example.com",
            "password": "password123"
        })
        assert response.status_code == 401
        assert response.json()["detail"] == "Incorrect email or password"

    async def test_get_me_authenticated(self, client, test_user):
        """Test getting current user with valid token."""
        # First login to get token
        login_response = await client.post("/api/auth/login", json={
            "email": "test@example.com",
            "password": "password123"
        })
        token = login_response.json()["access_token"]

        # Use token to get current user
        response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["email"] == "test@example.com"
        assert data["user"]["status"] == "active"

    async def test_get_me_no_token(self, client):
        """Test getting current user without token fails."""
        response = await client.get("/api/auth/me")
        assert response.status_code == 401

    async def test_get_me_invalid_token(self, client):
        """Test getting current user with invalid token fails."""
        response = await client.get("/api/auth/me", headers={"Authorization": "Bearer invalid.token"})
        assert response.status_code == 401

    async def test_get_me_expired_token(self, client, test_user):
        """Test getting current user with expired token fails."""
        import time
        from datetime import datetime, timedelta
        from app.config import get_settings

        settings = get_settings()
        expired_time = datetime.utcnow() - timedelta(hours=1)
        token = jwt.encode({"sub": test_user.id, "exp": expired_time}, settings.secret_key, algorithm=settings.algorithm)

        response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 401

    async def test_logout(self, client, test_user):
        """Test logout endpoint."""
        login_response = await client.post("/api/auth/login", json={
            "email": "test@example.com",
            "password": "password123"
        })
        token = login_response.json()["access_token"]

        response = await client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert response.json()["message"] == "Successfully logged out"


class TestAuthDependency:
    """Test get_current_user dependency for protected routes."""

    async def test_protected_route_with_token(self, client, test_user):
        """Test accessing protected route with valid token."""
        login_response = await client.post("/api/auth/login", json={
            "email": "test@example.com",
            "password": "password123"
        })
        token = login_response.json()["access_token"]

        # Test a protected route (we can test /api/auth/me which uses the dependency)
        response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200

    async def test_protected_route_without_token(self, client):
        """Test accessing protected route without token fails."""
        response = await client.get("/api/auth/me")
        assert response.status_code == 401


# Import jwt for expired token test
from jose import jwt