"""Pipeline status router (PRIVATE: requires authentication)."""
from fastapi import APIRouter, Depends
from typing import Dict, Any, List
from datetime import datetime, timezone

from ..store import get_store, DataStore
from ..models.schemas import PipelineStatus, PipelineCheckpoint, ProcessingState
from ..config import STALE_JOB_DAYS, ACTIVE_POOL_STATES
from .auth import get_current_user
from ..models.database_models import User

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


@router.get("/status", response_model=PipelineStatus)
def get_pipeline_status(
    current_user: User = Depends(get_current_user),
    store: DataStore = Depends(get_store)
):
    """Get pipeline status from checkpoints (authenticated)."""
    return store.get_pipeline_status()


@router.get("/health", response_model=Dict[str, Any])
def get_pipeline_health(
    current_user: User = Depends(get_current_user),
    store: DataStore = Depends(get_store)
):
    """Get comprehensive pipeline health information (authenticated)."""
    # Get health info from store
    health_info = store.get_health_info()

    # Get pipeline status
    pipeline_status = store.get_pipeline_status()

    # Load seen_jobs for detailed portal health analysis
    seen_jobs = store.load_seen_jobs()

    # Portal health analysis
    portal_stats: Dict[str, Dict[str, int]] = {}
    for job in seen_jobs.values():
        portal = job.get("portal", "unknown")
        state = job.get("processing_state", "UNKNOWN")
        blocked = job.get("blocked_reason")

        if portal not in portal_stats:
            portal_stats[portal] = {"total": 0, "active": 0, "blocked": 0, "stale": 0, "closed": 0}

        portal_stats[portal]["total"] += 1

        if state in ["ACTIVE_VERIFIED", "ACTIVE_UNVERIFIED", "NEW", "NEEDS_VERIFICATION", "CHANGED", "POSTING_CHANGED", "STALE"]:
            if job.get("blocked_reason") == "http_403":
                portal_stats[portal]["blocked"] += 1
            elif state == "STALE":
                portal_stats[portal]["stale"] += 1
            else:
                portal_stats[portal]["active"] += 1
        elif state == "CLOSED_OR_EXPIRED":
            portal_stats[portal]["closed"] += 1

    # Stage completion summary from latest run
    current_checkpoint = pipeline_status.current_checkpoint
    latest_complete_stages: List[str] = []
    if current_checkpoint and current_checkpoint.stage_status == "complete":
        # Find all completed stages in this run
        run_id = current_checkpoint.run_id
        for run in pipeline_status.run_history:
            if run.run_id == run_id and run.stage_status == "complete":
                latest_complete_stages.append(run.stage)

    # Determine overall health state
    overall_health = "healthy"
    health_issues: List[str] = []

    if not health_info.get("data_files", {}).get("canonical_jobs", False):
        overall_health = "error"
        health_issues.append("Canonical jobs file missing")

    if not health_info.get("data_files", {}).get("seen_jobs", False):
        overall_health = "error"
        health_issues.append("Seen jobs file missing")

    if not health_info.get("data_files", {}).get("checkpoints", False):
        overall_health = "error"
        health_issues.append("Checkpoints file missing")

    if health_info.get("blocked_jobs_count", 0) > 0:
        if overall_health == "healthy":
            overall_health = "warning"
        health_issues.append(f"{health_info['blocked_jobs_count']} jobs blocked (403)")

    if health_info.get("stale_jobs_count", 0) > 0:
        if overall_health == "healthy":
            overall_health = "warning"
        health_issues.append(f"{health_info['stale_jobs_count']} stale jobs")

    if current_checkpoint and current_checkpoint.stage_status == "failed":
        overall_health = "error"
        health_issues.append(f"Pipeline failed at {current_checkpoint.stage}")

    # Calculate job counts by stage from checkpoint
    stage_counts: Dict[str, int] = {}
    if current_checkpoint:
        stage_counts[current_checkpoint.stage] = current_checkpoint.jobs_processed_in_stage

    # Also aggregate from run history for completed stages
    current_run_id = current_checkpoint.run_id if current_checkpoint else None
    for run in pipeline_status.run_history:
        if current_run_id and run.run_id == current_run_id:
            if run.stage not in stage_counts:
                stage_counts[run.stage] = run.jobs_processed_in_stage

    return {
        "overall_health": overall_health,
        "health_issues": health_issues,
        "timestamp": health_info.get("timestamp"),
        "data_files": health_info.get("data_files"),
        "pipeline_stage": health_info.get("pipeline_stage"),
        "pipeline_status": health_info.get("pipeline_status"),
        "active_jobs_count": health_info.get("active_jobs_count"),
        "stale_jobs_count": health_info.get("stale_jobs_count"),
        "blocked_jobs_count": health_info.get("blocked_jobs_count"),
        "state_distribution": health_info.get("state_distribution", {}),
        "stage_counts": stage_counts,
        "portal_health": portal_stats,
        "current_checkpoint": pipeline_status.current_checkpoint,
        "run_history": pipeline_status.run_history,
        "latest_complete_stages": latest_complete_stages,
    }


@router.get("/retention", response_model=Dict[str, Any])
def get_retention_stats(
    current_user: User = Depends(get_current_user),
    store: DataStore = Depends(get_store)
):
    """Get data retention and stale-job statistics (authenticated)."""
    # Load seen_jobs for analysis
    seen_jobs = store.load_seen_jobs()
    app_stable_ids = store.get_application_stable_ids()

    now = datetime.now(timezone.utc)

    def get_last_active_dt(job: Dict):
        """Get last active datetime with fallback chain."""
        for field in ["last_active_at", "last_verified", "blocked_at", "first_seen"]:
            val = job.get(field)
            if val:
                try:
                    dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                    # Ensure timezone-aware
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    return dt
                except Exception:
                    pass
        return None

    # Compute retention statistics
    total_in_active_states = 0
    active_pool_count = 0
    stale_count = 0
    protected_count = 0

    state_breakdown = {}
    portal_breakdown = {}

    for job in seen_jobs.values():
        state = job.get("processing_state", "UNKNOWN")
        portal = job.get("portal", "unknown")

        # Initialize state breakdown
        if state not in state_breakdown:
            state_breakdown[state] = {
                "total": 0,
                "in_active_pool": 0,
                "stale": 0,
                "protected": 0,
                "has_date": 0,
                "no_date": 0
            }

        # Initialize portal breakdown
        if portal not in portal_breakdown:
            portal_breakdown[portal] = {
                "total": 0,
                "in_active_pool": 0,
                "stale": 0,
                "protected": 0
            }

        state_breakdown[state]["total"] += 1
        portal_breakdown[portal]["total"] += 1

        # Only consider active pool states
        if state in ACTIVE_POOL_STATES:
            total_in_active_states += 1
            last_active_dt = get_last_active_dt(job)
            is_protected = job.get("stable_id") in app_stable_ids

            if last_active_dt:
                state_breakdown[state]["has_date"] += 1
                diff_days = (now - last_active_dt).total_seconds() / 86400

                if diff_days <= STALE_JOB_DAYS:
                    active_pool_count += 1
                    state_breakdown[state]["in_active_pool"] += 1
                    portal_breakdown[portal]["in_active_pool"] += 1
                    if is_protected:
                        protected_count += 1
                        state_breakdown[state]["protected"] += 1
                        portal_breakdown[portal]["protected"] += 1
                else:
                    stale_count += 1
                    state_breakdown[state]["stale"] += 1
                    portal_breakdown[portal]["stale"] += 1
                    if is_protected:
                        protected_count += 1
                        state_breakdown[state]["protected"] += 1
                        portal_breakdown[portal]["protected"] += 1
            else:
                # No date info - treat as stale
                state_breakdown[state]["no_date"] += 1
                stale_count += 1
                state_breakdown[state]["stale"] += 1
                portal_breakdown[portal]["stale"] += 1

    # Sort portal breakdown by total desc
    portal_breakdown_sorted = dict(
        sorted(portal_breakdown.items(), key=lambda x: -x[1]["total"])
    )

    # Sort state breakdown
    state_breakdown_sorted = dict(
        sorted(state_breakdown.items(), key=lambda x: -x[1]["total"])
    )

    # Get retention-related checkpoint info
    pipeline_status = store.get_pipeline_status()
    retention_checkpoints = []
    if pipeline_status.run_history:
        for run in pipeline_status.run_history:
            if run.stage in ["verification", "scoring", "ranking_report"]:
                retention_checkpoints.append({
                    "run_id": run.run_id,
                    "stage": run.stage,
                    "stage_status": run.stage_status,
                    "jobs_processed": run.jobs_processed_in_stage,
                    "total_jobs": run.total_jobs_in_stage,
                    "started_at": run.started_at,
                    "last_updated": run.last_updated,
                    "verified": getattr(run, "verified", None),
                    "blocked": getattr(run, "blocked", None),
                    "changed": getattr(run, "changed", None),
                    "closed": getattr(run, "closed", None),
                })

    return {
        "retention_policy": {
            "stale_job_days": STALE_JOB_DAYS,
            "active_pool_states": list(ACTIVE_POOL_STATES),
            "description": f"Jobs in active states ({', '.join(ACTIVE_POOL_STATES)}) are retained in the active pool for {STALE_JOB_DAYS} days from their last activity (verification, blocked check, or change). Jobs with application history are protected indefinitely.",
            "last_activity_fallback_chain": [
                "last_active_at",
                "last_verified",
                "blocked_at",
                "first_seen"
            ],
            "application_protection": "Jobs linked to application tracker entries are retained regardless of age"
        },
        "summary": {
            "total_jobs_analyzed": len(seen_jobs),
            "total_in_active_states": total_in_active_states,
            "active_pool_count": active_pool_count,
            "stale_count": stale_count,
            "protected_count": protected_count,
            "active_percentage": round((active_pool_count / total_in_active_states * 100) if total_in_active_states > 0 else 0, 1),
            "stale_percentage": round((stale_count / total_in_active_states * 100) if total_in_active_states > 0 else 0, 1),
            "protected_percentage": round((protected_count / total_in_active_states * 100) if total_in_active_states > 0 else 0, 1),
        },
        "state_breakdown": state_breakdown_sorted,
        "portal_breakdown": portal_breakdown_sorted,
        "retention_checkpoints": retention_checkpoints,
        "timestamp": now.isoformat(),
    }