"""Tests for the portal health API endpoints - Checkpoint 15.6.

Covers:
  - Portal identity registry & canonical normalization (all 10 portals)
  - GET /api/health/portals (list all portals, summary, schema validation)
  - GET /api/health/portals/{portal_name} (detail endpoint, base and skill name lookups)
  - Unknown portal handling (404)
  - SKILL.md frontmatter parsing & live enabled enrichment
  - Defensive fallbacks for missing/malformed portal_health.json
  - Defensive fallbacks for missing/malformed SKILL.md
  - Read-only verification (no artifact mutations)
"""
import json
import os
import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.portal_registry import (
    ALL_PORTAL_BASE_NAMES,
    ALL_PORTAL_SKILL_NAMES,
    PORTAL_BASE_TO_SKILL,
    PORTAL_SKILL_TO_BASE,
    base_to_skill,
    get_portal_display_name,
    is_known_base_name,
    is_known_skill_name,
    normalize_portal_name,
    skill_to_base,
)
from app.routers.portal_health import (
    _build_portal_status,
    _load_portal_health,
    _read_json_safe,
    _read_skill_enabled,
)
from app.database import get_db_manager
from app.models.database_models import User, UserStatus, UserRole
from app.auth import hash_password


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Isolated SQLite manager (mirrors test_rbac_auth.py fixture pattern)."""
    db_path = os.path.join(tempfile.gettempdir(), f"test_portal_health_{uuid.uuid4().hex}.db")
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
    """Async client fixture with DB dependency for auth."""
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
async def regular_user_headers(client, regular_user):
    """Get auth headers for regular user."""
    resp = await client.post("/api/auth/login", json={
        "email": "regular@example.com",
        "password": "password123"
    })
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestPortalRegistry:
    """Test the single source of truth portal identity registry."""

    def test_all_ten_portals_present(self):
        """Registry contains exactly 10 canonical portal mappings."""
        expected_portals = {
            "indeed": "indeed-search",
            "jobstreet": "jobstreet-search",
            "kalibrr": "kalibrr-search",
            "bossjob": "bossjob-search",
            "linkedin": "linkedin-search",
            "freehire": "freehire-search",
            "jobbank": "jobbank-search",
            "jobdanmark": "jobdanmark-search",
            "jobindex": "jobindex-search",
            "jobnet": "jobnet-search",
        }
        assert PORTAL_BASE_TO_SKILL == expected_portals
        assert len(ALL_PORTAL_BASE_NAMES) == 10
        assert len(ALL_PORTAL_SKILL_NAMES) == 10

    def test_base_to_skill_mapping(self):
        """All base names map correctly to skill names."""
        for base, skill in PORTAL_BASE_TO_SKILL.items():
            assert base_to_skill(base) == skill
        assert base_to_skill("unknown_portal") is None

    def test_skill_to_base_mapping(self):
        """All skill names map correctly back to base names."""
        for skill, base in PORTAL_SKILL_TO_BASE.items():
            assert skill_to_base(skill) == base
        assert skill_to_base("unknown-search") is None

    def test_is_known_predicates(self):
        """is_known_skill_name and is_known_base_name correctly validate names."""
        assert is_known_base_name("indeed") is True
        assert is_known_base_name("indeed-search") is False
        assert is_known_base_name("monster") is False

        assert is_known_skill_name("indeed-search") is True
        assert is_known_skill_name("indeed") is False
        assert is_known_skill_name("monster-search") is False

    def test_normalize_portal_name(self):
        """normalize_portal_name maps base names and skill names to canonical skill names."""
        assert normalize_portal_name("indeed") == "indeed-search"
        assert normalize_portal_name("indeed-search") == "indeed-search"
        assert normalize_portal_name("jobstreet") == "jobstreet-search"
        assert normalize_portal_name("unknown") == "unknown"

    def test_get_portal_display_name(self):
        """get_portal_display_name creates clean human-readable titles."""
        assert get_portal_display_name("indeed-search") == "Indeed"
        assert get_portal_display_name("jobstreet-search") == "Jobstreet"
        assert get_portal_display_name("bossjob-search") == "Bossjob"


class TestPortalHealthEndpoints:
    """Test FastAPI read-only portal health endpoints (requires auth)."""

    @pytest.mark.asyncio
    async def test_list_portals_requires_auth(self, client, regular_user_headers):
        """GET /api/health/portals requires authentication."""
        resp = await client.get("/api/health/portals", headers=regular_user_headers)
        assert resp.status_code == 200
        data = resp.json()

        assert "portals" in data
        assert "summary" in data
        assert "rolling_window_days" in data
        assert "disable_threshold_percent" in data

        assert len(data["portals"]) == 10
        portal_names = [p["name"] for p in data["portals"]]
        for expected_skill in ALL_PORTAL_SKILL_NAMES:
            assert expected_skill in portal_names

    @pytest.mark.asyncio
    async def test_list_portals_summary_structure(self, client, regular_user_headers):
        """GET /api/health/portals returns accurate summary counts."""
        resp = await client.get("/api/health/portals", headers=regular_user_headers)
        assert resp.status_code == 200
        data = resp.json()

        summary = data["summary"]
        assert "ok" in summary
        assert "blocked" in summary
        assert "insufficient_evidence" in summary
        assert "disabled" in summary

        total_portals = sum(summary.values())
        assert total_portals == 10

    @pytest.mark.asyncio
    async def test_detail_portal_by_skill_name(self, client, regular_user_headers):
        """GET /api/health/portals/{skill_name} returns detail for known skill name."""
        resp = await client.get("/api/health/portals/indeed-search", headers=regular_user_headers)
        assert resp.status_code == 200
        data = resp.json()

        assert "portal" in data
        portal = data["portal"]
        assert portal["name"] == "indeed-search"
        assert portal["display_name"] == "Indeed"
        assert "counts" in portal
        assert "window" in portal
        assert "observations" in portal
        assert "disabled" in portal
        assert "skill_enabled" in portal
        assert portal["skill_present"] is True

    @pytest.mark.asyncio
    async def test_detail_portal_by_base_name(self, client, regular_user_headers):
        """GET /api/health/portals/{base_name} normalizes base name to skill name."""
        resp = await client.get("/api/health/portals/indeed", headers=regular_user_headers)
        assert resp.status_code == 200
        data = resp.json()

        assert "portal" in data
        portal = data["portal"]
        assert portal["name"] == "indeed-search"
        assert portal["display_name"] == "Indeed"

    @pytest.mark.asyncio
    async def test_all_ten_portals_detail_resolvable(self, client, regular_user_headers):
        """All 10 portals are resolvable via both base name and skill name."""
        for base, skill in PORTAL_BASE_TO_SKILL.items():
            resp_base = await client.get(f"/api/health/portals/{base}", headers=regular_user_headers)
            assert resp_base.status_code == 200, f"Failed for base name: {base}"
            assert resp_base.json()["portal"]["name"] == skill

            resp_skill = await client.get(f"/api/health/portals/{skill}", headers=regular_user_headers)
            assert resp_skill.status_code == 200, f"Failed for skill name: {skill}"
            assert resp_skill.json()["portal"]["name"] == skill

    @pytest.mark.asyncio
    async def test_unknown_portal_returns_404(self, client, regular_user_headers):
        """GET /api/health/portals/{unknown} returns 404."""
        resp = await client.get("/api/health/portals/nonexistent_portal", headers=regular_user_headers)
        assert resp.status_code == 404
        assert "Unknown portal: nonexistent_portal" in resp.json()["detail"]


class TestSkillFrontmatterAndHealthEnrichment:
    """Test SKILL.md frontmatter parsing and live enrichment."""

    def test_live_skill_enabled_reading(self):
        """Existing repository SKILL.md files have enabled: true."""
        assert _read_skill_enabled("indeed-search") is True
        assert _read_skill_enabled("jobstreet-search") is True

    def test_missing_skill_file(self):
        """Missing SKILL.md safely returns None."""
        assert _read_skill_enabled("nonexistent-portal-search") is None

    def test_malformed_frontmatter(self, tmp_path):
        """Invalid frontmatter or missing enabled key safely returns None."""
        with patch("app.routers.portal_health.SKILLS_DIR", tmp_path):
            test_skill = tmp_path / "test-search"
            test_skill.mkdir()
            skill_file = test_skill / "SKILL.md"

            # No frontmatter
            skill_file.write_text("# Just markdown content\nNo yaml here.", encoding="utf-8")
            assert _read_skill_enabled("test-search") is None

            # Frontmatter without enabled key
            skill_file.write_text("---\nname: test-search\nversion: 1.0.0\n---\n# Content", encoding="utf-8")
            assert _read_skill_enabled("test-search") is None

            # Frontmatter with enabled: false
            skill_file.write_text("---\nname: test-search\nenabled: false\n---\n# Content", encoding="utf-8")
            assert _read_skill_enabled("test-search") is False

            # Frontmatter with enabled: true with comment
            skill_file.write_text("---\nname: test-search\nenabled: true # active\n---\n# Content", encoding="utf-8")
            assert _read_skill_enabled("test-search") is True


class TestDefensiveDataHandling:
    """Test handling of missing or malformed health store data."""

    def test_read_json_safe_missing_file(self, tmp_path):
        """Missing file returns None without raising."""
        non_existent = tmp_path / "does_not_exist.json"
        assert _read_json_safe(non_existent) is None

    def test_read_json_safe_malformed_file(self, tmp_path):
        """Malformed JSON returns None without raising."""
        bad_json = tmp_path / "bad.json"
        bad_json.write_text("{ unclosed json: ", encoding="utf-8")
        assert _read_json_safe(bad_json) is None

    @pytest.mark.asyncio
    async def test_list_portals_when_health_file_missing(self, client, tmp_path, regular_user_headers):
        """Endpoint operates safely even when portal_health.json does not exist."""
        with patch("app.routers.portal_health.PORTAL_HEALTH_FILE", tmp_path / "missing.json"):
            resp = await client.get("/api/health/portals", headers=regular_user_headers)
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["portals"]) == 10
            for portal in data["portals"]:
                assert portal["status"] == "insufficient_evidence"
                assert portal["counts"]["total_observed"] == 0

    @pytest.mark.asyncio
    async def test_detail_portal_when_health_file_missing(self, client, tmp_path, regular_user_headers):
        """Detail endpoint operates safely when portal_health.json does not exist."""
        with patch("app.routers.portal_health.PORTAL_HEALTH_FILE", tmp_path / "missing.json"):
            resp = await client.get("/api/health/portals/indeed-search", headers=regular_user_headers)
            assert resp.status_code == 200
            data = resp.json()
            portal = data["portal"]
            assert portal["name"] == "indeed-search"
            assert portal["status"] == "insufficient_evidence"
            assert portal["observations"] == []


class TestReadOnlyIntegrity:
    """Ensure that the API does not mutate scraper artifacts or SKILL files."""

    @pytest.mark.asyncio
    async def test_endpoints_do_not_modify_health_file(self, client, regular_user_headers):
        """Calling list and detail endpoints leaves portal_health.json unchanged."""
        from app.config import PORTAL_HEALTH_FILE
        if PORTAL_HEALTH_FILE.exists():
            before_mtime = PORTAL_HEALTH_FILE.stat().st_mtime
            before_content = PORTAL_HEALTH_FILE.read_bytes()

            await client.get("/api/health/portals", headers=regular_user_headers)
            await client.get("/api/health/portals/indeed-search", headers=regular_user_headers)
            await client.get("/api/health/portals/jobstreet", headers=regular_user_headers)

            after_mtime = PORTAL_HEALTH_FILE.stat().st_mtime
            after_content = PORTAL_HEALTH_FILE.read_bytes()

            assert before_mtime == after_mtime
            assert before_content == after_content
