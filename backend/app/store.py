"""Data store for CareerPilot API - reads from existing pipeline JSON files."""
import json
import csv
import re
from pathlib import Path
from typing import Dict, List, Optional, Any, Set
from functools import lru_cache
import threading
from datetime import datetime, timezone

from .config import (
    CANONICAL_JOBS_FILE,
    SEEN_JOBS_FILE,
    RANKED_JOBS_FILE,
    CHECKPOINTS_FILE,
    TRACKER_FILE,
    TOP5_FILE,
    TOP10_FILE,
    SCORED_JOBS_FILE,
    VERIFIED_JOBS_FILE,
    STALE_JOB_DAYS,
    ACTIVE_POOL_STATES,
    get_project_root,
)
from .models.schemas import (
    JobRecord,
    JobSummary,
    ApplicationRecord,
    ProcessingState,
    WorkArrangement,
    FitLevel,
    PipelineCheckpoint,
    PipelineStage,
    StageStatus,
    PipelineStatus,
    Evaluation,
)


class DataStore:
    """Thread-safe data store reading from pipeline JSON files."""

    def __init__(self):
        self._lock = threading.RLock()
        self._canonical_jobs: Optional[List[Dict]] = None
        self._seen_jobs: Optional[Dict[str, Dict]] = None
        self._ranked_jobs: Optional[List[Dict]] = None
        self._checkpoints: Optional[Dict] = None
        self._applications: Optional[List[ApplicationRecord]] = None
        self._application_stable_ids: Optional[Set[str]] = None
        self._load_time: Optional[float] = None

    def _read_json(self, path: Path) -> Any:
        """Read and parse JSON file."""
        if not path.exists():
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _read_csv(self, path: Path) -> List[Dict]:
        """Read CSV file with skipinitialspace to handle space after commas."""
        if not path.exists():
            return []
        with open(path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, skipinitialspace=True)
            # Normalize keys by stripping whitespace
            fieldnames = [fn.strip() for fn in reader.fieldnames] if reader.fieldnames else []
            rows = []
            for row in reader:
                normalized_row = {k.strip(): v for k, v in row.items()}
                rows.append(normalized_row)
            return rows

    def _normalize_company(self, company: str) -> str:
        """Normalize company name for matching."""
        return re.sub(r"[^\w\s]", "", (company or "").lower()).strip()

    def _normalize_title(self, title: str) -> str:
        """Normalize job title for matching."""
        return re.sub(r"[^\w\s]", "", (title or "").lower()).strip()

    def _get_last_active_at(self, job: Dict) -> Optional[str]:
        """Get last_active_at with fallback chain matching retention.js."""
        # Use last_active_at if present
        if job.get("last_active_at"):
            return job["last_active_at"]
        # Fallback: last_verified -> blocked_at -> first_seen
        if job.get("last_verified"):
            return job["last_verified"]
        if job.get("blocked_at"):
            return job["blocked_at"]
        if job.get("first_seen"):
            return job["first_seen"]
        return None

    def _is_active_pool(self, job: Dict, application_stable_ids: Set[str]) -> bool:
        """Check if job is in active pool (28-day window or application protected)."""
        state = job.get("processing_state")
        if state not in ACTIVE_POOL_STATES:
            return False

        last_active = self._get_last_active_at(job)
        if not last_active:
            return False

        try:
            from datetime import datetime, timezone
            last_active_dt = datetime.fromisoformat(last_active.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            diff_days = (now - last_active_dt).total_seconds() / 86400

            if diff_days <= STALE_JOB_DAYS:
                return True

            # Application protection
            if job.get("stable_id") in application_stable_ids:
                return True
        except Exception:
            pass

        return False

    def load_canonical_jobs(self) -> List[Dict]:
        """Load canonical jobs (merged master list)."""
        with self._lock:
            if self._canonical_jobs is None:
                data = self._read_json(CANONICAL_JOBS_FILE)
                self._canonical_jobs = data if isinstance(data, list) else []
            return self._canonical_jobs

    def load_seen_jobs(self) -> Dict[str, Dict]:
        """Load seen_jobs (persistent state database)."""
        with self._lock:
            if self._seen_jobs is None:
                data = self._read_json(SEEN_JOBS_FILE)
                if data and isinstance(data, dict):
                    # Handle both { "seen": {...} } and direct object
                    self._seen_jobs = data.get("seen", data) if "seen" in data else data
                else:
                    self._seen_jobs = {}
            return self._seen_jobs

    def load_ranked_jobs(self) -> List[Dict]:
        """Load ranked jobs (final active set)."""
        with self._lock:
            if self._ranked_jobs is None:
                data = self._read_json(RANKED_JOBS_FILE)
                self._ranked_jobs = data if isinstance(data, list) else []
            return self._ranked_jobs

    def load_checkpoints(self) -> Dict:
        """Load pipeline checkpoints."""
        with self._lock:
            if self._checkpoints is None:
                self._checkpoints = self._read_json(CHECKPOINTS_FILE) or {}
            return self._checkpoints

    def load_applications(self) -> List[ApplicationRecord]:
        """Load application tracker and resolve stable_ids."""
        with self._lock:
            if self._applications is None:
                rows = self._read_csv(TRACKER_FILE)
                seen_jobs = self.load_seen_jobs()

                # Build lookup: normalized company|title -> stable_id
                stable_id_lookup = {}
                for job in seen_jobs.values():
                    key = f"{self._normalize_company(job.get('company', ''))}|{self._normalize_title(job.get('title', ''))}"
                    if key not in stable_id_lookup:
                        stable_id_lookup[key] = job.get("stable_id")

                apps = []
                for row in rows:
                    company = row.get("company", "").strip()
                    role = row.get("role", "").strip()
                    key = f"{self._normalize_company(company)}|{self._normalize_title(role)}"
                    stable_id = stable_id_lookup.get(key)

                    app = ApplicationRecord(
                        date=row.get("date", ""),
                        company=company,
                        sector=row.get("sector", ""),
                        role=role,
                        role_type=row.get("role_type", ""),
                        channel=row.get("channel", ""),
                        status=row.get("status", ""),
                        contact_person=row.get("contact_person", ""),
                        fit_rating=int(row["fit_rating"]) if row.get("fit_rating", "").isdigit() else None,
                        notes=row.get("notes", ""),
                        cv_file=row.get("cv_file", ""),
                        cover_letter_file=row.get("cover_letter_file", ""),
                        source=row.get("source", ""),
                        stable_id=row.get("stable_id", "") or stable_id,
                    )
                    apps.append(app)

                self._applications = apps
                self._application_stable_ids = {a.stable_id for a in apps if a.stable_id}

            return self._applications

    def get_application_stable_ids(self) -> Set[str]:
        """Get set of stable_ids linked to applications."""
        self.load_applications()
        return self._application_stable_ids or set()

    def get_active_jobs(self) -> List[JobSummary]:
        """Get all active jobs from canonical pipeline with retention status."""
        canonical = self.load_canonical_jobs()
        seen_jobs = self.load_seen_jobs()
        app_stable_ids = self.get_application_stable_ids()

        # Build lookup for seen_jobs by stable_id
        seen_by_stable = {}
        for job in seen_jobs.values():
            sid = job.get("stable_id")
            if sid:
                seen_by_stable[sid] = job

        active_jobs = []
        for job in canonical:
            sid = job.get("stable_id")
            if not sid:
                continue

            # Get full job data from seen_jobs (has processing_state, verification info)
            full_job = seen_by_stable.get(sid, job)

            state_str = full_job.get("processing_state", "UNKNOWN")
            try:
                processing_state = ProcessingState(state_str)
            except ValueError:
                processing_state = ProcessingState.UNKNOWN

            # Only include active states
            if processing_state not in ACTIVE_POOL_STATES:
                continue

            is_active = self._is_active_pool(full_job, app_stable_ids)
            is_protected = sid in app_stable_ids

            summary = JobSummary(
                stable_id=sid,
                title=job.get("title", ""),
                company=job.get("company", ""),
                location=job.get("location"),
                arrangement=WorkArrangement(full_job.get("arrangement") or "unspecified"),
                salary=job.get("salary"),
                portal=job.get("portal"),
                processing_state=processing_state,
                rank_score=full_job.get("rank_score"),
                rank_verdict=full_job.get("rank_verdict"),
                fit=FitLevel(full_job.get("fit") or "unknown"),
                is_active_pool=is_active,
                is_application_protected=is_protected,
            )
            active_jobs.append(summary)

        # Sort by rank_score descending, then by priority_tier, then by first_seen
        active_jobs.sort(
            key=lambda j: (
                -(j.rank_score or 0),
                j.processing_state != ProcessingState.ACTIVE_VERIFIED,
            )
        )

        return active_jobs

    def get_job_by_stable_id(self, stable_id: str) -> Optional[JobRecord]:
        """Get full job record by stable_id."""
        seen_jobs = self.load_seen_jobs()
        job = seen_jobs.get(stable_id)

        if not job:
            # Try canonical jobs
            canonical = self.load_canonical_jobs()
            for j in canonical:
                if j.get("stable_id") == stable_id:
                    job = j
                    break

        if not job:
            return None

        # Enrich with scoring/ranking output from ranked_jobs.json when present.
        # rank fields and evaluation are the authoritative pipeline scoring
        # output; seen/canonical records carry fresher state but not the full
        # evaluation. Prefer the ranked value, falling back to job value.
        ranked_by_stable = {}
        for rj in self.load_ranked_jobs():
            rsid = rj.get("stable_id")
            if rsid:
                ranked_by_stable[rsid] = rj
        ranked = ranked_by_stable.get(stable_id, {})

        def pick(ranked_key: str, job_key: str = None):
            if ranked_key in ranked and ranked.get(ranked_key) is not None:
                return ranked.get(ranked_key)
            return job.get(job_key or ranked_key)

        app_stable_ids = self.get_application_stable_ids()
        is_active = self._is_active_pool(job, app_stable_ids)
        is_protected = stable_id in app_stable_ids

        state_str = pick("processing_state", "processing_state") or "UNKNOWN"
        try:
            processing_state = ProcessingState(state_str)
        except ValueError:
            processing_state = ProcessingState.UNKNOWN

        # Parse evaluation data if present (from seen OR ranked scoring output)
        eval_data = pick("evaluation")
        evaluation = None
        if eval_data:
            evaluation = Evaluation(
                technical=eval_data.get("technical"),
                experience=eval_data.get("experience"),
                behavioral=eval_data.get("behavioral"),
                location=eval_data.get("location"),
                location_note=eval_data.get("location_note"),
                career=eval_data.get("career"),
                overall=eval_data.get("overall"),
                verdict=eval_data.get("verdict"),
                key_strengths=eval_data.get("key_strengths", []),
                gaps=eval_data.get("gaps", []),
                recommendation=eval_data.get("recommendation"),
                evaluated_at=eval_data.get("evaluated_at"),
            )

        return JobRecord(
            stable_id=stable_id,
            title=pick("title", "title") or "",
            company=pick("company", "company") or "",
            location=pick("location", "location"),
            salary=pick("salary", "salary"),
            url=pick("url", "url") or "",
            portal=pick("portal", "portal"),
            arrangement=WorkArrangement(pick("arrangement", "arrangement") or "unspecified"),
            work_mode=pick("work_mode", "work_mode"),
            description=pick("description", "description"),
            processing_state=processing_state,
            first_seen=pick("first_seen", "first_seen"),
            last_verified=pick("last_verified", "last_verified"),
            blocked_at=job.get("blocked_at"),
            blocked_reason=job.get("blocked_reason"),
            changed_at=job.get("changed_at"),
            changed_fields=job.get("changed_fields", []),
            closed_at=job.get("closed_at"),
            fingerprint=pick("fingerprint", "fingerprint"),
            previous_fingerprint=pick("previous_fingerprint", "previous_fingerprint"),
            rank_score=pick("rank_score", "rank_score"),
            rank_verdict=pick("rank_verdict", "rank_verdict"),
            rank_date=pick("rank_date", "rank_date"),
            strengths=pick("strengths", "strengths") or [],
            gaps=pick("gaps", "gaps") or [],
            fit=FitLevel(pick("fit", "fit") or "unknown"),
            status=pick("status", "status"),
            priority_tier=pick("priority_tier", "priority_tier"),
            last_active_at=pick("last_active_at", "last_active_at"),
            is_active_pool=is_active,
            is_application_protected=is_protected,
            evaluation=evaluation,
        )

    def get_pipeline_status(self) -> PipelineStatus:
        """Get pipeline status from checkpoints."""
        checkpoints_data = self.load_checkpoints()

        current = checkpoints_data.get("current_checkpoint")
        current_checkpoint = None
        if current:
            try:
                current_checkpoint = PipelineCheckpoint(
                    run_id=current.get("run_id", ""),
                    started_at=current.get("started_at", ""),
                    mode=current.get("mode"),
                    stage=PipelineStage(current.get("stage", "discovery")),
                    stage_status=StageStatus(current.get("stage_status", "in_progress")),
                    jobs_processed_in_stage=current.get("jobs_processed_in_stage", 0),
                    total_jobs_in_stage=current.get("total_jobs_in_stage", 0),
                    batch_index=current.get("batch_index"),
                    total_batches=current.get("total_batches"),
                    last_updated=current.get("last_updated", ""),
                    error=current.get("error"),
                    passed=current.get("passed"),
                    deprioritized=current.get("deprioritized"),
                    queue_length=current.get("queue_length"),
                    tier_breakdown=current.get("tier_breakdown"),
                    verified=current.get("verified"),
                    blocked=current.get("blocked"),
                    changed=current.get("changed"),
                    closed=current.get("closed"),
                    top5_count=current.get("top5_count"),
                    top10_count=current.get("top10_count"),
                )
            except Exception:
                pass

        history = []
        for h in checkpoints_data.get("run_history", []):
            try:
                history.append(PipelineCheckpoint(
                    run_id=h.get("run_id", ""),
                    started_at=h.get("started_at", ""),
                    mode=h.get("mode"),
                    stage=PipelineStage(h.get("stage", "discovery")),
                    stage_status=StageStatus(h.get("stage_status", "in_progress")),
                    jobs_processed_in_stage=h.get("jobs_processed_in_stage", 0),
                    total_jobs_in_stage=h.get("total_jobs_in_stage", 0),
                    batch_index=h.get("batch_index"),
                    total_batches=h.get("total_batches"),
                    last_updated=h.get("last_updated", ""),
                    error=h.get("error"),
                ))
            except Exception:
                pass

        from .config import verify_data_files
        return PipelineStatus(
            current_checkpoint=current_checkpoint,
            run_history=history,
            data_files=verify_data_files(),
        )

    def get_health_info(self) -> Dict[str, Any]:
        """Get health check information."""
        seen_jobs = self.load_seen_jobs()
        app_stable_ids = self.get_application_stable_ids()

        state_counts = {}
        active_count = 0
        stale_count = 0
        blocked_count = 0

        for job in seen_jobs.values():
            state = job.get("processing_state", "UNKNOWN")
            state_counts[state] = state_counts.get(state, 0) + 1

            if state in ACTIVE_POOL_STATES:
                is_active = self._is_active_pool(job, app_stable_ids)
                if is_active:
                    active_count += 1
                else:
                    stale_count += 1
                if job.get("blocked_reason") == "http_403":
                    blocked_count += 1

        pipeline_status = self.get_pipeline_status()
        current_stage = None
        current_status = None
        if pipeline_status.current_checkpoint:
            current_stage = pipeline_status.current_checkpoint.stage.value
            current_status = pipeline_status.current_checkpoint.stage_status.value

        return {
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data_files": {
                "canonical_jobs": CANONICAL_JOBS_FILE.exists(),
                "seen_jobs": SEEN_JOBS_FILE.exists(),
                "ranked_jobs": RANKED_JOBS_FILE.exists(),
                "checkpoints": CHECKPOINTS_FILE.exists(),
                "tracker": TRACKER_FILE.exists(),
            },
            "pipeline_stage": current_stage,
            "pipeline_status": current_status,
            "active_jobs_count": active_count,
            "stale_jobs_count": stale_count,
            "blocked_jobs_count": blocked_count,
            "state_distribution": state_counts,
        }

    def invalidate_cache(self):
        """Invalidate all caches."""
        with self._lock:
            self._canonical_jobs = None
            self._seen_jobs = None
            self._ranked_jobs = None
            self._checkpoints = None
            self._applications = None
            self._application_stable_ids = None


# Global store instance
_store_instance: Optional[DataStore] = None


def get_store() -> DataStore:
    """Get or create the global data store instance."""
    global _store_instance
    if _store_instance is None:
        _store_instance = DataStore()
    return _store_instance


def invalidate_store_cache():
    """Invalidate the global store cache."""
    global _store_instance
    if _store_instance:
        _store_instance.invalidate_cache()
