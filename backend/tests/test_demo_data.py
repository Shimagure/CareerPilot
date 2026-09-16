"""P4 tests: expanded deterministic public demo dataset.

Validates the demo data plane end-to-end against the checked-in demo_data
files and the generator that produced them:
  - corpus minimums and state distribution
  - evaluation coverage and fit-consistency
  - application counts, status vocabulary, references, and metadata
  - stable-id uniqueness and fictional URL safety
  - generator determinism (regeneration is byte-stable AND matches the
    committed files -- reproducibility from source, not snapshot equality)
  - no real/private data markers anywhere in the demo plane
  - public endpoints serve the expanded corpus; demo store only
  - demo reset still works; public/demo planes stay schema-compatible

The static-keyed assertions (state counts, evaluation coverage, apps) are
read directly from the committed files so they never depend on wall-clock
time. Wall-clock-sensitive assertions (active-pool membership, retention)
recompute the same 28-day / application-protection rule from the files
instead of hard-coding a count, so they stay correct as the corpus ages.
"""
import csv
import filecmp
import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import get_db_manager
from app.models.database_models import User, UserStatus, UserRole
from app.auth import hash_password
from app.config import STALE_JOB_DAYS, ACTIVE_POOL_STATES
from app.demo_store import (
    DemoDataStore,
    get_demo_store,
    DEMO_SEEN_JOBS_FILE,
    DEMO_TRACKER_FILE,
    DEMO_CHECKPOINTS_FILE,
)
from app.models.schemas import FitLevel

GENERATOR = Path(__file__).resolve().parents[1] / "scripts" / "generate_demo_dataset.py"

MIN_ACTIVE_TOTAL = 50
MIN_PERIPHERAL_TOTAL = 6
MIN_ACTIVE_VERIFIED = 35
MIN_ACTIVE_UNVERIFIED = 4
MIN_CHANGED = 3
MIN_POSTING_CHANGED = 3
MIN_COMPLETE_EVALUATIONS = 30
MIN_APPLICATIONS = 15
MIN_APP_STATUSES = 6
MIN_APP_WITH_NOTES = 8
MIN_APP_WITH_DOCS = 8

VALID_STATES = {
    "NEW", "NEEDS_VERIFICATION", "ACTIVE_VERIFIED", "ACTIVE_UNVERIFIED",
    "STALE", "CHANGED", "CLOSED_OR_EXPIRED", "POSTING_CHANGED",
    "DUPLICATE_OR_INVALID", "DEPRIORITIZE", "UNKNOWN",
}
VALID_APP_STATUSES = {
    "draft", "submitted", "under_review", "interview", "offer",
    "accepted", "rejected", "withdrawn",
}

# Markers that must never appear in the demo plane (real candidate PII, real
# employer names, real artifact paths, secrets). Content-level scan only.
FORBIDDEN_MARKERS = [
    "solaire", "bulacan", "san ildefonso", "light.jukes",
    "@gmail", "@outlook",
    "careerpilot.db", "sqlite", "job_scraper", "canonical_jobs",
    "ranked_jobs", "seen_jobs", "job_search_tracker",
    "c:\\", "c:/", "/users/", "uploads/resumes",
    "eyj0", "sk-", "api_key", "secret", "password", "bearer",
]


# ---------------------------------------------------------------------------
# Fixtures (reused pattern from test_security_boundary.py)
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Create a test database manager with isolated SQLite."""
    import os
    import uuid

    db_path = os.path.join(tempfile.gettempdir(), f"test_demo_data_db_{uuid.uuid4().hex}.db")

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
async def regular_user_headers(client, regular_user):
    """Auth headers for the regular user."""
    resp = await client.post("/api/auth/login", json={
        "email": "regular@example.com",
        "password": "password123",
    })
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ---------------------------------------------------------------------------
# Static corpus helpers
# ---------------------------------------------------------------------------
def _load_seen_jobs() -> dict:
    doc = json.loads(DEMO_SEEN_JOBS_FILE.read_text(encoding="utf-8"))
    return doc["seen"]


def _load_apps() -> list:
    with open(DEMO_TRACKER_FILE, "r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def _state_counts(seen) -> dict:
    counts = {}
    for rec in seen.values():
        counts[rec["processing_state"]] = counts.get(rec["processing_state"], 0) + 1
    return counts


def _expected_active_stable_ids(seen, app_ids) -> set:
    """Recompute the 28-day / application-protection active set from the files,
    independent of the server's own clock but following the same rule."""
    now = datetime.now(timezone.utc)
    active = set()
    for rec in seen.values():
        if rec.get("processing_state") not in ACTIVE_POOL_STATES:
            continue
        last = (rec.get("last_active_at") or rec.get("last_verified")
                or rec.get("blocked_at") or rec.get("first_seen"))
        if not last:
            continue
        try:
            dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        except ValueError:
            continue
        if (now - dt).total_seconds() / 86400 <= STALE_JOB_DAYS:
            active.add(rec["stable_id"])
        elif rec["stable_id"] in app_ids:
            active.add(rec["stable_id"])
    return active


# ---------------------------------------------------------------------------
# 1. Minimum corpus counts
# ---------------------------------------------------------------------------
class TestMinCorpusCounts:
    def test_min_corpus_counts(self):
        seen = _load_seen_jobs()
        apps = _load_apps()
        counts = _state_counts(seen)

        active_total = sum(counts.get(s, 0) for s in ACTIVE_POOL_STATES)
        peripheral_total = sum(counts.get(s, 0) for s in
                              ("STALE", "CLOSED_OR_EXPIRED", "NEEDS_VERIFICATION", "DUPLICATE_OR_INVALID"))

        assert len(seen) >= MIN_ACTIVE_TOTAL + MIN_PERIPHERAL_TOTAL
        assert active_total >= MIN_ACTIVE_TOTAL
        assert peripheral_total >= MIN_PERIPHERAL_TOTAL
        assert len(apps) >= MIN_APPLICATIONS


# ---------------------------------------------------------------------------
# 2. State distribution
# ---------------------------------------------------------------------------
class TestStateDistribution:
    def test_state_distribution(self):
        seen = _load_seen_jobs()
        counts = _state_counts(seen)

        assert counts.get("ACTIVE_VERIFIED", 0) >= MIN_ACTIVE_VERIFIED
        assert counts.get("ACTIVE_UNVERIFIED", 0) >= MIN_ACTIVE_UNVERIFIED
        assert counts.get("CHANGED", 0) >= MIN_CHANGED
        assert counts.get("POSTING_CHANGED", 0) >= MIN_POSTING_CHANGED

        for state in counts:
            assert state in VALID_STATES, f"unknown state {state}"

        for rec in seen.values():
            assert rec["processing_state"] in VALID_STATES
            assert rec["arrangement"] in {"remote", "hybrid", "onsite", "unspecified"}
            assert rec["fit"] in {"high", "medium", "low", "unknown"}


# ---------------------------------------------------------------------------
# 3. Evaluation coverage and fit-consistency
# ---------------------------------------------------------------------------
class TestEvaluationCoverage:
    def test_evaluation_coverage_and_consistency(self):
        seen = _load_seen_jobs()
        required = ("technical", "experience", "behavioral", "career", "overall",
                    "verdict", "key_strengths", "gaps", "recommendation", "evaluated_at")

        complete = 0
        for rec in seen.values():
            eval_data = rec.get("evaluation")
            if eval_data is None:
                continue
            if all(eval_data.get(k) not in (None, "", []) for k in required):
                complete += 1
            overall = eval_data.get("overall")
            assert overall is not None, f"{rec['stable_id']} missing overall"
            if rec["fit"] == FitLevel.HIGH.value:
                assert 74 <= overall <= 100, f"{rec['stable_id']} high-fit overall {overall}"
            elif rec["fit"] == FitLevel.MEDIUM.value:
                assert overall >= 58, f"{rec['stable_id']} medium-fit overall {overall}"
            elif rec["fit"] == FitLevel.LOW.value and overall is not None:
                assert overall < 74

        assert complete >= MIN_COMPLETE_EVALUATIONS


# ---------------------------------------------------------------------------
# 4. Application count, statuses, fit ratings
# ---------------------------------------------------------------------------
class TestApplicationCountAndStatuses:
    def test_application_count_statuses_and_ratings(self):
        apps = _load_apps()

        assert len(apps) >= MIN_APPLICATIONS
        statuses = {a["status"] for a in apps}
        assert len(statuses) >= MIN_APP_STATUSES
        assert statuses <= VALID_APP_STATUSES, f"unknown statuses {statuses - VALID_APP_STATUSES}"

        for a in apps:
            assert int(a["fit_rating"]) >= 0 and int(a["fit_rating"]) <= 100, a["stable_id"]


# ---------------------------------------------------------------------------
# 5. Application references resolve
# ---------------------------------------------------------------------------
class TestApplicationReferencesResolve:
    def test_all_application_references_resolve(self):
        seen = _load_seen_jobs()
        apps = _load_apps()

        job_ids = set(seen.keys())
        for a in apps:
            assert a["stable_id"] in job_ids, f"app {a['stable_id']} has no job"
            assert a["company"] != ""
            assert a["role"] != ""


# ---------------------------------------------------------------------------
# 6. Application metadata coverage
# ---------------------------------------------------------------------------
class TestApplicationMetadataCoverage:
    def test_apps_have_notes_and_document_metadata(self):
        apps = _load_apps()

        with_notes = sum(1 for a in apps if a["notes"].strip())
        with_docs = sum(1 for a in apps if a["cv_file"] and a["cover_letter_file"])

        assert with_notes >= MIN_APP_WITH_NOTES
        assert with_docs >= MIN_APP_WITH_DOCS

        # Metadata only: filenames never point at a real project file.
        for a in apps:
            for field in ("cv_file", "cover_letter_file"):
                val = a[field]
                if val:
                    assert val.endswith(".pdf")
                    assert not val.startswith(("cv/main", "cover_letters/", "resumes/"))


# ---------------------------------------------------------------------------
# 7. Stable IDs unique + fictional URLs
# ---------------------------------------------------------------------------
class TestStableIdsUnique:
    def test_stable_ids_unique_and_urls_fictional(self):
        seen = _load_seen_jobs()

        ids = [r["stable_id"] for r in seen.values()]
        assert len(ids) == len(set(ids))

        for rec in seen.values():
            assert re.fullmatch(r"demo-\d{3}", rec["stable_id"]), rec["stable_id"]
            assert rec["url"].startswith("https://example.com/"), rec["url"]
            assert rec.get("fingerprint"), rec["stable_id"]


# ---------------------------------------------------------------------------
# 8. Generator determinism (source-value, not snapshot)
# ---------------------------------------------------------------------------
class TestGeneratorDeterminism:
    def _generate(self, out_dir: Path) -> subprocess.CompletedProcess:
        proc = subprocess.run(
            [sys.executable, str(GENERATOR), "--out-dir", str(out_dir)],
            capture_output=True, text=True, timeout=120,
        )
        assert proc.returncode == 0, f"generator failed: {proc.stderr}"
        return proc

    def test_regeneration_is_byte_stable_and_matches_committed_files(self):
        with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
            self._generate(Path(d1))
            self._generate(Path(d2))

            for name in ("demo_seen_jobs.json", "demo_tracker.csv", "demo_checkpoints.json"):
                assert filecmp.cmp(Path(d1) / name, Path(d2) / name, shallow=False), f"{name} not deterministic"

            # The committed files must be reproducible from the generator at HEAD.
            assert filecmp.cmp(Path(d1) / "demo_seen_jobs.json", DEMO_SEEN_JOBS_FILE, shallow=False)
            assert filecmp.cmp(Path(d1) / "demo_tracker.csv", DEMO_TRACKER_FILE, shallow=False)
            assert filecmp.cmp(Path(d1) / "demo_checkpoints.json", DEMO_CHECKPOINTS_FILE, shallow=False)


# ---------------------------------------------------------------------------
# 9. No private/real-data references
# ---------------------------------------------------------------------------
class TestNoPrivateDataReferences:
    def test_no_forbidden_markers_in_demo_plane(self):
        blobs = [
            DEMO_SEEN_JOBS_FILE.read_text(encoding="utf-8").lower(),
            DEMO_TRACKER_FILE.read_text(encoding="utf-8").lower(),
            DEMO_CHECKPOINTS_FILE.read_text(encoding="utf-8").lower(),
        ]
        for blob in blobs:
            for marker in FORBIDDEN_MARKERS:
                assert marker not in blob, f"forbidden marker present: {marker}"

        # Every URL in the corpus is on the fictional example.com domain.
        for url in re.findall(r"https?://[^\s\"']+", " ".join(blobs)):
            assert url.startswith("https://example.com/"), f"non-fictional URL: {url}"


# ---------------------------------------------------------------------------
# 10. Public endpoints serve the expanded corpus
# ---------------------------------------------------------------------------
class TestPublicEndpointsExpandedCorpus:
    async def test_public_status_reports_expanded_corpus(self, client):
        resp = await client.get("/api/public/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_demo_mode"] is True
        dist = data["state_distribution"]
        assert sum(dist.values()) == len(_load_seen_jobs())
        assert dist.get("ACTIVE_VERIFIED", 0) >= MIN_ACTIVE_VERIFIED

    async def test_public_jobs_active_returns_full_active_set(self, client):
        resp = await client.get("/api/public/jobs/active")
        assert resp.status_code == 200
        data = resp.json()

        seen = _load_seen_jobs()
        app_ids = {a["stable_id"] for a in _load_apps()}
        expected = _expected_active_stable_ids(seen, app_ids)

        returned = {j["stable_id"] for j in data}
        assert returned == expected

        for j in data:
            assert j["processing_state"] in ACTIVE_POOL_STATES
            assert j["is_active_pool"] is True

    async def test_public_retention_reconciles(self, client):
        resp = await client.get("/api/public/retention")
        assert resp.status_code == 200
        data = resp.json()

        seen = _load_seen_jobs()
        counts = _state_counts(seen)
        active_state_total = sum(counts.get(s, 0) for s in ACTIVE_POOL_STATES)

        assert data["total_seen"] == len(seen)
        assert data["active_pool_count"] + data["stale_count"] == active_state_total
        assert data["blocked_count"] == counts.get("ACTIVE_UNVERIFIED", 0)

        breakdown = {row["state"]: row["count"] for row in data["state_breakdown"]}
        assert breakdown == counts

    async def test_public_job_detail_includes_evaluation(self, client):
        resp = await client.get("/api/public/jobs/demo-001")
        assert resp.status_code == 200
        job = resp.json()
        assert job["stable_id"] == "demo-001"
        eval_data = job.get("evaluation")
        assert eval_data is not None
        for key in ("technical", "experience", "behavioral", "career", "overall",
                    "verdict", "recommendation", "evaluated_at"):
            assert eval_data.get(key) not in (None, "")

    async def test_public_pipeline_status(self, client):
        resp = await client.get("/api/public/pipeline")
        assert resp.status_code == 200
        data = resp.json()
        current = data["current_checkpoint"]
        assert current is not None
        assert current.get("run_id") == "20260912-000000"
        assert current.get("stage") == "ranking_report"
        assert len(data["run_history"]) == 2


# ---------------------------------------------------------------------------
# 11. Public endpoints never fall back to real data
# ---------------------------------------------------------------------------
class TestPublicEndpointsNoFallbackToRealData:
    async def test_public_responses_contain_only_demo_plane(self, client):
        store = get_demo_store()
        assert isinstance(store, DemoDataStore)

        active = (await client.get("/api/public/jobs/active")).json()
        for j in active:
            assert re.fullmatch(r"demo-\d{3}", j["stable_id"]), j["stable_id"]

        status = (await client.get("/api/public/status")).json()
        assert status.get("is_demo_mode") is True

        retention = (await client.get("/api/public/retention")).json()
        payload = json.dumps(retention).lower()
        for marker in ("@gmail", "@outlook", "light.jukes"):
            assert marker not in payload

    async def test_public_health_marks_demo_mode(self, client):
        resp = await client.get("/api/public/health/portals")
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_demo_mode"] is True
        assert data["active_jobs_count"] >= MIN_ACTIVE_TOTAL


# ---------------------------------------------------------------------------
# 12. Demo reset still works (and only touches the demo plane)
# ---------------------------------------------------------------------------
class TestDemoResetStillWorks:
    async def test_demo_reset_invalidates_demo_cache_only(self, client, regular_user_headers):
        before = (await client.get("/api/public/jobs/active")).json()
        before_ids = {j["stable_id"] for j in before}

        resp = await client.post("/api/demo/reset", headers=regular_user_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert data["active_jobs_count"] >= MIN_ACTIVE_TOTAL

        # Public plane is still served from the same committed corpus.
        after = (await client.get("/api/public/jobs/active")).json()
        assert {j["stable_id"] for j in after} == before_ids

        # Reset requires authentication (boundary preserved).
        unauth = await client.post("/api/demo/reset")
        assert unauth.status_code == 401


# ---------------------------------------------------------------------------
# 13. Public/demo planes stay schema-compatible
# ---------------------------------------------------------------------------
class TestPublicDemoSchemaCompatibility:
    async def test_public_and_demo_planes_share_schema(self, client):
        public_active = (await client.get("/api/public/jobs/active")).json()
        demo_active = (await client.get("/api/demo/jobs/active")).json()

        assert {j["stable_id"] for j in public_active} == {j["stable_id"] for j in demo_active}

        pub_status = (await client.get("/api/public/status")).json()
        demo_status = (await client.get("/api/demo/status")).json()
        assert pub_status["is_demo_mode"] is demo_status["is_demo_mode"] is True

    async def test_job_record_schema_is_exercised(self, client):
        resp = await client.get("/api/public/jobs/demo-002")
        assert resp.status_code == 200
        job = resp.json()

        for key in ("stable_id", "title", "company", "location", "salary", "url",
                    "portal", "arrangement", "work_mode", "description",
                    "processing_state", "first_seen", "fingerprint", "rank_score",
                    "rank_verdict", "fit", "priority_tier", "is_active_pool",
                    "is_application_protected", "evaluation"):
            assert key in job, f"JobRecord missing field {key}"

        # Enums round-trip through the schema.
        assert job["processing_state"] in VALID_STATES
        assert job["arrangement"] in {"remote", "hybrid", "onsite", "unspecified"}
        assert job["fit"] in {"high", "medium", "low", "unknown"}


# ---------------------------------------------------------------------------
# 14. New public endpoints (P4.1)
# ---------------------------------------------------------------------------
class TestPublicApplicationsEndpoint:
    async def test_public_applications_endpoint_returns_16_apps(self, client):
        resp = await client.get("/api/public/applications")
        assert resp.status_code == 200
        apps = resp.json()
        assert len(apps) == 16

        for app in apps:
            assert "stable_id" in app
            assert app["stable_id"].startswith("demo-")
            assert "status" in app
            assert app["status"] in VALID_APP_STATUSES
            if app.get("fit_rating") is not None:
                assert 0 <= app["fit_rating"] <= 100

    async def test_public_applications_no_private_data(self, client):
        resp = await client.get("/api/public/applications")
        assert resp.status_code == 200
        payload = json.dumps(resp.json()).lower()
        for marker in ("@gmail", "@outlook", "light.jukes", "solaire", "bulacan"):
            assert marker not in payload

    async def test_public_applications_all_stable_ids_resolve(self, client):
        resp = await client.get("/api/public/applications")
        assert resp.status_code == 200
        apps = resp.json()

        # Verify all stable_ids exist in seen_jobs
        seen = _load_seen_jobs()
        job_ids = set(seen.keys())
        for app in apps:
            assert app["stable_id"] in job_ids, f"app {app['stable_id']} has no job"


class TestPublicJobsActiveSortOrderLimit:
    async def test_public_jobs_active_sort_rank_score_desc(self, client):
        resp = await client.get("/api/public/jobs/active?sort=rank_score&order=desc&limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 5

        # Verify sorted by rank_score descending
        scores = [j.get("rank_score") or 0 for j in data]
        assert scores == sorted(scores, reverse=True)

    async def test_public_jobs_active_sort_rank_score_asc(self, client):
        resp = await client.get("/api/public/jobs/active?sort=rank_score&order=asc&limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 5

        scores = [j.get("rank_score") or 0 for j in data]
        assert scores == sorted(scores)

    async def test_public_jobs_active_limit_10(self, client):
        resp = await client.get("/api/public/jobs/active?limit=10")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 10

    async def test_public_jobs_active_default_no_sort(self, client):
        """Default behavior (no sort params) should match existing behavior."""
        resp = await client.get("/api/public/jobs/active")
        assert resp.status_code == 200
        data = resp.json()
        # Should return all active jobs (50)
        assert len(data) >= 50