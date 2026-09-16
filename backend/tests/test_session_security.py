"""P3.4 tests: session token versioning, logout revocation, deactivation, and
JWT validation hardening.

Covers:
  - login/register tokens embed the account's current token_version claim
  - a stale token_version claim is rejected (401 "revoked")
  - a token missing the token_version claim is rejected (fail-closed for
    tokens issued before session versioning)
  - logout revokes all outstanding tokens via a server-side version bump,
    and a fresh login afterwards issues a usable token
  - logout without credentials is unauthorized
  - a non-active account rejects otherwise-valid tokens (live status check)
  - explicit algorithm/signing verification: a wrong-signature token and an
    alg:"none" token are both rejected
  - a token missing the required "sub" claim is rejected
"""
import os
import tempfile
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from jose import jwt
from sqlalchemy import select

from app.main import app
from app.database import get_db_manager
from app.models.database_models import User, UserStatus
from app.auth import hash_password, create_access_token, create_user_token
from app.config import get_settings


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Create a test database manager with isolated SQLite."""
    db_path = os.path.join(tempfile.gettempdir(), f"test_session_db_{uuid.uuid4().hex}.db")

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
async def test_user(db_manager):
    """Create a test user (token_version defaults to 1)."""
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


async def _login(client, email: str = "test@example.com", password: str = "password123") -> str:
    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


async def _bump_token_version(db_manager, user_id: str, *, new_status=None) -> int:
    """Increment the user's token_version (optionally also changing status),
    simulating logout or a server-side security state change."""
    async with db_manager.session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one()
        user.token_version += 1
        if new_status is not None:
            user.status = new_status
        await session.commit()
        return user.token_version


class TestTokenVersionClaim:
    async def test_login_token_embeds_current_token_version(self, client, test_user):
        token = await _login(client)
        settings = get_settings()
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        assert payload["sub"] == str(test_user.id)
        assert payload["token_version"] == test_user.token_version == 1

    async def test_register_token_embeds_token_version(self, client):
        resp = await client.post("/api/auth/register", json={
            "name": "New User",
            "email": "tv_register@example.com",
            "password": "password123",
        })
        assert resp.status_code == 201
        settings = get_settings()
        payload = jwt.decode(resp.json()["access_token"], settings.secret_key, algorithms=[settings.algorithm])
        assert payload["token_version"] == 1


class TestSessionInvalidation:
    async def test_bumped_version_rejects_outstanding_token(self, client, db_manager, test_user):
        token = await _login(client)
        assert (await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})).status_code == 200

        await _bump_token_version(db_manager, test_user.id)

        resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Token has been revoked, please sign in again"

    async def test_token_missing_version_claim_rejected(self, client, test_user):
        # A token issued before session versioning has no claim; fail closed.
        token = create_user_token(user_id=str(test_user.id), role="user")
        resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Token has been revoked, please sign in again"

    async def test_fresh_login_after_bump_succeeds(self, client, db_manager, test_user):
        token = await _login(client)
        await _bump_token_version(db_manager, test_user.id)

        # The old token is dead...
        old = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert old.status_code == 401

        # ...but a fresh login issues a token with the new version.
        new_token = await _login(client)
        settings = get_settings()
        payload = jwt.decode(new_token, settings.secret_key, algorithms=[settings.algorithm])
        assert payload["token_version"] == 2
        fresh = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_token}"})
        assert fresh.status_code == 200


class TestLogoutRevocation:
    async def test_logout_revokes_outstanding_tokens(self, client, test_user):
        token = await _login(client)

        resp = await client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["message"] == "Successfully logged out"

        me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 401
        assert me.json()["detail"] == "Token has been revoked, please sign in again"

    async def test_logout_without_token_is_unauthorized(self, client):
        resp = await client.post("/api/auth/logout")
        assert resp.status_code == 401


class TestDeactivationInvalidation:
    async def test_non_active_account_rejects_valid_token(self, client, db_manager, test_user):
        token = await _login(client)

        await _bump_token_version(db_manager, test_user.id, new_status=UserStatus.SUSPENDED)

        resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "User account is not active"


class TestJwtValidationHardening:
    async def test_wrong_signature_token_rejected(self, client, test_user):
        token = jwt.encode(
            {"sub": str(test_user.id), "token_version": 1},
            "attacker-controlled-key",
            algorithm="HS256",
        )
        resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid or expired token"

    async def test_alg_none_token_rejected(self, client, test_user):
        import base64
        import json
        from jose.exceptions import JWSError

        # 1. python-jose refuses to even emit an unsigned ("none") token.
        with pytest.raises(JWSError):
            jwt.encode({"sub": str(test_user.id), "token_version": 1}, key=None, algorithm="none")

        # 2. An attacker hand-crafts an unsigned JWT (alg "none", empty
        #    signature); decode must refuse it because "none" is not in the
        #    allowed algorithm list (HS256).
        def _b64(raw: bytes) -> str:
            return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

        header = _b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
        body = _b64(json.dumps({"sub": str(test_user.id), "token_version": 1}).encode())
        forged = f"{header}.{body}."

        resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"})
        assert resp.status_code == 401

    async def test_token_missing_sub_claim_rejected(self, client, test_user):
        token = create_access_token({"role": "user", "token_version": 1})
        resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid token payload"