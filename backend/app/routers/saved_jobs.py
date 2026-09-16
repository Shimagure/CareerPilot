"""Saved Jobs router - authenticated, user-scoped bookmarks (Checkpoint 11).

Reuses the existing UserJob persistence model: one row per (user, job) whose
status distinguishes personal job state. We only read/write status == SAVED.
Unsave deletes only the Saved row owned by the current user and never touches
Application or CSV tracker records, so application history is preserved.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.models.database_models import User, UserJob, UserJobStatus
from app.models.saved_jobs_schemas import SavedJobItem
from app.routers.auth import get_current_user
from app.store import DataStore, get_store

router = APIRouter(prefix="/api/saved-jobs", tags=["saved-jobs"])


def _build_item(uj: UserJob, store: DataStore) -> SavedJobItem:
    """Honestly assemble a saved item from the persistent row + global job data.

    If the job is gone from the global dataset, ``available`` is False and no
    job fields are fabricated.
    """
    job = store.get_job_by_stable_id(uj.job_stable_id)
    return SavedJobItem(
        stable_id=uj.job_stable_id,
        saved_at=uj.created_at,
        available=job is not None,
        job=job,
    )


async def _find_saved(session: AsyncSession, user_id: str, stable_id: str) -> UserJob | None:
    result = await session.execute(
        select(UserJob).where(
            UserJob.user_id == user_id,
            UserJob.job_stable_id == stable_id,
        )
    )
    return result.scalar_one_or_none()


@router.get("", response_model=list[SavedJobItem])
async def list_saved_jobs(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    store: DataStore = Depends(get_store),
) -> list[SavedJobItem]:
    """List the authenticated user's saved jobs, most recently saved first.

    Ownership is derived from the JWT; another user's rows are never returned.
    """
    result = await session.execute(
        select(UserJob)
        .where(
            UserJob.user_id == current_user.id,
            UserJob.status == UserJobStatus.SAVED,
        )
        .order_by(UserJob.created_at.desc())
    )
    rows = result.scalars().all()
    return [_build_item(uj, store) for uj in rows]


@router.post("/{stable_id}", response_model=SavedJobItem, status_code=status.HTTP_200_OK)
async def save_job(
    stable_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    store: DataStore = Depends(get_store),
) -> SavedJobItem:
    """Save a job for the authenticated user (idempotent upsert).

    Saving an already-saved job simply returns the existing saved item. We only
    save jobs that exist in the current global dataset so a saved list never
    references an unknown stable_id.
    """
    if store.get_job_by_stable_id(stable_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found in the current job dataset.",
        )

    uj = await _find_saved(session, str(current_user.id), stable_id)
    if uj is None:
        uj = UserJob(
            user_id=current_user.id,
            job_stable_id=stable_id,
            status=UserJobStatus.SAVED,
        )
        session.add(uj)
    else:
        uj.status = UserJobStatus.SAVED

    try:
        await session.commit()
        await session.refresh(uj)
    except IntegrityError:
        # Concurrent save for the same (user, job): row now exists.
        await session.rollback()
        uj = await _find_saved(session, str(current_user.id), stable_id)
        uj.status = UserJobStatus.SAVED
        await session.commit()
        await session.refresh(uj)

    return _build_item(uj, store)


@router.delete("/{stable_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unsave_job(
    stable_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    """Remove the authenticated user's saved state for a job.

    Idempotent: unsaving a job that is not saved is a no-op. Scope is strictly
    the current user's Saved row, so another user's saved state and any
    application/tracker history are never affected.
    """
    result = await session.execute(
        delete(UserJob).where(
            UserJob.user_id == current_user.id,
            UserJob.job_stable_id == stable_id,
            UserJob.status == UserJobStatus.SAVED,
        )
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)