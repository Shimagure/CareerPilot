"""Jobs router - list and detail endpoints (PRIVATE: requires authentication)."""
from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional, List

from ..store import get_store, DataStore
from ..models.schemas import JobSummary, JobRecord, JobListResponse, ProcessingState, WorkArrangement, FitLevel
from .auth import get_current_user
from ..models.database_models import User

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("", response_model=JobListResponse)
def list_jobs(
    state: Optional[ProcessingState] = Query(None, description="Filter by processing state"),
    arrangement: Optional[WorkArrangement] = Query(None, description="Filter by work arrangement"),
    fit: Optional[FitLevel] = Query(None, description="Filter by fit level"),
    active_only: bool = Query(True, description="Only show jobs in active pool (28-day window or application protected)"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: User = Depends(get_current_user),
    store: DataStore = Depends(get_store),
):
    """List jobs with filtering and pagination (authenticated)."""
    all_jobs = store.get_active_jobs()

    # Apply filters
    if state:
        all_jobs = [j for j in all_jobs if j.processing_state == state]
    if arrangement:
        all_jobs = [j for j in all_jobs if j.arrangement == arrangement]
    if fit:
        all_jobs = [j for j in all_jobs if j.fit == fit]
    if not active_only:
        # Get all jobs from seen_jobs (not just active pool)
        seen = store.load_seen_jobs()
        all_stable_ids = {j.stable_id for j in all_jobs}
        for sid, job in seen.items():
            if sid not in all_stable_ids:
                st_str = job.get("processing_state", "UNKNOWN")
                try:
                    ps = ProcessingState(st_str)
                except ValueError:
                    ps = ProcessingState.UNKNOWN
                # Skip if not in active states at all
                if ps not in [ProcessingState.ACTIVE_VERIFIED, ProcessingState.ACTIVE_UNVERIFIED,
                              ProcessingState.CHANGED, ProcessingState.POSTING_CHANGED,
                              ProcessingState.STALE, ProcessingState.NEEDS_VERIFICATION]:
                    continue
                all_jobs.append(JobSummary(
                    stable_id=sid,
                    title=job.get("title", ""),
                    company=job.get("company", ""),
                    location=job.get("location"),
                    arrangement=WorkArrangement(job.get("arrangement") or "unspecified"),
                    salary=job.get("salary"),
                    portal=job.get("portal"),
                    processing_state=ps,
                    rank_score=job.get("rank_score"),
                    rank_verdict=job.get("rank_verdict"),
                    fit=FitLevel(job.get("fit") or "unknown"),
                    is_active_pool=False,
                    is_application_protected=False,
                ))

    # Sort by rank_score desc
    all_jobs.sort(key=lambda j: -(j.rank_score or 0))

    total = len(all_jobs)
    start = (page - 1) * page_size
    end = start + page_size
    jobs = all_jobs[start:end]

    return JobListResponse(
        jobs=jobs,
        total=total,
        page=page,
        page_size=page_size,
        filters={
            "state": state.value if state else None,
            "arrangement": arrangement.value if arrangement else None,
            "fit": fit.value if fit else None,
            "active_only": active_only,
        }
    )


@router.get("/{stable_id}", response_model=JobRecord)
def get_job(
    stable_id: str,
    current_user: User = Depends(get_current_user),
    store: DataStore = Depends(get_store)
):
    """Get full job detail by stable_id (authenticated)."""
    job = store.get_job_by_stable_id(stable_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job with stable_id {stable_id} not found")
    return job