"""P3.3 tests: security audit logging for auth and admin events.

Covers:
  - login success / failure events are recorded as JSON lines
  - registration success is recorded
  - admin source update / delete actions are recorded
  - emails are masked, and passwords / JWTs / secrets never appear in the log
  - source_analyze URLs are sanitized (no query strings, userinfo, fragments)

All events are written to a per-test temp file via audit.set_audit_log_path().
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app import audit
from app.auth import hash_password
from app.database import get_db_manager
from app.main import app
from app.models.database_models import (
    JobSource,
    JobSourceStatus,
    JobSourceType,
    User,
    UserRole,
    UserStatus,
)
from app.ssrf import BlockedDestinationError, PinnedTransport, UrlValidation


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    db_path = os.path.join(tempfile.gettempdir(), f"test_audit_{uuid.uuid4().hex}.db")
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


@pytest.fixture(autouse=True)
def isolated_audit_log(tmp_path):
    """Point the audit log at a fresh temp file for every test."""
    log_path = tmp_path / "audit.log"
    audit.reset()
    audit.set_audit_log_path(log_path)
    yield log_path
    audit.reset()


async def create_user(db_manager, email: str, *, role: UserRole = UserRole.USER) -> User:
    async with db_manager.session() as session:
        user = User(
            name="Test User",
            email=email,
            password_hash=hash_password("password123"),
            status=UserStatus.ACTIVE,
            role=role,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


def read_audit_lines(log_path: Path) -> list[dict]:
    if not log_path.exists():
        return []
    return [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]


def raw_log_text(log_path: Path) -> str:
    return log_path.read_text(encoding="utf-8") if log_path.exists() else ""


def make_recording_transport():
    """Return (RecordingPinnedTransport, captures) where each constructed
    transport records the pinned host->IP map it was built with.  Used to
    prove which validated destinations each hop's transport is pinned to."""
    captures = []

    class RecordingPinnedTransport(PinnedTransport):
        def __init__(self, pinned, **kwargs):
            self.pinned = dict(pinned)
            super().__init__(pinned, **kwargs)
            captures.append(self)

    return RecordingPinnedTransport, captures


def _resp(status: int, headers=None, text: str = ""):
    r = MagicMock()
    r.status_code = status
    r.headers = headers or {}
    r.text = text
    return r


def _mock_async_client():
    """Return (mock_client_class, mock_client) configured so every
    httpx.AsyncClient() yields the same async-mocked client."""
    import httpx as httpx_module
    from unittest.mock import AsyncMock, MagicMock

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client_class = MagicMock(return_value=mock_client)
    return mock_client_class, mock_client, httpx_module


class TestAuthAudit:
    async def test_login_failure_recorded_without_password(self, client, db_manager, isolated_audit_log):
        resp = await client.post("/api/auth/login", json={
            "email": "victim@example.com",
            "password": "Sup3rSecret!",
        })
        assert resp.status_code == 401

        lines = read_audit_lines(isolated_audit_log)
        assert len(lines) == 1, lines
        evt = lines[0]
        assert evt["cat"] == "auth"
        assert evt["event"] == "login_failure"
        assert "password" not in str(evt).lower()
        # Email is masked — the raw local part never appears.
        assert evt.get("email") == "vi***@example.com"
        assert "victim@example.com" not in raw_log_text(isolated_audit_log)
        assert "Sup3rSecret!" not in raw_log_text(isolated_audit_log)

    async def test_login_success_recorded(self, client, db_manager, isolated_audit_log):
        await create_user(db_manager, "alice@example.com")
        resp = await client.post("/api/auth/login", json={
            "email": "alice@example.com",
            "password": "password123",
        })
        assert resp.status_code == 200

        lines = read_audit_lines(isolated_audit_log)
        events = [l["event"] for l in lines]
        assert "login_success" in events
        success = next(l for l in lines if l["event"] == "login_success")
        assert success["cat"] == "auth"
        assert success.get("uid") is not None
        assert success.get("email") == "al***@example.com"

    async def test_register_success_recorded_with_masked_email(self, client, isolated_audit_log):
        resp = await client.post("/api/auth/register", json={
            "name": "New User",
            "email": "newbie@example.com",
            "password": "password123",
        })
        assert resp.status_code == 201

        lines = read_audit_lines(isolated_audit_log)
        register = [l for l in lines if l["event"] == "register_success"]
        assert len(register) == 1
        assert register[0]["email"] == "ne***@example.com"
        # The access token returned by register must never be logged.
        token = resp.json()["access_token"]
        assert token not in raw_log_text(isolated_audit_log)

    async def test_register_failure_recorded_for_duplicate_email(self, client, db_manager, isolated_audit_log):
        await create_user(db_manager, "dup@example.com")
        resp = await client.post("/api/auth/register", json={
            "name": "Dup",
            "email": "dup@example.com",
            "password": "password123",
        })
        assert resp.status_code == 400

        events = [l["event"] for l in read_audit_lines(isolated_audit_log)]
        assert "register_failure" in events

    async def test_audit_never_contains_jwt_or_credentials(self, client, db_manager, isolated_audit_log):
        # A mix of successful and failed auths must still leave the log clean.
        await create_user(db_manager, "carol@example.com")
        good = await client.post("/api/auth/login", json={
            "email": "carol@example.com",
            "password": "password123",
        })
        assert good.status_code == 200
        token = good.json()["access_token"]

        await client.post("/api/auth/login", json={
            "email": "carol@example.com",
            "password": "wrongpass",
        })

        text = raw_log_text(isolated_audit_log)
        assert token not in text
        assert "password123" not in text
        assert "wrongpass" not in text
        assert "carol@example.com" not in text  # masked


class TestAdminAudit:
    async def test_source_update_recorded(self, client, db_manager, isolated_audit_log):
        admin = await create_user(db_manager, "admin-a@example.com", role=UserRole.ADMIN)
        login = await client.post("/api/auth/login", json={
            "email": "admin-a@example.com",
            "password": "password123",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        async with db_manager.session() as session:
            src = JobSource(
                name="update-target",
                display_name="Old Name",
                base_url="https://example.org/",
                domain="example.org",
                source_type=JobSourceType.JOB_BOARD,
                status=JobSourceStatus.DISCOVERED,
                enabled=False,
            )
            session.add(src)
            await session.commit()
            await session.refresh(src)
            source_id = src.id

        resp = await client.patch(f"/api/admin/sources/{source_id}", headers=headers,
                                  json={"display_name": "New Name"})
        assert resp.status_code == 200

        updates = [l for l in read_audit_lines(isolated_audit_log) if l.get("action") == "source_update"]
        assert len(updates) == 1, events
        assert updates[0]["cat"] == "admin"
        assert updates[0]["target_type"] == "source"
        assert updates[0]["target_id"] == str(source_id)
        assert str(admin.id) in str(updates[0]["uid"]) or updates[0]["uid"] == str(admin.id)

    async def test_source_delete_recorded(self, client, db_manager, isolated_audit_log):
        await create_user(db_manager, "admin-d@example.com", role=UserRole.ADMIN)
        login = await client.post("/api/auth/login", json={
            "email": "admin-d@example.com",
            "password": "password123",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        async with db_manager.session() as session:
            src = JobSource(
                name="delete-target",
                display_name="To Delete",
                base_url="https://example.net/",
                domain="example.net",
                source_type=JobSourceType.JOB_BOARD,
                status=JobSourceStatus.DISCOVERED,
                enabled=False,
            )
            session.add(src)
            await session.commit()
            await session.refresh(src)
            source_id = src.id

        resp = await client.delete(f"/api/admin/sources/{source_id}", headers=headers)
        assert resp.status_code == 204

        deletes = [l for l in read_audit_lines(isolated_audit_log) if l.get("action") == "source_delete"]
        assert len(deletes) == 1, deletes
        assert deletes[0]["target_id"] == str(source_id)


class TestAuditURLSanitization:
    """Tests for audit log URL sanitization - no sensitive data in logs."""

    @pytest_asyncio.fixture(scope="function")
    async def admin_client(self, client, db_manager):
        """Create an admin user and return authenticated client."""
        await create_user(db_manager, "admin@example.com", role=UserRole.ADMIN)
        resp = await client.post("/api/auth/login", json={
            "email": "admin@example.com",
            "password": "password123",
        })
        assert resp.status_code == 200
        return {"Authorization": f"Bearer {resp.json()['access_token']}"}

    async def test_analyze_url_sanitizes_query_strings(self, client, db_manager, admin_client, isolated_audit_log):
        """Query strings with tokens/API keys must not appear in audit log."""
        import httpx as httpx_module
        from app.ssrf import UrlValidation

        # Bypass DNS so the test stays deterministic
        from unittest.mock import patch
        with patch("app.routers.admin_sources.validate_outbound_url") as mock_validate:
            mock_validate.return_value = UrlValidation(
                scheme="https",
                hostname="example.com",
                resolved_ips=("93.184.216.34",),
            )
            with patch.object(httpx_module, "AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.headers = {"content-type": "text/html"}
                mock_response.text = "<html><title>Test</title></html>"
                mock_client.get = AsyncMock(return_value=mock_response)
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=False)
                mock_client_class.return_value = mock_client

                resp = await client.post("/api/admin/sources/analyze", headers=admin_client, json={
                    "url": "https://example.com/jobs?api_key=secret123&token=abcxyz&user=admin",
                })
                assert resp.status_code == 200

        lines = read_audit_lines(isolated_audit_log)
        analyze_events = [l for l in lines if l.get("action") == "source_analyze"]
        assert len(analyze_events) == 1
        detail = analyze_events[0].get("detail", "")
        target_id = analyze_events[0].get("target_id", "")

        # Verify no sensitive data in detail
        assert "api_key=secret123" not in detail
        assert "token=abcxyz" not in detail
        assert "user=admin" not in detail
        assert "?" not in detail  # No query string at all

        # Verify target_id is just netloc
        assert target_id == "example.com"
        assert "?" not in target_id

        # The raw log must never contain the query string values or the URL.
        text = raw_log_text(isolated_audit_log)
        assert "api_key=secret123" not in text
        assert "token=abcxyz" not in text
        assert "user=admin" not in text
        assert "https://example.com/jobs?api_key=secret123&token=abcxyz&user=admin" not in text

    async def test_analyze_url_sanitizes_userinfo(self, client, db_manager, admin_client, isolated_audit_log):
        """URLs with username:password must not leak credentials in audit log."""
        import httpx as httpx_module
        from app.ssrf import UrlValidation
        from unittest.mock import patch, AsyncMock, MagicMock

        with patch("app.routers.admin_sources.validate_outbound_url") as mock_validate:
            mock_validate.return_value = UrlValidation(
                scheme="https",
                hostname="example.com",
                resolved_ips=("93.184.216.34",),
            )
            with patch.object(httpx_module, "AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.headers = {"content-type": "text/html"}
                mock_response.text = "<html><title>Test</title></html>"
                mock_client.get = AsyncMock(return_value=mock_response)
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=False)
                mock_client_class.return_value = mock_client

                resp = await client.post("/api/admin/sources/analyze", headers=admin_client, json={
                    "url": "https://user:pass@example.com/jobs",
                })
                assert resp.status_code == 200

        lines = read_audit_lines(isolated_audit_log)
        analyze_events = [l for l in lines if l.get("action") == "source_analyze"]
        assert len(analyze_events) == 1
        detail = analyze_events[0].get("detail", "")
        target_id = analyze_events[0].get("target_id", "")

        # Verify no credentials in detail
        assert "user:pass" not in detail
        assert "user@" not in detail
        assert ":pass" not in detail

        # Verify target_id is just netloc without userinfo
        assert target_id == "example.com"
        assert "@" not in target_id

        # The raw log must never contain username/password or the userinfo URL.
        text = raw_log_text(isolated_audit_log)
        assert "user:pass" not in text
        assert "user@" not in text
        assert ":pass@" not in text
        assert "https://user:pass@example.com/jobs" not in text

    async def test_analyze_url_sanitizes_fragment(self, client, db_manager, admin_client, isolated_audit_log):
        """URL fragments must not appear in audit log."""
        import httpx as httpx_module
        from app.ssrf import UrlValidation
        from unittest.mock import patch, AsyncMock, MagicMock

        with patch("app.routers.admin_sources.validate_outbound_url") as mock_validate:
            mock_validate.return_value = UrlValidation(
                scheme="https",
                hostname="example.com",
                resolved_ips=("93.184.216.34",),
            )
            with patch.object(httpx_module, "AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.headers = {"content-type": "text/html"}
                mock_response.text = "<html><title>Test</title></html>"
                mock_client.get = AsyncMock(return_value=mock_response)
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=False)
                mock_client_class.return_value = mock_client

                resp = await client.post("/api/admin/sources/analyze", headers=admin_client, json={
                    "url": "https://example.com/jobs#section=secret",
                })
                assert resp.status_code == 200

        lines = read_audit_lines(isolated_audit_log)
        analyze_events = [l for l in lines if l.get("action") == "source_analyze"]
        assert len(analyze_events) == 1
        detail = analyze_events[0].get("detail", "")

        # Verify no fragment in detail
        assert "#section=secret" not in detail
        assert "#" not in detail

        # The raw log must never contain the fragment or the fragment URL.
        text = raw_log_text(isolated_audit_log)
        assert "#section=secret" not in text
        assert "https://example.com/jobs#section=secret" not in text

    async def test_redirect_destinations_revalidated_and_repinned(
        self, client, admin_client, isolated_audit_log
    ):
        """Each redirect hop gets its OWN freshly-validated pinned transport;
        a stale pin for the previous host must never be reused."""
        import httpx as httpx_module
        from unittest.mock import AsyncMock, MagicMock

        RecordingPinnedTransport, captures = make_recording_transport()

        def fake_validate(url, *, allow_redirect=False):
            if url == "https://example.com/start":
                return UrlValidation("https", "example.com", ("93.184.216.34",))
            if url == "https://other.example.com/target":
                return UrlValidation("https", "other.example.com", ("203.0.113.7",))
            if url == "https://example.com/robots.txt":
                return UrlValidation("https", "example.com", ("93.184.216.34",))
            raise AssertionError(f"unexpected URL passed to validate_outbound_url: {url}")

        with patch("app.routers.admin_sources.validate_outbound_url", side_effect=fake_validate):
            with patch("app.routers.admin_sources.PinnedTransport", RecordingPinnedTransport):
                with patch.object(httpx_module, "AsyncClient") as mock_client_class:
                    mock_client = AsyncMock()
                    mock_client.get = AsyncMock(side_effect=[
                        _resp(301, {"location": "https://other.example.com/target"}),
                        _resp(200, {"content-type": "text/html"}, "<html><title>Redirected</title></html>"),
                        _resp(200, {"content-type": "text/plain"}, "User-agent: *\nAllow: /\n"),
                    ])
                    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                    mock_client.__aexit__ = AsyncMock(return_value=False)
                    mock_client_class.return_value = mock_client

                    resp = await client.post("/api/admin/sources/analyze", headers=admin_client, json={
                        "url": "https://example.com/start",
                    })
                    assert resp.status_code == 200

        # One transport per hop: initial, redirect (freshly validated + pinned),
        # then robots.  Each is a distinct instance carrying only that hop's
        # validated destination — no stale pin survives a redirect.
        pins = [t.pinned for t in captures]
        assert len(pins) == 3
        assert pins[0] == {"example.com": ("93.184.216.34",)}
        assert pins[1] == {"other.example.com": ("203.0.113.7",)}
        assert pins[2] == {"example.com": ("93.184.216.34",)}
        assert captures[0] is not captures[1]

    async def test_blocked_redirect_target_is_not_followed(
        self, client, admin_client, isolated_audit_log
    ):
        """A redirect whose freshly-validated destination is non-public must be
        refused before any connection is attempted to it."""
        import httpx as httpx_module
        from unittest.mock import AsyncMock

        RecordingPinnedTransport, captures = make_recording_transport()

        def fake_validate(url, *, allow_redirect=False):
            if url == "https://example.com/start":
                return UrlValidation("https", "example.com", ("93.184.216.34",))
            raise BlockedDestinationError("Access to private addresses is blocked")

        with patch("app.routers.admin_sources.validate_outbound_url", side_effect=fake_validate):
            with patch("app.routers.admin_sources.PinnedTransport", RecordingPinnedTransport):
                with patch.object(httpx_module, "AsyncClient") as mock_client_class:
                    mock_client = AsyncMock()
                    mock_client.get = AsyncMock(side_effect=[
                        _resp(301, {"location": "https://10.0.0.1/private"}),
                    ])
                    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                    mock_client.__aexit__ = AsyncMock(return_value=False)
                    mock_client_class.return_value = mock_client

                    resp = await client.post("/api/admin/sources/analyze", headers=admin_client, json={
                        "url": "https://example.com/start",
                    })
                    assert resp.status_code == 200

        feasibility = resp.json()["feasibility"]
        assert feasibility.startswith("error")
        assert "blocked" in feasibility
        # Only the initial hop's transport was ever built — the private
        # redirect destination was never connected to.
        assert len(captures) == 1
        assert captures[0].pinned == {"example.com": ("93.184.216.34",)}

    async def test_robots_txt_request_uses_pinned_transport(
        self, client, admin_client, isolated_audit_log
    ):
        """The robots.txt request runs through a PinnedTransport pinned to the
        robots host's validated IPs — the same DNS-rebinding protection as the
        main analysis request."""
        import httpx as httpx_module
        from unittest.mock import AsyncMock

        RecordingPinnedTransport, captures = make_recording_transport()

        def fake_validate(url, *, allow_redirect=False):
            if url == "https://example.com/jobs":
                return UrlValidation("https", "example.com", ("93.184.216.34",))
            if url == "https://example.com/robots.txt":
                return UrlValidation("https", "example.com", ("93.184.216.34",))
            raise AssertionError(f"unexpected URL passed to validate_outbound_url: {url}")

        with patch("app.routers.admin_sources.validate_outbound_url", side_effect=fake_validate):
            with patch("app.routers.admin_sources.PinnedTransport", RecordingPinnedTransport):
                with patch.object(httpx_module, "AsyncClient") as mock_client_class:
                    mock_client = AsyncMock()
                    mock_client.get = AsyncMock(side_effect=[
                        _resp(200, {"content-type": "text/html"}, "<html><title>Jobs</title></html>"),
                        _resp(200, {"content-type": "text/plain"}, "User-agent: *\nDisallow: /search\n"),
                    ])
                    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                    mock_client.__aexit__ = AsyncMock(return_value=False)
                    mock_client_class.return_value = mock_client

                    resp = await client.post("/api/admin/sources/analyze", headers=admin_client, json={
                        "url": "https://example.com/jobs",
                    })
                    assert resp.status_code == 200

        # Main analysis transport + robots transport, both pinned to the
        # validated public IP of example.com.
        pins = [t.pinned for t in captures]
        assert len(pins) == 2
        assert pins[0] == {"example.com": ("93.184.216.34",)}
        assert pins[1] == {"example.com": ("93.184.216.34",)}

        # Confirm the robots request was actually issued to the robots URL.
        urls = [c.args[0] for c in mock_client.get.await_args_list]
        assert urls[0] == "https://example.com/jobs"
        assert urls[1] == "https://example.com/robots.txt"