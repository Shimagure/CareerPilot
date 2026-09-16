"""CP16.6 enabled-state bridge tests.

Covers the admin PATCH write-through (DB + SKILL.md + portal_health.json), the
runtime/DB divergence visibility in the health API, the defensive sqlite3
reader, and compensating rollback on write-through failure.
"""
import json
import os
import sqlite3
import tempfile
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app import enabled_bridge
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

STD_COMMENT = "  # set to false to keep this portal installed but have /scrape skip it"


def make_skill(skills_dir: Path, skill_name: str, enabled: bool, comment: str = STD_COMMENT) -> Path:
    """Write a CP15.5-style portal SKILL.md with a distinctive comment suffix."""
    path = skills_dir / skill_name / "SKILL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        f"name: {skill_name}\n"
        "version: 1.0.0\n"
        "description: >\n  Test portal skill.\n"
        f"enabled: {'true' if enabled else 'false'}{comment}\n"
        "allowed-tools: Bash(true)\n"
        "---\n\n"
        f"# {skill_name}\nBody line to preserve byte-for-byte.\n",
        encoding="utf-8",
    )
    return path


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Isolated SQLite manager (mirrors test_rbac_auth.py fixture pattern)."""
    db_path = os.path.join(tempfile.gettempdir(), f"test_enabled_bridge_{uuid.uuid4().hex}.db")
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
async def admin_user(db_manager):
    """Create an admin test user."""
    async with db_manager.session() as session:
        user = User(
            name="Admin User",
            email="admin-bridge@example.com",
            password_hash=hash_password("password123"),
            status=UserStatus.ACTIVE,
            role=UserRole.ADMIN,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


@pytest_asyncio.fixture
async def admin_user_headers(client, admin_user):
    """Get auth headers for admin user."""
    resp = await client.post("/api/auth/login", json={
        "email": "admin-bridge@example.com",
        "password": "password123",
    })
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def isolated_runtime(tmp_path, monkeypatch):
    """Point the enabled bridge at temp SKILL + health files (never the real repo)."""
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir(exist_ok=True)
    monkeypatch.setattr(enabled_bridge, "SKILLS_DIR", skills_dir)
    monkeypatch.setattr(enabled_bridge, "PORTAL_HEALTH_FILE", tmp_path / "portal_health.json")
    return skills_dir


async def create_job_source(db_manager, **overrides):
    """Create a JobSource row directly (bypasses the API create endpoint)."""
    defaults = dict(
        name="indeed",
        display_name="Indeed",
        base_url="https://ca.indeed.com/",
        domain="ca.indeed.com",
        source_type=JobSourceType.JOB_BOARD,
        status=JobSourceStatus.DISCOVERED,
        enabled=False,
        adapter_name="indeed-search",
    )
    defaults.update(overrides)
    async with db_manager.session() as session:
        src = JobSource(**defaults)
        session.add(src)
        await session.commit()
        await session.refresh(src)
        return src


async def db_source_state(db_manager, source_id):
    async with db_manager.session() as session:
        result = await session.execute(select(JobSource).where(JobSource.id == source_id))
        src = result.scalar_one()
        await session.refresh(src)
        return {"enabled": src.enabled, "status": src.status}


def read_health(health_file: Path):
    return json.loads(health_file.read_text(encoding="utf-8"))


class TestAdminEnabledBridge:
    """Admin PATCH `enabled` write-through to DB + SKILL.md + health store."""

    @pytest.mark.asyncio
    async def test_admin_enable_updates_db_skill_and_health(self, client, db_manager, admin_user_headers, isolated_runtime):
        src = await create_job_source(db_manager, adapter_name="indeed-search")
        make_skill(isolated_runtime, "indeed-search", False)

        resp = await client.patch(
            f"/api/admin/sources/{src.id}", json={"enabled": True}, headers=admin_user_headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["enabled"] is True
        assert body["status"] == JobSourceStatus.ENABLED.value

        state = await db_source_state(db_manager, src.id)
        assert state["enabled"] is True
        assert state["status"] == JobSourceStatus.ENABLED

        skill = (isolated_runtime / "indeed-search" / "SKILL.md").read_text(encoding="utf-8")
        assert "enabled: true" in skill
        assert "name: indeed-search" in skill  # frontmatter preserved

        health = read_health(enabled_bridge.PORTAL_HEALTH_FILE)
        entry = health["portals"]["indeed-search"]
        assert entry["disabled"] is False
        assert entry["disabled_reason"] is None

    @pytest.mark.asyncio
    async def test_admin_disable_sets_db_skill_and_health_with_admin_disable_reason(
        self, client, db_manager, admin_user_headers, isolated_runtime
    ):
        src = await create_job_source(
            db_manager, adapter_name="indeed-search", enabled=True, status=JobSourceStatus.ENABLED
        )
        make_skill(isolated_runtime, "indeed-search", True)

        resp = await client.patch(
            f"/api/admin/sources/{src.id}", json={"enabled": False}, headers=admin_user_headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["enabled"] is False
        assert body["status"] == JobSourceStatus.DISABLED.value

        state = await db_source_state(db_manager, src.id)
        assert state["enabled"] is False
        assert state["status"] == JobSourceStatus.DISABLED

        skill = (isolated_runtime / "indeed-search" / "SKILL.md").read_text(encoding="utf-8")
        assert "enabled: false" in skill

        health = read_health(enabled_bridge.PORTAL_HEALTH_FILE)
        entry = health["portals"]["indeed-search"]
        assert entry["disabled"] is True
        assert entry["disabled_reason"] == "admin disable"
        assert entry["disabled_at"] is not None

    @pytest.mark.asyncio
    async def test_enable_without_known_adapter_returns_400_and_does_nothing(
        self, client, db_manager, admin_user_headers, isolated_runtime
    ):
        # No adapter_name on the row and none supplied.
        src = await create_job_source(db_manager, adapter_name=None)
        resp = await client.patch(
            f"/api/admin/sources/{src.id}", json={"enabled": True}, headers=admin_user_headers
        )
        assert resp.status_code == 400
        assert "adapter_name" in resp.json()["detail"]

        # Unknown adapter name on the row.
        src2 = await create_job_source(db_manager, name="monster", domain="monster.com", adapter_name="monster-search")
        resp = await client.patch(
            f"/api/admin/sources/{src2.id}", json={"enabled": True}, headers=admin_user_headers
        )
        assert resp.status_code == 400
        assert "adapter_name" in resp.json()["detail"]

        for _src in (src, src2):
            state = await db_source_state(db_manager, _src.id)
            assert state["enabled"] is False
        assert not (isolated_runtime / "indeed-search").exists()
        assert not (isolated_runtime / "monster-search").exists()
        assert not enabled_bridge.PORTAL_HEALTH_FILE.exists()

    @pytest.mark.asyncio
    async def test_enable_with_missing_skill_file_returns_400(self, client, db_manager, admin_user_headers, isolated_runtime):
        src = await create_job_source(db_manager, adapter_name="indeed-search")
        # No SKILL.md exists in the patched skills dir.
        resp = await client.patch(
            f"/api/admin/sources/{src.id}", json={"enabled": True}, headers=admin_user_headers
        )
        assert resp.status_code == 400
        assert "no installed portal skill" in resp.json()["detail"]
        state = await db_source_state(db_manager, src.id)
        assert state["enabled"] is False
        assert not enabled_bridge.PORTAL_HEALTH_FILE.exists()

    @pytest.mark.asyncio
    async def test_repeated_toggle_is_idempotent_with_no_file_churn(
        self, client, db_manager, admin_user_headers, isolated_runtime
    ):
        src = await create_job_source(db_manager, adapter_name="indeed-search")
        make_skill(isolated_runtime, "indeed-search", False)

        r1 = await client.patch(f"/api/admin/sources/{src.id}", json={"enabled": True}, headers=admin_user_headers)
        assert r1.status_code == 200
        skill_after_one = (isolated_runtime / "indeed-search" / "SKILL.md").read_bytes()
        health_after_one = enabled_bridge.PORTAL_HEALTH_FILE.read_bytes()

        r2 = await client.patch(f"/api/admin/sources/{src.id}", json={"enabled": True}, headers=admin_user_headers)
        assert r2.status_code == 200
        assert (isolated_runtime / "indeed-search" / "SKILL.md").read_bytes() == skill_after_one
        assert enabled_bridge.PORTAL_HEALTH_FILE.read_bytes() == health_after_one

        r3 = await client.patch(f"/api/admin/sources/{src.id}", json={"enabled": False}, headers=admin_user_headers)
        assert r3.status_code == 200
        skill_after_disable = (isolated_runtime / "indeed-search" / "SKILL.md").read_bytes()
        health_after_disable = enabled_bridge.PORTAL_HEALTH_FILE.read_bytes()

        r4 = await client.patch(f"/api/admin/sources/{src.id}", json={"enabled": False}, headers=admin_user_headers)
        assert r4.status_code == 200
        assert (isolated_runtime / "indeed-search" / "SKILL.md").read_bytes() == skill_after_disable
        assert enabled_bridge.PORTAL_HEALTH_FILE.read_bytes() == health_after_disable

    @pytest.mark.asyncio
    async def test_write_failure_triggers_compensating_rollback(
        self, client, db_manager, admin_user_headers, isolated_runtime, monkeypatch
    ):
        src = await create_job_source(db_manager, adapter_name="indeed-search")
        skill_file = make_skill(isolated_runtime, "indeed-search", False)
        before = skill_file.read_bytes()

        def boom(skill_name, enabled):
            raise OSError("simulated health store write failure")

        monkeypatch.setattr(enabled_bridge, "update_health_store", boom)

        resp = await client.patch(f"/api/admin/sources/{src.id}", json={"enabled": True}, headers=admin_user_headers)
        assert resp.status_code == 500
        assert "rolled back" in resp.json()["detail"]

        # DB restored, SKILL.md restored, no half-state survives.
        state = await db_source_state(db_manager, src.id)
        assert state["enabled"] is False
        assert state["status"] == JobSourceStatus.DISCOVERED
        assert skill_file.read_bytes() == before
        assert not enabled_bridge.PORTAL_HEALTH_FILE.exists()


class TestPortalHealthDivergenceVisibility:
    """Health API exposes both skill_enabled and job_source_enabled states."""

    def _setup_health(self, tmp_path, monkeypatch, skill_dir):
        from app.routers import portal_health as ph_router
        make_skill(skill_dir, "indeed-search", True)
        monkeypatch.setattr(ph_router, "SKILLS_DIR", skill_dir)
        health_file = tmp_path / "hp.json"
        health = {
            "schema_version": "1.0",
            "rolling_window_days": 7,
            "disable_threshold_percent": 50,
            "updated_at": None,
            "portals": {
                "indeed-search": {
                    "name": "indeed-search",
                    "observations": [],
                    "counts": {"success": 1, "explicit_403_blocked": 0, "inconclusive": 0, "total_observed": 1},
                    "status": "ok",
                    "window": {"explicit_403_blocked": 0, "success": 1, "inconclusive": 0, "total_observed": 1, "block_rate_percent": 0.0},
                    "disabled": False,
                    "disabled_at": None,
                    "disabled_reason": None,
                }
            },
        }
        health_file.write_text(json.dumps(health), encoding="utf-8")
        monkeypatch.setattr(ph_router, "PORTAL_HEALTH_FILE", health_file)
        return ph_router

    @pytest.mark.asyncio
    async def test_detail_exposes_both_states_and_detects_divergence(
        self, client, isolated_runtime, tmp_path, monkeypatch, admin_user_headers
    ):
        self._setup_health(tmp_path, monkeypatch, isolated_runtime)

        # Divergence: runtime SKILL.md enabled, DB intent disabled.
        monkeypatch.setattr(enabled_bridge, "read_job_source_enabled", lambda skill_name: False)
        resp = await client.get("/api/health/portals/indeed-search", headers=admin_user_headers)
        assert resp.status_code == 200
        portal = resp.json()["portal"]
        assert portal["skill_enabled"] is True
        assert portal["job_source_enabled"] is False

        # Aligned: both enabled.
        monkeypatch.setattr(enabled_bridge, "read_job_source_enabled", lambda skill_name: True)
        resp = await client.get("/api/health/portals/indeed-search", headers=admin_user_headers)
        assert resp.status_code == 200
        portal = resp.json()["portal"]
        assert portal["skill_enabled"] is True
        assert portal["job_source_enabled"] is True

    @pytest.mark.asyncio
    async def test_list_carries_job_source_enabled_field(
        self, client, isolated_runtime, tmp_path, monkeypatch, admin_user_headers
    ):
        self._setup_health(tmp_path, monkeypatch, isolated_runtime)
        resp = await client.get("/api/health/portals", headers=admin_user_headers)
        assert resp.status_code == 200
        row = next(p for p in resp.json()["portals"] if p["name"] == "indeed-search")
        assert "job_source_enabled" in row
        assert row["job_source_enabled"] is None  # unpatched read: no matching DB row
        assert "skill_enabled" in row


class TestReadJobSourceEnabledHelper:
    """Defensive sqlite3 reader (adapter_name primary, name legacy fallback)."""

    @staticmethod
    def _make_db(tmp_path, rows):
        db_path = tmp_path / "bridge.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE IF NOT EXISTS job_sources (id TEXT PRIMARY KEY, name TEXT, adapter_name TEXT, enabled INTEGER)")
        for row in rows:
            conn.execute(
                "INSERT INTO job_sources (id, name, adapter_name, enabled) VALUES (?, ?, ?, ?)",
                (row["id"], row["name"], row["adapter_name"], 1 if row["enabled"] else 0),
            )
        conn.commit()
        conn.close()
        return db_path

    def test_adapter_name_match(self, tmp_path):
        db = self._make_db(tmp_path, [{"id": "1", "name": "indeed", "adapter_name": "indeed-search", "enabled": True}])
        assert enabled_bridge.read_job_source_enabled("indeed-search", db_path=db) is True

    def test_legacy_name_match_without_adapter(self, tmp_path):
        db = self._make_db(tmp_path, [{"id": "1", "name": "indeed", "adapter_name": None, "enabled": False}])
        assert enabled_bridge.read_job_source_enabled("indeed-search", db_path=db) is False

    def test_adapter_priority_over_name(self, tmp_path):
        db = self._make_db(tmp_path, [
            {"id": "1", "name": "indeed", "adapter_name": "indeed-search", "enabled": True},
            {"id": "2", "name": "indeed-search", "adapter_name": None, "enabled": False},
        ])
        assert enabled_bridge.read_job_source_enabled("indeed-search", db_path=db) is True

    def test_no_matching_row_returns_none(self, tmp_path):
        db = self._make_db(tmp_path, [{"id": "1", "name": "jobstreet", "adapter_name": "jobstreet-search", "enabled": True}])
        assert enabled_bridge.read_job_source_enabled("indeed-search", db_path=db) is None

    def test_missing_db_file_returns_none(self, tmp_path):
        assert enabled_bridge.read_job_source_enabled("indeed-search", db_path=tmp_path / "nope.sqlite") is None

    def test_missing_table_returns_none(self, tmp_path):
        db = tmp_path / "empty.sqlite"
        conn = sqlite3.connect(str(db))
        conn.execute("CREATE TABLE other (x INTEGER)")
        conn.commit()
        conn.close()
        assert enabled_bridge.read_job_source_enabled("indeed-search", db_path=db) is None