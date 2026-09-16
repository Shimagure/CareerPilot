"""Search run manager: lifecycle, background execution, concurrency control.

This module owns the SearchRun lifecycle — creation, background execution,
status transitions, and startup reconciliation. It is the ONLY module that
writes to search_runs from application code.

Design:
  - Module-level SearchRunManager singleton
  - asyncio.Task-based background execution (NOT durable across restarts)
  - Single-active-run concurrency policy (the global pipeline uses shared state)
  - Startup reconciliation marks stale queued/running as failed
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db_manager
from app.models.database_models import SearchPreferences, SearchRun, SearchRunStatus, User

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _snapshot_preferences(pref: Optional[SearchPreferences]) -> Optional[dict]:
    """Capture an immutable preference snapshot at run creation time.

    This is a JSON-serializable dict of search intent — NOT credentials.
    Changes to the user's preferences after run creation do NOT modify
    historical SearchRun records.
    """
    if pref is None:
        return None

    def _json_list(val: Optional[str]) -> list:
        if not val:
            return []
        try:
            parsed = json.loads(val)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []

    arrangements: list[str] = []
    if pref.remote_ok:
        arrangements.append("remote")
    if pref.hybrid_ok:
        arrangements.append("hybrid")
    if pref.onsite_ok:
        arrangements.append("onsite")

    return {
        "target_roles": _json_list(pref.target_roles),
        "preferred_locations": _json_list(pref.preferred_locations),
        "excluded_keywords": _json_list(pref.excluded_keywords),
        "work_arrangements": arrangements,
        "salary_min": pref.salary_min,
        "salary_max": pref.salary_max,
        "salary_currency": pref.salary_currency,
        "salary_period": pref.salary_period,
        "ncr_only": pref.ncr_only,
        "career_direction": pref.career_direction,
    }


def _derive_keywords(pref_snapshot: Optional[dict], override: Optional[str]) -> str:
    """Derive search keywords from preferences or override. Never empty string."""
    if override:
        return override.strip()
    if pref_snapshot:
        roles = pref_snapshot.get("target_roles", [])
        if roles:
            return str(roles[0])
    return "IT Support"


def _derive_location(pref_snapshot: Optional[dict], override: Optional[str]) -> str:
    """Derive location from preferences or override."""
    if override:
        return override.strip()
    if pref_snapshot:
        locations = pref_snapshot.get("preferred_locations", [])
        if locations:
            return str(locations[0])
    ncr_only = pref_snapshot.get("ncr_only", False) if pref_snapshot else False
    return "Metro Manila" if ncr_only else "Philippines"


class SearchRunManager:
    """Manages search run lifecycle with concurrency control and background execution.

    Usage (from router):
        manager = get_search_run_manager()
        run = await manager.start_run(session, current_user, request)
    """

    def __init__(self) -> None:
        self._active_tasks: dict[str, asyncio.Task] = {}
        self._starting_lock = asyncio.Lock()

    async def start_run(
        self,
        session: AsyncSession,
        user: User,
        dry_run: bool = False,
        search_keywords: Optional[str] = None,
        search_location: Optional[str] = None,
    ) -> SearchRun:
        """Create a SearchRun, enqueue background execution, return immediately.

        Raises ValueError with a specific message on concurrency violation (409).
        """
        async with self._starting_lock:
            # Concurrency check: reject if ANY run is queued or running (global pipeline state)
            result = await session.execute(
                select(SearchRun.id).where(
                    SearchRun.status.in_([SearchRunStatus.QUEUED, SearchRunStatus.RUNNING])
                ).limit(1)
            )
            existing = result.scalar_one_or_none()
            if existing:
                raise ValueError(
                    "A search run is already in progress. "
                    "Please wait for it to complete before starting a new one."
                )

            # Load preferences
            pref_result = await session.execute(
                select(SearchPreferences).where(SearchPreferences.user_id == user.id)
            )
            pref = pref_result.scalar_one_or_none()
            pref_snapshot = _snapshot_preferences(pref)

            # Derive execution parameters
            keywords = _derive_keywords(pref_snapshot, search_keywords)
            location = _derive_location(pref_snapshot, search_location)

            execution_options = {
                "dry_run": dry_run,
                "keywords": keywords,
                "location": location,
                "job_age": 14,
                "limit": 20,
            }

            # Build run_metadata with preference snapshot + execution options
            metadata = {
                "preference_snapshot": pref_snapshot,
                "execution_options": execution_options,
                "pipeline_stage": "preparing",
                "result_summary": None,
            }

            # Create SearchRun
            run = SearchRun(
                user_id=user.id,
                status=SearchRunStatus.QUEUED,
                run_metadata=json.dumps(metadata),
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)

            # Enqueue background execution (fire-and-forget; task tracked in memory)
            task = asyncio.create_task(
                self._execute_background(run.id, dry_run, keywords, location)
            )
            self._active_tasks[run.id] = task
            task.add_done_callback(lambda t, rid=run.id: self._active_tasks.pop(rid, None))

            return run

    async def _execute_background(
        self,
        run_id: str,
        dry_run: bool,
        keywords: str,
        location: str,
    ) -> None:
        """Background task: transition QUEUED → RUNNING → COMPLETED/FAILED.

        Uses a fresh session per phase (sessions are not shared across tasks).
        Non-durable: if the process restarts, running/queued runs are reconciled
        to failed at startup.

        Resource-exhaustion hardening (P3.1):
          * a run that exceeds the configured max duration is force-failed so a
            slow/stuck run cannot hold the global single-run lock forever;
          * a Phase-1 transition failure FAILS the run rather than leaving it
            parked in QUEUED (which would otherwise monopolize the lock).
        """
        from app.services.pipeline_adapter import DryRunExecutor, PortalDiscoveryExecutor

        db_manager = get_db_manager()

        # Phase 1: QUEUED → RUNNING
        try:
            async with db_manager.session() as session:
                await session.execute(
                    update(SearchRun)
                    .where(SearchRun.id == run_id, SearchRun.status == SearchRunStatus.QUEUED)
                    .values(
                        status=SearchRunStatus.RUNNING,
                        started_at=_utcnow(),
                    )
                )
        except Exception:
            logger.exception("Failed to transition run %s to RUNNING", run_id)
            await self._finalize_failed(run_id, "Failed to transition run to RUNNING.")
            return

        # Phase 2: Execute discovery, bounded by the max-run-duration watchdog.
        executor = DryRunExecutor() if dry_run else PortalDiscoveryExecutor()
        max_duration = max(1, int(get_settings().search_run_max_duration_seconds))
        try:
            pipeline_result = await asyncio.wait_for(
                executor.execute(keywords=keywords, location=location),
                timeout=max_duration,
            )
        except TimeoutError:
            logger.error(
                "Run %s exceeded max duration (%s seconds); force-failing",
                run_id,
                max_duration,
            )
            pipeline_result = None
            pipeline_error = "Execution timed out."
        except Exception as e:
            # Full exception is logged server-side (logger.exception) for
            # diagnostics; the client-facing error is sanitized so internal
            # details (paths, subprocess text, credentials) never reach the API.
            logger.exception("Pipeline execution failed for run %s", run_id)
            pipeline_result = None
            pipeline_error = "Search pipeline execution failed."
        else:
            pipeline_error = (
                pipeline_result.error if (pipeline_result and pipeline_result.error) else None
            )

        # Phase 3: Transition to COMPLETED or FAILED
        try:
            async with db_manager.session() as session:
                run_row = await session.get(SearchRun, run_id)
                if run_row is None:
                    logger.error("Run %s disappeared during execution", run_id)
                    return

                existing_meta = {}
                if run_row.run_metadata:
                    try:
                        existing_meta = json.loads(run_row.run_metadata)
                    except Exception:
                        existing_meta = {}

                if pipeline_result and pipeline_result.success:
                    existing_meta["pipeline_stage"] = "completed"
                    existing_meta["result_summary"] = {
                        "total_jobs_found": pipeline_result.total_jobs_found,
                        "portals_attempted": len(pipeline_result.portal_results),
                        "portals_succeeded": sum(
                            1 for r in pipeline_result.portal_results if r.success
                        ),
                    }
                    run_row.status = SearchRunStatus.COMPLETED
                    run_row.completed_at = _utcnow()
                else:
                    existing_meta["pipeline_stage"] = "failed"
                    run_row.status = SearchRunStatus.FAILED
                    run_row.completed_at = _utcnow()
                    run_row.error = pipeline_error or "Unknown failure"

                run_row.run_metadata = json.dumps(existing_meta)
        except Exception:
            logger.exception("Failed to finalize run %s", run_id)

    async def _finalize_failed(self, run_id: str, error_msg: str) -> None:
        """Force a run to FAILED so it never stays queued/running forever."""
        try:
            db_manager = get_db_manager()
            async with db_manager.session() as session:
                run_row = await session.get(SearchRun, run_id)
                if run_row is None:
                    logger.error("Run %s disappeared during execution", run_id)
                    return

                existing_meta = {}
                if run_row.run_metadata:
                    try:
                        existing_meta = json.loads(run_row.run_metadata)
                    except Exception:
                        existing_meta = {}

                existing_meta["pipeline_stage"] = "failed"

                run_row.status = SearchRunStatus.FAILED
                run_row.completed_at = _utcnow()
                run_row.error = error_msg or "Unknown failure"
                run_row.run_metadata = json.dumps(existing_meta)
        except Exception:
            logger.exception("Failed to finalize run %s as FAILED", run_id)

    async def wait_for_idle(self, timeout: float = 10.0) -> None:
        """Await all currently active background tasks.

        Used by tests to make assertions deterministic and by graceful
        shutdown to wait for in-flight runs before exiting.
        """
        tasks = list(self._active_tasks.values())
        if tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*tasks, return_exceptions=True), timeout=timeout
                )
            except ValueError as e:
                # Handle case where tasks belong to a different event loop
                # (can happen in test environments with loop switching)
                if "different loop" in str(e):
                    # Fall back to polling the task states
                    start_time = asyncio.get_event_loop().time()
                    while tasks and (asyncio.get_event_loop().time() - start_time) < timeout:
                        tasks = [t for t in tasks if not t.done()]
                        if tasks:
                            await asyncio.sleep(0.1)
                    return
                raise

    async def reconcile_stale_runs(self) -> int:
        """Mark any queued/running runs as failed on startup.

        These represent runs from a previous process that was killed.
        Non-durable background tasks cannot survive restarts.
        """
        db_manager = get_db_manager()
        async with db_manager.session() as session:
            result = await session.execute(
                select(SearchRun.id).where(
                    SearchRun.status.in_([SearchRunStatus.QUEUED, SearchRunStatus.RUNNING])
                )
            )
            stale_ids = [row[0] for row in result.all()]

            if not stale_ids:
                return 0

            for run_id in stale_ids:
                run_row = await session.get(SearchRun, run_id)
                if run_row is None:
                    continue

                existing_meta = {}
                if run_row.run_metadata:
                    try:
                        existing_meta = json.loads(run_row.run_metadata)
                    except Exception:
                        existing_meta = {}

                existing_meta["pipeline_stage"] = "failed"
                existing_meta["reconciled_at_startup"] = True

                run_row.status = SearchRunStatus.FAILED
                run_row.completed_at = _utcnow()
                run_row.error = "Run was interrupted by server restart."
                run_row.run_metadata = json.dumps(existing_meta)

            return len(stale_ids)


# ──────────────────────────────────────────────────────────────────────────────
# Module-level singleton
# ──────────────────────────────────────────────────────────────────────────────

_manager: Optional[SearchRunManager] = None


def get_search_run_manager() -> SearchRunManager:
    """Return the module-level SearchRunManager singleton."""
    global _manager
    if _manager is None:
        _manager = SearchRunManager()
    return _manager
