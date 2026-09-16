"""One-way pipeline JSON to SQL jobs mirror synchronization."""
from __future__ import annotations

import json
import os
import re
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.database import DatabaseManager
from app.models.database_models import Application, Job, UserJob

STABLE_ID_RE = re.compile(r"^[0-9a-fA-F]{64}$")
CORE_FIELDS = (
    "title", "company", "location", "salary", "url", "portal",
    "arrangement", "work_mode", "description",
)
PIPELINE_FIELDS = (
    "source_key", "portal", "processing_state", "status", "first_seen",
    "last_verified", "blocked_at", "blocked_reason", "changed_at",
    "changed_fields", "closed_at", "last_active_at", "title", "company",
    "location", "salary", "url", "arrangement", "work_mode", "description",
    "fingerprint", "previous_fingerprint", "rank", "rank_score", "rank_verdict",
    "rank_date", "fit", "priority_tier", "strengths", "gaps", "evaluation",
    "source_updated_at", "source_schema_version",
)
JSON_FIELDS = {"changed_fields", "strengths", "gaps", "evaluation"}
DATE_FIELDS = {
    "first_seen", "last_verified", "blocked_at", "changed_at", "closed_at",
    "last_active_at", "rank_date", "source_updated_at",
}


class SyncValidationError(ValueError):
    """Raised when the pipeline input cannot be synchronized safely."""


class SyncLockError(RuntimeError):
    """Raised when another sync process owns the lock."""


@dataclass
class SyncSummary:
    run_id: str
    mode: str
    dry_run: bool
    input_records: int = 0
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    rejected: list[str] = field(default_factory=list)
    tombstoned: int = 0
    application_protected: int = 0
    duplicate_conflicts: int = 0
    conflict_fields: dict[str, int] = field(default_factory=dict)
    final_count: int = 0
    reconciliation_passed: bool = False
    reconciliation_error: str | None = None

    def format(self) -> str:
        lines = [
            "CP15.2 DATABASE SYNC",
            f"- Run: {self.run_id}",
            f"- Mode: {self.mode}{' DRY-RUN' if self.dry_run else ''}",
            f"- Input records: {self.input_records}",
            f"- Inserted: {self.inserted}",
            f"- Updated: {self.updated}",
            f"- Unchanged: {self.unchanged}",
            f"- Rejected: {len(self.rejected)}",
            f"- Duplicate conflicts: {self.duplicate_conflicts}",
        ]
        if self.conflict_fields:
            lines.append(
                "- Conflict fields: "
                + ", ".join(f"{name}:{count}" for name, count in sorted(self.conflict_fields.items()))
            )
        lines.extend([
            f"- Tombstoned: {self.tombstoned}",
            f"- Application-protected: {self.application_protected}",
            f"- SQL jobs after sync: {self.final_count}",
            f"- Reconciliation: {'PASS' if self.reconciliation_passed else 'FAIL'}",
        ])
        return "\n".join(lines)


class ProcessLock:
    """Cross-platform non-blocking process lock backed by a lock file."""

    def __init__(self, path: Path):
        self.path = path
        self._handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._handle = self.path.open("a+")
        try:
            if os.name == "nt":
                import msvcrt
                self._handle.seek(0)
                self._handle.write(" " or " ")
                self._handle.flush()
                self._handle.seek(0)
                msvcrt.locking(self._handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, IOError) as exc:
            self._handle.close()
            self._handle = None
            raise SyncLockError(f"Sync already in progress: {self.path}") from exc
        self._handle.seek(0)
        self._handle.truncate()
        self._handle.write(f"{os.getpid()}\n")
        self._handle.flush()
        return self

    def __exit__(self, *_exc):
        if self._handle is None:
            return
        try:
            if os.name == "nt":
                import msvcrt
                self._handle.seek(0)
                msvcrt.locking(self._handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
        finally:
            self._handle.close()
            self._handle = None


def _json_value(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _parse_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        raise SyncValidationError(f"timestamp must be a string: {value!r}")
    raw = value.strip()
    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
        return datetime.fromisoformat(raw).replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def _serialize(value: Any, field_name: str) -> Any:
    if field_name in JSON_FIELDS:
        return _json_value(value)
    if field_name in DATE_FIELDS:
        return _parse_datetime(value)
    return value


def _load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise SyncValidationError(f"Unable to load JSON source {path}: {exc}") from exc


def _record_items(payload: Any, source_name: str) -> list[tuple[str, dict[str, Any]]]:
    if source_name == "seen" and isinstance(payload, dict) and isinstance(payload.get("seen"), dict):
        payload = payload["seen"]
    if isinstance(payload, list):
        return [(str(index), item) for index, item in enumerate(payload)]
    if isinstance(payload, dict):
        return list(payload.items())
    raise SyncValidationError(f"{source_name} source must be an object or array")


def _merged_canonical(canonical_payload: Any) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for source_key, record in _record_items(canonical_payload, "canonical"):
        if not isinstance(record, dict):
            raise SyncValidationError(f"canonical record {source_key!r} is not an object")
        stable_id = record.get("stable_id")
        if not isinstance(stable_id, str) or not STABLE_ID_RE.fullmatch(stable_id):
            raise SyncValidationError(f"canonical record {source_key!r} has invalid stable_id")
        if stable_id in result and result[stable_id] != record:
            raise SyncValidationError(f"duplicate canonical stable_id: {stable_id}")
        result[stable_id] = record
    return result


def _count_populated_fields(record: dict[str, Any]) -> int:
    """Count non-null, non-empty fields for deduplication preference."""
    count = 0
    for v in record.values():
        if v is not None and v != "" and v != []:
            count += 1
    return count


def _is_blank(value: Any) -> bool:
    """A value counts as absent for duplicate-conflict purposes."""
    if value is None:
        return True
    if isinstance(value, (str, list, dict, set, tuple)):
        return len(value) == 0
    return False


def _conflict_key(value: Any, field_name: str) -> Any:
    """Hashable, normalization-stable key for duplicate-conflict comparison."""
    if field_name in JSON_FIELDS:
        return _json_value(value)
    if field_name in DATE_FIELDS:
        try:
            return _parse_datetime(value)
        except (SyncValidationError, ValueError):
            return value
    if isinstance(value, (dict, list)):
        return _json_value(value)
    return value


def normalize_records(
    seen_payload: Any,
    canonical_payload: Any,
    conflicts: dict[str, set[str]] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    canonical = _merged_canonical(canonical_payload)
    normalized: dict[str, dict[str, Any]] = {}
    rejected: list[str] = []
    observed: dict[str, dict[str, set[Any]]] = {}
    compare_fields = [field_name for field_name in PIPELINE_FIELDS if field_name not in SQL_OWNED_FIELDS]
    for source_key, record in _record_items(seen_payload, "seen"):
        label = f"{source_key}: invalid record"
        if not isinstance(record, dict):
            rejected.append(label)
            continue
        stable_id = record.get("stable_id")
        if not isinstance(stable_id, str) or not STABLE_ID_RE.fullmatch(stable_id):
            rejected.append(f"{source_key}: invalid stable_id")
            continue
        merged = dict(record)
        merged["source_key"] = source_key
        supplement = canonical.get(stable_id, {})
        for field_name in CORE_FIELDS:
            if field_name not in merged:
                if field_name in supplement:
                    merged[field_name] = supplement[field_name]
        if conflicts is not None:
            values_by_field = observed.setdefault(stable_id, {})
            for field_name in compare_fields:
                value = merged.get(field_name)
                if _is_blank(value):
                    continue
                values_by_field.setdefault(field_name, set()).add(_conflict_key(value, field_name))
        if stable_id in normalized:
            # Deterministic deduplication: prefer record with more populated fields
            existing_populated = _count_populated_fields(normalized[stable_id])
            new_populated = _count_populated_fields(merged)
            if new_populated > existing_populated:
                normalized[stable_id] = merged
            continue
        normalized[stable_id] = merged
    if conflicts is not None:
        for stable_id, fields in observed.items():
            conflicting_fields = {
                field_name for field_name, keys in fields.items() if len(keys) > 1
            }
            if conflicting_fields:
                conflicts[stable_id] = conflicting_fields
    records = []
    for stable_id in sorted(normalized):
        source = normalized[stable_id]
        missing = [field_name for field_name in ("title", "company", "url", "processing_state") if not source.get(field_name)]
        if missing:
            rejected.append(f"{stable_id}: missing required fields {','.join(missing)}")
            continue
        record = {"stable_id": stable_id, "is_tombstone": False}
        for field_name in PIPELINE_FIELDS:
            if field_name in source:
                record[field_name] = _serialize(source[field_name], field_name)
        records.append(record)
    return records, rejected


SQL_OWNED_FIELDS = {"synced_at", "sync_run_id", "is_tombstone", "source_key"}

def _normalize_datetime_for_compare(dt: datetime | None) -> datetime | None:
    """Normalize datetime for comparison - ensure both have timezone or both are naive."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _compare_values(job: Job, record: dict[str, Any]) -> bool:
    for field_name in PIPELINE_FIELDS:
        if field_name in SQL_OWNED_FIELDS:
            continue
        if field_name in record:
            job_val = getattr(job, field_name)
            rec_val = record[field_name]
            # Normalize datetime comparison
            if field_name in DATE_FIELDS:
                job_val = _normalize_datetime_for_compare(job_val)
                rec_val = _normalize_datetime_for_compare(rec_val)
            if job_val != rec_val:
                return False
    return job.is_tombstone is False


class JobSyncService:
    """Validate and synchronize pipeline records into the global jobs mirror."""

    def __init__(self, db_manager: DatabaseManager, lock_path: Path):
        self.db_manager = db_manager
        self.lock_path = lock_path

    @staticmethod
    def _validate_checkpoint(payload: Any, run_id: str) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise SyncValidationError("checkpoint source must be an object")
        checkpoint = payload.get("current_checkpoint")
        if not isinstance(checkpoint, dict):
            raise SyncValidationError("checkpoint has no current_checkpoint")
        if checkpoint.get("stage") != "ranking_report" or checkpoint.get("stage_status") != "complete":
            raise SyncValidationError("checkpoint is not complete at ranking_report")
        if run_id and checkpoint.get("run_id") != run_id:
            raise SyncValidationError(
                f"checkpoint run_id {checkpoint.get('run_id')!r} does not match requested {run_id!r}"
            )
        return checkpoint

    async def sync(
        self,
        seen_jobs_path: Path,
        canonical_jobs_path: Path,
        checkpoints_path: Path,
        *,
        run_id: str,
        full_snapshot: bool = False,
        dry_run: bool = False,
    ) -> SyncSummary:
        mode = "FULL_SNAPSHOT" if full_snapshot else "INCREMENTAL"
        summary = SyncSummary(run_id=run_id, mode=mode, dry_run=dry_run)
        with ProcessLock(self.lock_path):
            seen_payload = _load_json(seen_jobs_path)
            canonical_payload = _load_json(canonical_jobs_path)
            checkpoint = self._validate_checkpoint(_load_json(checkpoints_path), run_id)
            conflicts: dict[str, set[str]] = {}
            records, rejected = normalize_records(seen_payload, canonical_payload, conflicts=conflicts)
            summary.input_records = len(records)
            summary.rejected.extend(rejected)
            summary.duplicate_conflicts = len(conflicts)
            for fields in conflicts.values():
                for field_name in fields:
                    summary.conflict_fields[field_name] = summary.conflict_fields.get(field_name, 0) + 1
            if rejected and not records:
                # All records rejected - nothing valid to sync
                raise SyncValidationError("input validation rejected all records: " + "; ".join(rejected))
            summary.run_id = checkpoint.get("run_id") or run_id
            protected_ids = await self._protected_ids()
            await self._calculate_diff(records, summary, full_snapshot, protected_ids)
            if dry_run:
                await self._reconcile(records, summary, full_snapshot, protected_ids, projected=True)
                return summary
            await self._write_transaction(records, summary, full_snapshot, protected_ids)
            await self._reconcile(records, summary, full_snapshot, protected_ids)
            return summary

    async def _protected_ids(self) -> set[str]:
        async with self.db_manager.session_factory() as session:
            application_ids = await session.execute(select(Application.job_stable_id))
            user_job_ids = await session.execute(select(UserJob.job_stable_id))
            return {row[0] for row in application_ids.all()} | {row[0] for row in user_job_ids.all()}

    async def _calculate_diff(
        self,
        records: list[dict[str, Any]],
        summary: SyncSummary,
        full_snapshot: bool,
        protected_ids: set[str],
    ) -> None:
        ids = [record["stable_id"] for record in records]
        async with self.db_manager.session_factory() as session:
            existing = {}
            if ids:
                result = await session.execute(select(Job).where(Job.stable_id.in_(ids)))
                existing = {job.stable_id: job for job in result.scalars()}
            for record in records:
                job = existing.get(record["stable_id"])
                if job is None:
                    summary.inserted += 1
                elif _compare_values(job, record):
                    summary.unchanged += 1
                else:
                    summary.updated += 1
            if full_snapshot:
                absent_active = Job.is_tombstone.is_(False)
                if ids:
                    absent_active = absent_active & Job.stable_id.not_in(ids)
                if protected_ids:
                    absent_active = absent_active & Job.stable_id.not_in(protected_ids)
                result = await session.execute(select(func.count(Job.stable_id)).where(absent_active))
                summary.tombstoned = int(result.scalar_one())
            if full_snapshot:
                protected_absent = protected_ids - set(ids)
                if protected_absent:
                    protected_result = await session.execute(
                        select(func.count(Job.stable_id)).where(
                            Job.stable_id.in_(protected_absent),
                            Job.is_tombstone.is_(False),
                        )
                    )
                    summary.application_protected = int(protected_result.scalar_one())

    async def _write_transaction(
        self,
        records: list[dict[str, Any]],
        summary: SyncSummary,
        full_snapshot: bool,
        protected_ids: set[str],
    ) -> None:
        now = datetime.now(timezone.utc)
        values = []
        for record in records:
            row = dict(record)
            row["synced_at"] = now
            row["sync_run_id"] = summary.run_id
            values.append(row)
        async with self.db_manager.engine.begin() as connection:
            dialect = connection.dialect.name
            insert_factory = sqlite_insert if dialect == "sqlite" else pg_insert
            for row in values:
                statement = insert_factory(Job).values(**row)
                update_values = {
                    field_name: getattr(statement.excluded, field_name)
                    for field_name in PIPELINE_FIELDS
                    if field_name in row
                }
                update_values.update({
                    "synced_at": statement.excluded.synced_at,
                    "sync_run_id": statement.excluded.sync_run_id,
                    "is_tombstone": False,
                })
                await connection.execute(
                    statement.on_conflict_do_update(
                        index_elements=[Job.stable_id],
                        set_=update_values,
                    )
                )
            if full_snapshot:
                ids = [record["stable_id"] for record in records]
                tombstone_stmt = update(Job).where(Job.is_tombstone.is_(False))
                if ids:
                    tombstone_stmt = tombstone_stmt.where(Job.stable_id.not_in(ids))
                if protected_ids:
                    tombstone_stmt = tombstone_stmt.where(Job.stable_id.not_in(protected_ids))
                await connection.execute(tombstone_stmt.values(is_tombstone=True, synced_at=now, sync_run_id=summary.run_id))

    async def _reconcile(
        self,
        records: list[dict[str, Any]],
        summary: SyncSummary,
        full_snapshot: bool,
        protected_ids: set[str],
        *,
        projected: bool = False,
    ) -> None:
        ids = [record["stable_id"] for record in records]
        async with self.db_manager.session_factory() as session:
            count_result = await session.execute(select(func.count(Job.stable_id)))
            total_db = int(count_result.scalar_one())
            if projected:
                summary.final_count = total_db + summary.inserted
            else:
                summary.final_count = total_db
                result = await session.execute(select(Job).where(Job.stable_id.in_(ids))) if ids else None
                found = {job.stable_id for job in result.scalars()} if result is not None else set()
                if found != set(ids):
                    summary.reconciliation_error = "not all input stable_ids are present after sync"
                elif full_snapshot:
                    active_result = await session.execute(select(func.count(Job.stable_id)).where(Job.is_tombstone.is_(False)))
                    actual_active = int(active_result.scalar_one())
                    # Expected active = jobs in source (ids) + protected jobs absent from source
                    protected_absent = protected_ids - set(ids)
                    expected_active = len(ids) + len(protected_absent)
                    if actual_active != expected_active:
                        summary.reconciliation_error = "full snapshot active count does not match input"
            if summary.reconciliation_error is None:
                summary.reconciliation_passed = True
            else:
                raise RuntimeError(summary.reconciliation_error)
