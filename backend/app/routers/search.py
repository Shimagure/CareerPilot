"""Search runs router: authenticated POST/GET for job search execution.

Endpoints:
  POST /api/search           — start a new search run (background, non-blocking)
  GET  /api/search/{run_id}  — get a single search run (must own it)
  GET  /api/search           — list recent search runs (paginated, user-scoped)

Architecture:
  router → SearchRunManager → PipelineAdapter → existing pipeline CLIs
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.models.database_models import SearchRun, User
from app.models.search_schemas import (
    SearchPipelineStage,
    SearchRunListResponse,
    SearchRunResponse,
    SearchRunStatus as SearchRunStatusAPI,
    StartSearchRequest,
)
from app.routers.auth import get_current_user
from app.services.search_manager import get_search_run_manager
from app.rate_limit import raise_if_rate_limited

router = APIRouter(prefix="/api/search", tags=["search"])

MAX_PAGE_LIMIT = 50
DEFAULT_PAGE_LIMIT = 20

_STAGE_VALUES = {s.value for s in SearchPipelineStage}


def _parse_metadata(run: SearchRun) -> dict:
    """Parse run_metadata JSON safely."""
    import json
    if not run.run_metadata:
        return {}
    try:
        return json.loads(run.run_metadata)
    except Exception:
        return {}


def _to_response(run: SearchRun) -> SearchRunResponse:
    """Convert ORM SearchRun to API response. Never exposes secrets/paths."""
    meta = _parse_metadata(run)
    return SearchRunResponse(
        id=str(run.id),
        status=SearchRunStatusAPI(run.status.value),
        started_at=run.started_at,
        completed_at=run.completed_at,
        error=run.error,
        pipeline_stage=(
            SearchPipelineStage(meta["pipeline_stage"])
            if meta.get("pipeline_stage") in _STAGE_VALUES
            else None
        ),
        preference_snapshot=meta.get("preference_snapshot"),
        execution_options=meta.get("execution_options"),
        result_summary=meta.get("result_summary"),
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


@router.post("", response_model=SearchRunResponse, status_code=status.HTTP_201_CREATED)
async def start_search(
    payload: StartSearchRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> SearchRunResponse:
    """Start a new job search run. Returns immediately (background execution).

    Preferences are loaded from the user's saved SearchPreferences row.
    Only runtime execution options are accepted in the request body.
    """
    # Search initiation is throttled per user (JWT sub). Enforced here, after
    # body validation, so malformed requests (422) never consume a slot — only
    # valid requests that actually reach the expensive pipeline are counted.
    raise_if_rate_limited("search.start", str(current_user.id))

    manager = get_search_run_manager()
    try:
        run = await manager.start_run(
            session=session,
            user=current_user,
            dry_run=payload.dry_run,
            search_keywords=payload.search_keywords,
            search_location=payload.search_location,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )

    return _to_response(run)


@router.get("/{run_id}", response_model=SearchRunResponse)
async def get_search_run(
    run_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> SearchRunResponse:
    """Get a single search run by ID. Must belong to the authenticated user."""
    result = await session.execute(
        select(SearchRun).where(
            SearchRun.id == run_id,
            SearchRun.user_id == current_user.id,
        )
    )
    run = result.scalar_one_or_none()
    if run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Search run not found.",
        )
    return _to_response(run)


@router.get("", response_model=SearchRunListResponse)
async def list_search_runs(
    limit: int = Query(default=DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> SearchRunListResponse:
    """List the authenticated user's recent search runs (newest first)."""
    # Total count
    count_result = await session.execute(
        select(func.count()).select_from(SearchRun).where(
            SearchRun.user_id == current_user.id
        )
    )
    total = count_result.scalar() or 0

    # Page of runs
    result = await session.execute(
        select(SearchRun)
        .where(SearchRun.user_id == current_user.id)
        .order_by(SearchRun.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    runs = [_to_response(r) for r in result.scalars().all()]

    return SearchRunListResponse(
        runs=runs,
        total=total,
        limit=limit,
        offset=offset,
    )
