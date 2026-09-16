"""P3.3 tests: error-message leakage prevention.

Covers:
  - a failing search pipeline records a sanitized run.error to the client
    (no exception text, filesystem paths, or implementation details)
  - admin source analysis never echoes internal exception text (feasibility)
  - the enabled-state bridge failure returns a generic detail (no exception text)

Diagnostics stay server-side: each path logs the full exception with
logging.exception() but the API response carries only a safe message.
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid

import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.auth import hash_password
from app.database import get_db_manager
from app.main import app
from app.models.database_models import (
    JobSource,
    JobSourceStatus,
    JobSourceType,
    SearchRun,
    SearchRunStatus,
    User,
    UserRole,
    UserStatus,
)


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    db_path = os.path.join(tempfile.gettempdir(), f"test_err_sanitize_{uuid.uuid4().hex}.db")
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


@pytest_asyncio.fixture(scope="function")
async def admin_headers(client, db_manager):
    """Login as an admin and return Authorization headers."""
    await create_user(db_manager, "admin@example.com", role=UserRole.ADMIN)
    resp = await client.post("/api/auth/login", json={"email": "admin@example.com", "password": "password123"})
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


class TestSearchPipelineErrorSanitization:
    async def test_pipeline_exception_sanitized_in_run_error(self, client, db_manager, monkeypatch):
        # An exception carrying internal details must never reach run.error.
        from app.services import pipeline_adapter
        from app.services.search_manager import get_search_run_manager

        user = await create_user(db_manager, "search@example.com")

        async with db_manager.session() as session:
            run = SearchRun(
                user_id=user.id,
                status=SearchRunStatus.QUEUED,
                run_metadata=json.dumps({
                    "pipeline_stage": "preparing",
                    "preference_snapshot": None,
                    "execution_options": {},
                    "result_summary": None,
                }),
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)
            run_id = run.id

        class ExplodingExecutor:
            async def execute(self, keywords=None, location=None):
                raise RuntimeError(
                    "sqlite3.OperationalError: unable to open database file "
                    "'C:/private/app/secrets/master.db' (disk I/O error)"
                )

        monkeypatch.setattr(pipeline_adapter, "DryRunExecutor", ExplodingExecutor)

        manager = get_search_run_manager()
        await manager._execute_background(run_id, True, "IT Support", "Metro Manila")
        await manager.wait_for_idle(timeout=10.0)

        async with db_manager.session() as session:
            run_row = await session.get(SearchRun, run_id)
            assert run_row.status == SearchRunStatus.FAILED
            assert run_row.error == "Search pipeline execution failed."
            assert "master.db" not in (run_row.error or "")
            assert "OperationalError" not in (run_row.error or "")
            assert "C:/private" not in (run_row.error or "")


class TestAnalyzeErrorSanitization:
    async def test_generic_exception_sanitized_in_feasibility(self, client, admin_headers, monkeypatch):
        """Internal exception text must not be echoed in the analysis response."""
        import httpx as httpx_module
        from app.ssrf import UrlValidation

        # Bypass DNS so the test stays deterministic (no external network).
        monkeypatch.setattr(
            "app.routers.admin_sources.validate_outbound_url",
            lambda *a, **k: UrlValidation(
                scheme="http",
                hostname="example.com",
                resolved_ips=("203.0.113.5",),
            ),
        )

        class ExplodingClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *excinfo):
                return False

            async def get(self, url, headers=None):
                raise RuntimeError(
                    "sqlite connect failed on 'C:/private/secrets/master.db': "
                    "remote host closed connection"
                )

        monkeypatch.setattr(httpx_module, "AsyncClient", ExplodingClient)

        resp = await client.post("/api/admin/sources/analyze", headers=admin_headers, json={
            "url": "https://example.com/jobs",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["feasibility"] == "error"
        body_text = resp.text.lower()
        assert "master.db" not in body_text
        assert "sqlite" not in body_text
        assert "closed connection" not in body_text


class TestBridgeFailureSanitization:
    async def test_bridge_error_detail_sanitized(self, client, db_manager, admin_headers, monkeypatch, tmp_path):
        """A write-through failure must not leak the internal exception text."""
        from app import enabled_bridge as bridge

        # Point the bridge at a temp skill dir with an installed 'indeed-search' skill.
        skills_dir = tmp_path / "skills"
        skill_md = skills_dir / "indeed-search" / "SKILL.md"
        skill_md.parent.mkdir(parents=True, exist_ok=True)
        skill_md.write_text("---\nname: indeed-search\nenabled: true\n---\n", encoding="utf-8")
        monkeypatch.setattr(bridge, "SKILLS_DIR", skills_dir)
        monkeypatch.setattr(bridge, "PORTAL_HEALTH_FILE", tmp_path / "portal_health.json")

        async with db_manager.session() as session:
            src = JobSource(
                name="bridge-sanitize",
                display_name="Bridge",
                base_url="https://example.com/",
                domain="example.com",
                source_type=JobSourceType.JOB_BOARD,
                status=JobSourceStatus.DISCOVERED,
                enabled=False,
                adapter_name="indeed-search",
            )
            session.add(src)
            await session.commit()
            await session.refresh(src)
            source_id = src.id

        def _explode(skill_name, enabled):
            raise OSError("[Errno 13] Permission denied: 'C:/private/app/skills/indeed-search/SKILL.md'")

        monkeypatch.setattr(bridge, "set_skill_enabled", _explode)

        resp = await client.patch(f"/api/admin/sources/{source_id}", headers=admin_headers,
                                  json={"enabled": True})
        assert resp.status_code == 500
        detail = resp.json().get("detail", "")
        assert "C:/private" not in detail
        assert "Permission denied" not in detail
        assert "SKILL.md" not in detail
        assert "write-through failed" in detail  # still an actionable, safe message