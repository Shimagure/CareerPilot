"""Public demo router - unauthenticated endpoints serving ONLY demo data.

This router is the PUBLIC API surface. It MUST only serve demo-plane data
and MUST never import or reference the real DataStore, real SQLite, or
any personal runtime state.

Endpoints mirror the demo router but are intentionally separate to enforce
the structural boundary: public routes → demo data only.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Dict, Any, List, Optional

from ..demo_store import get_demo_store
from ..models.schemas import (
    JobSummary,
    JobRecord,
    PipelineStatus,
    ApplicationRecord,
)
from ..rate_limit import (
    RateLimitExceeded,
    check_rate_limit,
    get_client_ip,
    rate_limit_http_429,
)


def enforce_public_read_rate_limit(request: Request) -> None:
    """Bound anonymous reads on the public demo plane (P5.1).

    Uses the existing bounded in-process limiter with the ``public.read``
    policy. The client identity follows the same single-proxy trust model as
    the auth limits (see ``rate_limit.get_client_ip``).
    """
    try:
        check_rate_limit("public.read", get_client_ip(request))
    except RateLimitExceeded as exc:
        raise rate_limit_http_429(exc) from exc


router = APIRouter(
    prefix="/api/public",
    tags=["public"],
    dependencies=[Depends(enforce_public_read_rate_limit)],
)


@router.get("/status")
def public_status() -> Dict[str, Any]:
    """Get demo mode status and health info (public)."""
    demo_store = get_demo_store()
    return demo_store.get_health_info()


@router.get("/jobs/active", response_model=List[JobSummary])
def public_get_active_jobs(
    sort: Optional[str] = Query(None, pattern="^(rank_score|evaluated_at|created_at)$"),
    order: Optional[str] = Query("desc", pattern="^(asc|desc)$"),
    limit: Optional[int] = Query(None, ge=1, le=100),
) -> List[JobSummary]:
    """Get all active demo jobs with retention status (public).

    Query parameters:
    - sort: Sort field (rank_score, evaluated_at, created_at)
    - order: Sort order (asc, desc) - default desc
    - limit: Maximum number of results (1-100)
    """
    demo_store = get_demo_store()
    jobs = demo_store.get_active_jobs()

    # Apply sorting if requested
    if sort:
        reverse = order == "desc"
        if sort == "rank_score":
            jobs.sort(key=lambda j: j.rank_score or 0, reverse=reverse)
        elif sort == "evaluated_at":
            jobs.sort(key=lambda j: j.evaluated_at or "", reverse=reverse)
        elif sort == "created_at":
            # created_at not on JobSummary, fall back to first_seen
            pass

    # Apply limit if requested
    if limit is not None:
        jobs = jobs[:limit]

    return jobs


@router.get("/applications", response_model=List[ApplicationRecord])
def public_get_applications() -> List[ApplicationRecord]:
    """Get demo application portfolio (public, read-only)."""
    demo_store = get_demo_store()
    return demo_store.get_demo_applications()


@router.get("/jobs/{stable_id}", response_model=JobRecord)
def public_get_job(stable_id: str) -> JobRecord:
    """Get full demo job record by stable_id (public)."""
    demo_store = get_demo_store()
    job = demo_store.get_job_by_stable_id(stable_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/pipeline", response_model=PipelineStatus)
def public_get_pipeline_status() -> PipelineStatus:
    """Get demo pipeline status from checkpoints (public)."""
    demo_store = get_demo_store()
    return demo_store.get_pipeline_status()


@router.get("/retention")
def public_retention_stats() -> Dict[str, Any]:
    """Get demo retention/stale-job statistics (public)."""
    demo_store = get_demo_store()
    seen_jobs = demo_store.load_seen_jobs()
    app_stable_ids = demo_store.get_application_stable_ids()

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
                        if job.get("stable_id") in app_stable_ids:
                            active_pool_count += 1
                            protected_count += 1
                        else:
                            stale_count += 1
                except Exception:
                    pass

            if job.get("blocked_reason") == "http_403":
                blocked_count += 1

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


@router.get("/health/portals")
def public_portal_health() -> Dict[str, Any]:
    """Get demo portal health status (public)."""
    demo_store = get_demo_store()
    health = demo_store.get_health_info()

    # Return a simplified public-friendly version
    return {
        "status": "ok",
        "timestamp": health.get("timestamp"),
        "active_jobs_count": health.get("active_jobs_count", 0),
        "stale_jobs_count": health.get("stale_jobs_count", 0),
        "blocked_jobs_count": health.get("blocked_jobs_count", 0),
        "state_distribution": health.get("state_distribution", {}),
        "is_demo_mode": True,
    }