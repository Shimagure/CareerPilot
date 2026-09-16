"""Tests for CP15.2 JobSyncService synchronization."""

import pytest
import pytest_asyncio
import tempfile
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
import json

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import DatabaseManager
from app.models.database_models import (
    Base, User, UserStatus, Application, ApplicationStatus,
    UserJob, UserJobStatus, Job
)
from app.services.job_sync import (
    JobSyncService,
    SyncValidationError,
    normalize_records,
    _merged_canonical,
    SyncSummary,
)


def make_seen_payload(records: list[dict]) -> dict:
    """Wrap records in seen_jobs.json format."""
    return {"seen": {f"portal:{i}": r for i, r in enumerate(records)}}


def make_canonical_payload(records: list[dict]) -> dict:
    """Canonical payload keyed by stable_id."""
    return {r["stable_id"]: r for r in records}


def valid_stable_id(suffix: str = "0") -> str:
    """Generate a valid 64-char hex stable_id."""
    return "a" * (64 - len(suffix)) + suffix


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Create a test database manager with isolated SQLite."""
    db_path = os.path.join(tempfile.gettempdir(), f"test_db_{uuid.uuid4().hex}.db")
    manager = DatabaseManager()
    manager.initialize(f"sqlite+aiosqlite:///{db_path}", echo=False)
    await manager.create_all()
    yield manager
    await manager.drop_all()
    await manager.close()
    if os.path.exists(db_path):
        os.unlink(db_path)


@pytest_asyncio.fixture
async def session(db_manager: DatabaseManager):
    """Create a test database session."""
    async with db_manager.session() as session:
        yield session


@pytest_asyncio.fixture
async def seed_user_jobs(db_manager: DatabaseManager, session: AsyncSession):
    """Seed user_jobs and applications for protection tests."""
    user = User(name="Test User", email="test@example.com", password_hash="hash")
    session.add(user)
    await session.commit()
    await session.refresh(user)

    protected_stable = valid_stable_id("f1")
    unprotected_stable = valid_stable_id("f2")

    user_job = UserJob(user_id=user.id, job_stable_id=protected_stable, status=UserJobStatus.SAVED)
    app = Application(user_id=user.id, job_stable_id=protected_stable, company="Test", role="Test", status=ApplicationStatus.DRAFT)
    session.add_all([user_job, app])
    await session.commit()

    return {"user": user, "protected": protected_stable, "unprotected": unprotected_stable}


@pytest.fixture
def temp_files():
    """Create temporary JSON files for seen/canonical/checkpoints."""
    with tempfile.TemporaryDirectory() as tmpdir:
        seen_path = Path(tmpdir) / "seen_jobs.json"
        canonical_path = Path(tmpdir) / "canonical_jobs.json"
        checkpoints_path = Path(tmpdir) / "checkpoints.json"
        lock_path = Path(tmpdir) / ".sync.lock"
        yield {
            "seen": seen_path,
            "canonical": canonical_path,
            "checkpoints": checkpoints_path,
            "lock": lock_path,
        }


@pytest.fixture
def valid_checkpoint():
    """Valid checkpoint payload for ranking_report complete."""
    return {
        "current_checkpoint": {
            "run_id": "20260826000000",
            "started_at": "2026-08-26T00:00:00.000Z",
            "stage": "ranking_report",
            "stage_status": "complete",
            "jobs_processed_in_stage": 10,
            "total_jobs_in_stage": 10,
            "batch_index": 1,
            "total_batches": 1,
            "last_updated": "2026-08-26T02:04:36.553Z",
        }
    }


@pytest.fixture
def base_job_record():
    """Base valid job record."""
    return {
        "stable_id": valid_stable_id("01"),
        "title": "Software Engineer",
        "company": "Tech Corp",
        "location": "Manila, Philippines",
        "salary": "50000-70000 PHP",
        "url": "https://example.com/job/1",
        "portal": "indeed",
        "arrangement": "remote",
        "work_mode": "full-time",
        "description": "Great job",
        "processing_state": "ACTIVE_VERIFIED",
        "status": "active",
        "first_seen": "2026-08-20T00:00:00Z",
        "last_verified": "2026-08-25T00:00:00Z",
        "blocked_at": None,
        "blocked_reason": None,
        "changed_at": None,
        "changed_fields": None,
        "closed_at": None,
        "last_active_at": "2026-08-25T00:00:00Z",
        "fingerprint": "abcdef123456",
        "previous_fingerprint": None,
        "rank": 1,
        "rank_score": 85,
        "rank_verdict": "Strong Match",
        "rank_date": "2026-08-25T00:00:00Z",
        "fit": "Strong Match",
        "priority_tier": 1,
        "strengths": ["Python", "FastAPI"],
        "gaps": ["Docker"],
        "evaluation": "Good match",
        "source_updated_at": "2026-08-25T00:00:00Z",
        "source_schema_version": "1.0",
    }


class TestNormalizeRecords:
    """Tests for normalize_records function."""

    def test_stable_id_validation(self, base_job_record):
        """Accept valid stable_ids, reject invalid/malformed."""
        records, rejected = normalize_records(
            make_seen_payload([base_job_record]),
            make_canonical_payload([])
        )
        assert len(records) == 1
        assert len(rejected) == 0

        # Invalid stable_id
        bad = dict(base_job_record)
        bad["stable_id"] = "not-a-valid-hex-id"
        records, rejected = normalize_records(
            make_seen_payload([bad]),
            make_canonical_payload([])
        )
        assert len(records) == 0
        assert len(rejected) == 1
        assert "invalid stable_id" in rejected[0]

    def test_duplicate_detection(self, base_job_record):
        """Non-byte-equal duplicates in seen are deterministically deduplicated."""
        dup = dict(base_job_record)
        dup["title"] = "Different Title"
        # Both have same number of populated fields, so first one wins
        records, rejected = normalize_records(
            make_seen_payload([base_job_record, dup]),
            make_canonical_payload([])
        )
        assert len(records) == 1
        assert len(rejected) == 0  # duplicates are deduplicated, not rejected
        # First record (base_job_record) should win
        assert records[0]["title"] == "Software Engineer"

    def test_duplicate_more_populated_wins(self, base_job_record):
        """Among duplicates, the record with more populated fields wins."""
        sparse = dict(base_job_record)
        sparse.pop("salary")
        sparse.pop("description")
        dense = dict(base_job_record)
        dense["description"] = "A much longer description for the job"
        dense["salary"] = "60000-80000 PHP"

        # sparse first, dense second -> dense should win
        records, rejected = normalize_records(
            make_seen_payload([sparse, dense]),
            make_canonical_payload([])
        )
        assert len(records) == 1
        assert len(rejected) == 0
        assert records[0]["salary"] == "60000-80000 PHP"

        # dense first, sparse second -> dense should remain
        records, rejected = normalize_records(
            make_seen_payload([dense, sparse]),
            make_canonical_payload([])
        )
        assert len(records) == 1
        assert len(rejected) == 0
        assert records[0]["salary"] == "60000-80000 PHP"

    def test_duplicate_conflicts_detected(self, base_job_record):
        """Differing non-null values for the same field are reported as conflicts."""
        first = dict(base_job_record)
        second = dict(base_job_record)
        second["salary"] = "60000-80000 PHP"
        conflicts: dict[str, set[str]] = {}
        records, rejected = normalize_records(
            make_seen_payload([first, second]),
            make_canonical_payload([]),
            conflicts=conflicts,
        )
        assert len(records) == 1
        assert len(rejected) == 0
        assert conflicts[base_job_record["stable_id"]] == {"salary"}

    def test_missing_vs_populated_not_conflict(self, base_job_record):
        """A missing-vs-populated difference is a fill, not a conflict."""
        first = dict(base_job_record)
        second = dict(base_job_record)
        second.pop("description")
        second["salary"] = "70000-90000 PHP"
        conflicts: dict[str, set[str]] = {}
        records, _ = normalize_records(
            make_seen_payload([first, second]),
            make_canonical_payload([]),
            conflicts=conflicts,
        )
        assert len(records) == 1
        # Only salary differs between two non-blank values; description is missing in one
        assert conflicts[base_job_record["stable_id"]] == {"salary"}

    def test_explicit_null_not_conflict(self, base_job_record):
        """Explicit null is blank, so it never counts as a conflict."""
        first = dict(base_job_record)
        second = dict(base_job_record)
        second["salary"] = None
        conflicts: dict[str, set[str]] = {}
        records, _ = normalize_records(
            make_seen_payload([first, second]),
            make_canonical_payload([]),
            conflicts=conflicts,
        )
        assert len(records) == 1
        assert base_job_record["stable_id"] not in conflicts

    def test_more_populated_wins_conflicts_reported(self, base_job_record):
        """More-populated-wins stays deterministic and conflicts stay order-independent."""
        sparse = dict(base_job_record)
        sparse.pop("description")
        dense = dict(base_job_record)
        dense["salary"] = "60000-80000 PHP"

        conflicts_forward: dict[str, set[str]] = {}
        records_forward, _ = normalize_records(
            make_seen_payload([sparse, dense]),
            make_canonical_payload([]),
            conflicts=conflicts_forward,
        )
        conflicts_reverse: dict[str, set[str]] = {}
        records_reverse, _ = normalize_records(
            make_seen_payload([dense, sparse]),
            make_canonical_payload([]),
            conflicts=conflicts_reverse,
        )
        assert len(records_forward) == 1
        assert len(records_reverse) == 1
        assert records_forward[0]["salary"] == "60000-80000 PHP"
        assert records_reverse[0]["salary"] == "60000-80000 PHP"
        assert conflicts_forward == conflicts_reverse
        assert conflicts_forward[base_job_record["stable_id"]] == {"salary"}

    def test_canonical_merge(self, base_job_record):
        """Missing core fields filled from canonical."""
        seen_rec = dict(base_job_record)
        del seen_rec["description"]
        del seen_rec["salary"]
        # Note: do NOT set salary to None - that would be explicit null
        # which should NOT be filled from canonical per architecture

        canonical_rec = dict(base_job_record)
        canonical_rec["description"] = "Full description from canonical"
        canonical_rec["salary"] = "60000-80000 PHP"

        records, rejected = normalize_records(
            make_seen_payload([seen_rec]),
            make_canonical_payload([canonical_rec])
        )
        assert len(records) == 1
        assert len(rejected) == 0
        assert records[0]["description"] == "Full description from canonical"
        assert records[0]["salary"] == "60000-80000 PHP"

    def test_null_handling(self, base_job_record):
        """Explicit null in source replaces SQL; absent field preserves SQL."""
        # Explicit null in seen -> should NOT be filled from canonical
        seen_rec = dict(base_job_record)
        seen_rec["salary"] = None  # explicit null
        canonical_rec = dict(base_job_record)
        canonical_rec["salary"] = "60000-80000 PHP"

        records, _ = normalize_records(
            make_seen_payload([seen_rec]),
            make_canonical_payload([canonical_rec])
        )
        # Explicit null means keep null, not fill from canonical
        assert records[0]["salary"] is None

    def test_canonical_invalid_stable_id_rejected(self, base_job_record):
        """Canonical records with invalid stable_id are rejected."""
        canonical_rec = dict(base_job_record)
        canonical_rec["stable_id"] = "not-valid"
        with pytest.raises(SyncValidationError, match="invalid stable_id"):
            _merged_canonical(make_canonical_payload([canonical_rec]))


class TestJobSyncService:
    """Integration tests using real SQLite database."""

    async def _write_files(self, temp_files, seen_payload, canonical_payload, checkpoint_payload):
        with open(temp_files["seen"], "w") as f:
            json.dump(seen_payload, f)
        with open(temp_files["canonical"], "w") as f:
            json.dump(canonical_payload, f)
        with open(temp_files["checkpoints"], "w") as f:
            json.dump(checkpoint_payload, f)

    async def test_idempotent_upsert(self, db_manager, temp_files, valid_checkpoint, base_job_record):
        """Second sync produces only unchanged."""
        service = JobSyncService(db_manager, temp_files["lock"])

        # First sync
        await self._write_files(temp_files, make_seen_payload([base_job_record]), make_canonical_payload([]), valid_checkpoint)
        summary1 = await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=False, dry_run=False
        )
        assert summary1.inserted == 1
        assert summary1.updated == 0
        assert summary1.unchanged == 0
        assert summary1.reconciliation_passed

        # Second sync with identical data
        summary2 = await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=False, dry_run=False
        )
        assert summary2.inserted == 0
        assert summary2.updated == 0
        assert summary2.unchanged == 1
        assert summary2.reconciliation_passed

    async def test_incremental_vs_full_snapshot(self, db_manager, temp_files, valid_checkpoint, base_job_record):
        """Incremental leaves absent; full marks tombstone (excludes protected)."""
        service = JobSyncService(db_manager, temp_files["lock"])

        # Sync two jobs
        job2 = dict(base_job_record)
        job2["stable_id"] = valid_stable_id("02")
        job2["title"] = "Another Job"
        await self._write_files(temp_files, make_seen_payload([base_job_record, job2]), make_canonical_payload([]), valid_checkpoint)
        summary1 = await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=False, dry_run=False
        )
        assert summary1.inserted == 2

        # Full snapshot: only job1 in source -> job2 should be tombstoned
        await self._write_files(temp_files, make_seen_payload([base_job_record]), make_canonical_payload([]), valid_checkpoint)
        summary2 = await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=True, dry_run=False
        )
        assert summary2.inserted == 0
        assert summary2.unchanged == 1
        assert summary2.tombstoned == 1

    async def test_application_protection(self, db_manager, temp_files, valid_checkpoint, base_job_record, seed_user_jobs):
        """Application-linked jobs retained, never deleted in full snapshot."""
        protected_id = seed_user_jobs["protected"]
        unprotected_id = seed_user_jobs["unprotected"]

        service = JobSyncService(db_manager, temp_files["lock"])

        # Add two jobs: one protected, one not
        base_job_record["stable_id"] = protected_id
        job2 = dict(base_job_record)
        job2["stable_id"] = unprotected_id
        job2["title"] = "Unprotected Job"

        await self._write_files(temp_files, make_seen_payload([base_job_record, job2]), make_canonical_payload([]), valid_checkpoint)
        summary1 = await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=False, dry_run=False
        )
        assert summary1.inserted == 2

        # Full snapshot with ONLY unprotected job in source -> protected job absent should be application_protected
        await self._write_files(temp_files, make_seen_payload([job2]), make_canonical_payload([]), valid_checkpoint)
        summary2 = await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=True, dry_run=False
        )
        # Unprotected job IS in source -> NOT tombstoned (unchanged)
        assert summary2.tombstoned == 0
        # Protected absent record should be counted as application_protected
        assert summary2.application_protected >= 1

        # Verify protected job still active
        async with db_manager.session_factory() as session:
            job = await session.get(Job, protected_id)
            assert job is not None
            assert job.is_tombstone is False

    async def test_dry_run(self, db_manager, temp_files, valid_checkpoint, base_job_record):
        """Dry-run reports diff, no writes."""
        service = JobSyncService(db_manager, temp_files["lock"])

        await self._write_files(temp_files, make_seen_payload([base_job_record]), make_canonical_payload([]), valid_checkpoint)
        summary = await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=False, dry_run=True
        )
        assert summary.dry_run is True
        assert summary.inserted == 1
        assert summary.reconciliation_passed

        # Verify no data was written
        async with db_manager.session_factory() as session:
            count = await session.execute(select(func.count(Job.stable_id)))
            assert count.scalar_one() == 0

    async def test_duplicate_conflicts_reported_in_summary(self, db_manager, temp_files, valid_checkpoint, base_job_record):
        """Duplicate conflicts surface on the SyncSummary and its rendered output."""
        service = JobSyncService(db_manager, temp_files["lock"])
        dup = dict(base_job_record)
        dup["salary"] = "60000-80000 PHP"
        await self._write_files(temp_files, make_seen_payload([base_job_record, dup]), make_canonical_payload([]), valid_checkpoint)
        summary = await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=False, dry_run=True
        )
        assert summary.duplicate_conflicts == 1
        assert summary.conflict_fields.get("salary") == 1
        rendered = summary.format()
        assert "Duplicate conflicts: 1" in rendered
        assert "salary:1" in rendered

    async def test_rollback_on_failure(self, db_manager, temp_files, valid_checkpoint, base_job_record):
        """Mid-sync failure rolls back all."""
        service = JobSyncService(db_manager, temp_files["lock"])

        # First sync to create a job
        await self._write_files(temp_files, make_seen_payload([base_job_record]), make_canonical_payload([]), valid_checkpoint)
        await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=False, dry_run=False
        )

        # Second sync where all records fail validation -> raises before any write
        bad = {"stable_id": valid_stable_id("ff")}  # missing required fields
        await self._write_files(temp_files, make_seen_payload([bad]), make_canonical_payload([]), valid_checkpoint)
        with pytest.raises(SyncValidationError, match="missing required fields"):
            await service.sync(
                temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
                run_id="20260826000000", full_snapshot=False, dry_run=False
            )

        # Verify original job unchanged (rollback)
        async with db_manager.session_factory() as session:
            job = await session.get(Job, base_job_record["stable_id"])
            assert job is not None
            assert job.title == "Software Engineer"

    async def test_reconciliation(self, db_manager, temp_files, valid_checkpoint, base_job_record):
        """Counts match expectations after sync."""
        service = JobSyncService(db_manager, temp_files["lock"])

        await self._write_files(temp_files, make_seen_payload([base_job_record]), make_canonical_payload([]), valid_checkpoint)
        summary = await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=False, dry_run=False
        )
        assert summary.final_count == 1
        assert summary.reconciliation_passed

        # Verify actual DB count matches
        async with db_manager.session_factory() as session:
            count = await session.execute(select(func.count(Job.stable_id)))
            assert count.scalar_one() == 1

    async def test_invalid_checkpoint_rejected(self, db_manager, temp_files, base_job_record):
        """Incomplete/failed checkpoint stages are rejected."""
        service = JobSyncService(db_manager, temp_files["lock"])

        bad_checkpoint = {
            "current_checkpoint": {
                "run_id": "20260826000000",
                "stage": "scoring",
                "stage_status": "complete",
                "jobs_processed_in_stage": 10,
                "total_jobs_in_stage": 10,
            }
        }
        await self._write_files(temp_files, make_seen_payload([base_job_record]), make_canonical_payload([]), bad_checkpoint)
        with pytest.raises(SyncValidationError, match="checkpoint is not complete at ranking_report"):
            await service.sync(
                temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
                run_id="20260826000000", full_snapshot=False, dry_run=False
            )

    async def test_mismatched_run_id_rejected(self, db_manager, temp_files, base_job_record):
        """Checkpoint run_id must match requested run_id."""
        service = JobSyncService(db_manager, temp_files["lock"])

        checkpoint = {
            "current_checkpoint": {
                "run_id": "different-run-id",
                "stage": "ranking_report",
                "stage_status": "complete",
            }
        }
        await self._write_files(temp_files, make_seen_payload([base_job_record]), make_canonical_payload([]), checkpoint)
        with pytest.raises(SyncValidationError, match="does not match requested"):
            await service.sync(
                temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
                run_id="20260826000000", full_snapshot=False, dry_run=False
            )

    async def test_missing_required_fields_rejected(self, db_manager, temp_files, valid_checkpoint):
        """Records missing title/company/url/processing_state are rejected."""
        service = JobSyncService(db_manager, temp_files["lock"])

        bad = {
            "stable_id": valid_stable_id("01"),
            # missing title, company, url, processing_state
        }
        await self._write_files(temp_files, make_seen_payload([bad]), make_canonical_payload([]), valid_checkpoint)
        with pytest.raises(SyncValidationError, match="missing required fields"):
            await service.sync(
                temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
                run_id="20260826000000", full_snapshot=False, dry_run=False
            )

    async def test_full_snapshot_reconciliation_active_count(self, db_manager, temp_files, valid_checkpoint, base_job_record):
        """Full snapshot active count matches expected (excludes protected)."""
        service = JobSyncService(db_manager, temp_files["lock"])

        # Seed three jobs: two normal, one protected
        job2 = dict(base_job_record)
        job2["stable_id"] = valid_stable_id("02")
        job2["title"] = "Job 2"

        job3 = dict(base_job_record)
        job3["stable_id"] = valid_stable_id("03")
        job3["title"] = "Job 3"

        await self._write_files(temp_files, make_seen_payload([base_job_record, job2, job3]), make_canonical_payload([]), valid_checkpoint)
        await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=False, dry_run=False
        )

        # Full snapshot with only job1 -> job2 should be tombstoned, job3 too
        await self._write_files(temp_files, make_seen_payload([base_job_record]), make_canonical_payload([]), valid_checkpoint)
        summary = await service.sync(
            temp_files["seen"], temp_files["canonical"], temp_files["checkpoints"],
            run_id="20260826000000", full_snapshot=True, dry_run=False
        )
        assert summary.tombstoned == 2
        assert summary.reconciliation_passed

        # Verify active count = 1 (only job1)
        async with db_manager.session_factory() as session:
            active_count = await session.execute(select(func.count(Job.stable_id)).where(Job.is_tombstone.is_(False)))
            assert active_count.scalar_one() == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])