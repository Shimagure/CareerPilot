"""Demo mode router for CareerPilot API - internal demo admin/bootstrap endpoints (authenticated)."""
from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, List

from ..demo_store import get_demo_store, invalidate_demo_store_cache
from ..models.schemas import (
    JobSummary,
    JobRecord,
    PipelineStatus,
)
from .auth import get_current_user
from ..models.database_models import User

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.get("/status")
def demo_status() -> Dict[str, Any]:
    """Get demo mode status and health info (unauthenticated for demo plane access)."""
    demo_store = get_demo_store()
    return demo_store.get_health_info()


@router.get("/jobs/active", response_model=List[JobSummary])
def demo_get_active_jobs() -> List[JobSummary]:
    """Get all active demo jobs with retention status (unauthenticated for demo plane access)."""
    demo_store = get_demo_store()
    return demo_store.get_active_jobs()


@router.get("/jobs/{stable_id}", response_model=JobRecord)
def demo_get_job(stable_id: str) -> JobRecord:
    """Get full demo job record by stable_id (unauthenticated for demo plane access)."""
    demo_store = get_demo_store()
    job = demo_store.get_job_by_stable_id(stable_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/pipeline", response_model=PipelineStatus)
def demo_get_pipeline_status() -> PipelineStatus:
    """Get demo pipeline status from checkpoints (unauthenticated for demo plane access)."""
    demo_store = get_demo_store()
    return demo_store.get_pipeline_status()


@router.post("/bootstrap")
def demo_bootstrap(current_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Bootstrap demo data - re-initialize demo store from demo_data files.
    This simulates a fresh pipeline run with the demo dataset.
    Requires authentication.
    """
    invalidate_demo_store_cache()
    demo_store = get_demo_store()

    # Force reload all data
    active_jobs = demo_store.get_active_jobs()
    health = demo_store.get_health_info()
    pipeline = demo_store.get_pipeline_status()

    return {
        "status": "success",
        "message": "Demo data bootstrapped successfully",
        "active_jobs_count": len(active_jobs),
        "health": health,
        "pipeline": {
            "current_stage": pipeline.current_checkpoint.stage.value if pipeline.current_checkpoint else None,
            "run_history_count": len(pipeline.run_history),
        },
    }


@router.post("/reset")
def demo_reset(current_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Reset demo mode - clear demo caches and reload fresh from demo_data.
    Does NOT clear production store (structural boundary).
    Requires authentication.
    """
    invalidate_demo_store_cache()
    # Note: invalidate_store_cache() REMOVED - demo plane must not touch real store

    demo_store = get_demo_store()
    active_jobs = demo_store.get_active_jobs()
    health = demo_store.get_health_info()

    return {
        "status": "success",
        "message": "Demo mode reset successfully",
        "active_jobs_count": len(active_jobs),
        "health": health,
    }


@router.get("/retention")
def demo_retention_stats() -> Dict[str, Any]:
    """Get demo retention/stale-job statistics (unauthenticated for demo plane access)."""
    demo_store = get_demo_store()
    seen_jobs = demo_store.load_seen_jobs()
    app_stable_ids = demo_store.get_application_stable_ids()

    # Compute stats matching retention.js logic
    from ..config import STALE_JOB_DAYS, ACTIVE_POOL_STATES
    from datetime import datetime, timezone

    state_counts = {}
    active_pool_count = 0
    stale_count = 0
    protected_count = 0
    blocked_count = 0
    total_seen = len(seen_jobs)

    for job in seen_jobs.values():
        state = job.get("processing_state", "UNKNOWN")
        state_counts[state] = state_counts.get(state, 0) + 1

        if state in ACTIVE_POOL_STATES:
            last_active = job.get("last_active_at") or job.get("last_verified") or job.get("blocked_at") or job.get("first_seen")
            if last_active:
                try:
                    last_active_dt = datetime.fromisoformat(last_active.replace("Z", "+00:00"))
                    now = datetime.now(timezone.utc)
                    diff_days = (now - last_active_dt).total_seconds() / 86400

                    if diff_days <= STALE_JOB_DAYS:
                        active_pool_count += 1
                    else:
                        # Check application protection
                        if job.get("stable_id") in app_stable_ids:
                            active_pool_count += 1
                            protected_count += 1
                        else:
                            stale_count += 1
                except Exception:
                    pass

            if job.get("blocked_reason") == "http_403":
                blocked_count += 1

    # Compute portal breakdown
    portal_counts = {}
    portal_active = {}
    for job in seen_jobs.values():
        portal = job.get("portal", "unknown")
        state = job.get("processing_state", "UNKNOWN")
        if state in ACTIVE_POOL_STATES:
            portal_active[portal] = portal_active.get(portal, 0) + 1
        portal_counts[portal] = portal_counts.get(portal, 0) + 1

    portal_breakdown = []
    for portal in sorted(portal_counts.keys()):
        portal_breakdown.append({
            "portal": portal,
            "total": portal_counts[portal],
            "active": portal_active.get(portal, 0),
            "stale": portal_counts[portal] - portal_active.get(portal, 0),
        })

    # Checkpoint stats
    checkpoints = demo_store.load_checkpoints()
    run_history = checkpoints.get("run_history", [])
    last_run = checkpoints.get("current_checkpoint") or (run_history[-1] if run_history else None)

    return {
        "retention_policy_days": STALE_JOB_DAYS,
        "active_pool_states": list(ACTIVE_POOL_STATES),
        "total_seen": total_seen,
        "active_pool_count": active_pool_count,
        "stale_count": stale_count,
        "application_protected_count": protected_count,
        "blocked_count": blocked_count,
        "state_breakdown": [
            {"state": state, "count": count} for state, count in sorted(state_counts.items())
        ],
        "portal_breakdown": portal_breakdown,
        "checkpoints": {
            "total_runs": len(run_history),
            "last_run": last_run,
        },
    }


