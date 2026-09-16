"""Applications router - user-scoped application tracking (Checkpoint 12).

The web application tracker is backed by the existing ``Application`` model:
one row per (user, job_stable_id), with company/role snapshotted from the
global dataset at creation time. Identity is always derived from the JWT; the
client can never influence whose rows are read or written.

This replaces the previous CSV-backed router. The CSV tracker
(``job_search_tracker.csv``) remains the CLI's operating tracker and is never
written by this router, so application rows here are the web app's own source
of truth.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_project_root, get_settings
from app.database import get_db_session
from app.models.application_schemas import ApplicationCreate, ApplicationDetail, ApplicationUpdate
from app.models.database_models import Application, ApplicationStatus, CandidateProfile, User
from app.models.schemas import JobRecord
from app.rate_limit import (
    DOCGEN_GUARD,
    RateLimitExceeded,
    check_rate_limit,
    rate_limit_http_429,
)
from app.routers.auth import get_current_user
from app.store import DataStore, get_store

router = APIRouter(prefix="/api/applications", tags=["applications"])

# Statuses that end an application's lifecycle. Once reached, a new application
# for the same (user, job) may be created.
TERMINAL_STATUSES = frozenset({ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED, ApplicationStatus.WITHDRAWN})
# Statuses that indicate the employer (or pipeline) has responded.
RESPONSE_STATUSES = frozenset({
    ApplicationStatus.UNDER_REVIEW,
    ApplicationStatus.INTERVIEW,
    ApplicationStatus.OFFER,
    ApplicationStatus.REJECTED,
    ApplicationStatus.ACCEPTED,
})

_STATUS_MAP = {s.value: s for s in ApplicationStatus}


async def limit_docgen_generate(current_user: User = Depends(get_current_user)) -> None:
    """Rate-limit document generation per authenticated user.

    Keyed by the user id (JWT sub), not by any client-controlled identifier,
    so changing IP/headers cannot bypass the limit.
    """
    try:
        check_rate_limit("docgen.generate", str(current_user.id))
    except RateLimitExceeded as exc:
        raise rate_limit_http_429(exc)


def _parse_status(value: str) -> ApplicationStatus:
    enum = _STATUS_MAP.get(value)
    if enum is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid application status: {value!r}",
        )
    return enum


def _build_detail(app: Application, store: DataStore) -> ApplicationDetail:
    """Honestly assemble the API record from the DB row + global job data.

    ``company``/``role`` come from the row itself (snapshotted at creation);
    ``job`` is only attached when the job still exists in the global dataset.
    """
    job = store.get_job_by_stable_id(app.job_stable_id)
    return ApplicationDetail(
        id=app.id,
        job_stable_id=app.job_stable_id,
        status=app.status.value,
        company=app.company,
        role=app.role,
        role_type=app.role_type,
        sector=app.sector,
        channel=app.channel,
        contact_person=app.contact_person,
        fit_rating=app.fit_rating,
        notes=app.notes,
        cv_file=app.cv_file,
        cover_letter_file=app.cover_letter_file,
        source=app.source,
        applied_at=app.applied_at,
        responded_at=app.responded_at,
        interview_at=app.interview_at,
        decided_at=app.decided_at,
        created_at=app.created_at,
        updated_at=app.updated_at,
        available=job is not None,
        job=job,
    )


async def _get_owned(session: AsyncSession, user_id: str, app_id: str) -> Application:
    """Fetch an application row owned by the user, or 404.

    A row that exists but belongs to another user is reported as not found so
    resource existence is never leaked.
    """
    result = await session.execute(
        select(Application).where(Application.id == app_id, Application.user_id == user_id)
    )
    app = result.scalar_one_or_none()
    if app is None:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


@router.get("", response_model=list[ApplicationDetail])
async def list_applications(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    store: DataStore = Depends(get_store),
) -> list[ApplicationDetail]:
    """List the authenticated user's applications, most recently updated first."""
    result = await session.execute(
        select(Application)
        .where(Application.user_id == current_user.id)
        .order_by(Application.updated_at.desc())
    )
    rows = result.scalars().all()
    return [_build_detail(a, store) for a in rows]


@router.post("", response_model=ApplicationDetail, status_code=status.HTTP_201_CREATED)
async def create_application(
    payload: ApplicationCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    store: DataStore = Depends(get_store),
) -> ApplicationDetail:
    """Create an application for a job in the current global dataset.

    Company/role are derived from the dataset (not client input). Returns 404
    if the job is not in the dataset and 409 if an open application already
    exists for the (user, job); after a terminal status a new application is
    allowed.
    """
    requested_status = _parse_status(payload.status or "draft")
    job: JobRecord | None = store.get_job_by_stable_id(payload.stable_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found in the current job dataset.",
        )

    # Reject a second open application for the same (user, job).
    result = await session.execute(
        select(Application).where(
            Application.user_id == current_user.id,
            Application.job_stable_id == payload.stable_id,
        )
    )
    existing_rows = result.scalars().all()
    for existing in existing_rows:
        if existing.status not in TERMINAL_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"An open application already exists for this job (status: {existing.status.value})",
            )

    now = datetime.now(timezone.utc)
    app = Application(
        user_id=current_user.id,
        job_stable_id=payload.stable_id,
        status=requested_status,
        company=job.company,
        role=job.title,
        role_type=payload.role_type,
        sector=payload.sector,
        channel=payload.channel,
        fit_rating=payload.fit_rating,
        notes=payload.notes,
        source=payload.source,
        applied_at=now if requested_status == ApplicationStatus.SUBMITTED else None,
    )
    session.add(app)
    await session.commit()
    await session.refresh(app)
    return _build_detail(app, store)


@router.get("/{app_id}", response_model=ApplicationDetail)
async def get_application(
    app_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    store: DataStore = Depends(get_store),
) -> ApplicationDetail:
    """Get one of the authenticated user's applications by id."""
    app = await _get_owned(session, str(current_user.id), app_id)
    return _build_detail(app, store)


@router.patch("/{app_id}", response_model=ApplicationDetail)
async def update_application(
    app_id: str,
    payload: ApplicationUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    store: DataStore = Depends(get_store),
) -> ApplicationDetail:
    """Update an application (user-scoped) and advance its honest timeline.

    Timeline timestamps are set on status transitions (never overwritten once
    recorded): ``applied_at`` when the application is marked submitted,
    ``responded_at`` on the first employer/response signal, ``interview_at``
    when interviewing, ``decided_at`` when the lifecycle reaches a terminal
    status.
    """
    app = await _get_owned(session, str(current_user.id), app_id)

    if payload.status is not None:
        new_status = _parse_status(payload.status)
        now = datetime.now(timezone.utc)
        if new_status == ApplicationStatus.SUBMITTED and app.applied_at is None:
            app.applied_at = now
        if new_status in RESPONSE_STATUSES and app.responded_at is None:
            app.responded_at = now
        if new_status == ApplicationStatus.INTERVIEW and app.interview_at is None:
            app.interview_at = now
        if new_status in TERMINAL_STATUSES and app.decided_at is None:
            app.decided_at = now
        app.status = new_status

    if payload.fit_rating is not None:
        app.fit_rating = payload.fit_rating
    if payload.sector is not None:
        app.sector = payload.sector
    if payload.role_type is not None:
        app.role_type = payload.role_type
    if payload.channel is not None:
        app.channel = payload.channel
    if payload.contact_person is not None:
        app.contact_person = payload.contact_person
    if payload.source is not None:
        app.source = payload.source
    if payload.notes is not None:
        app.notes = payload.notes

    await session.commit()
    await session.refresh(app)
    return _build_detail(app, store)


@router.delete("/{app_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_application(
    app_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    """Delete one of the authenticated user's applications.

    Idempotent in effect only for owned rows: deleting a non-owned or unknown
    application returns 404 and never touches another user's rows. It does not
    modify the user's saved-job state or the CSV tracker.
    """
    app = await _get_owned(session, str(current_user.id), app_id)
    await session.delete(app)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/with-documents", response_model=ApplicationDetail, status_code=status.HTTP_201_CREATED)
async def create_application_with_documents(
    payload: ApplicationCreate,
    generate_cv: bool = True,
    generate_cover_letter: bool = True,
    _docgen_limit: None = Depends(limit_docgen_generate),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    store: DataStore = Depends(get_store),
) -> ApplicationDetail:
    """Create an application with generated CV and cover letter documents.

    Integrates the Application Assistant (CP13B) to generate tailored documents
    from the user's verified CandidateProfile. Enforces CANDIDATE_TRUTH.md
    Level 1/2 factual boundary - only uses verified profile data, never invents
    candidate facts, skills, or experience.

    Returns 404 if the job is not in the dataset, 409 if an open application
    already exists, or 422 if the user has no candidate profile.
    """
    from app.services import application_assistant

    # Fetch the user's candidate profile
    profile_result = await session.execute(
        select(CandidateProfile).where(CandidateProfile.user_id == current_user.id)
    )
    profile_model = profile_result.scalar_one_or_none()
    if profile_model is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No candidate profile found. Please create a profile before generating application documents.",
        )

    # Convert database model to response schema (the previous import of
    # _build_profile_response did not exist and 500'd every request).
    from app.routers.profile import _profile_to_response
    profile = _profile_to_response(profile_model, None)

    # Get job details for document generation
    job: JobRecord | None = store.get_job_by_stable_id(payload.stable_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found in the current job dataset.",
        )

    # Generate application documents.
    # Concurrency guard (P3.1): a user may only have one in-flight generation at
    # a time, so a burst cannot pile up parallel LaTeX compiles. Released on
    # every exit path via finally.
    user_key = str(current_user.id)
    if not DOCGEN_GUARD.acquire(user_key):
        raise rate_limit_http_429(
            RateLimitExceeded(get_settings().docgen_concurrency_retry_after_seconds),
            detail="Another document generation is already in progress. Please wait and retry.",
        )
    try:
        docs = await application_assistant.generate_application_documents(
            profile=profile,
            job_title=job.title,
            company=job.company,
            generate_cv=generate_cv,
            generate_cover=generate_cover_letter,
            job_stable_id=payload.stable_id,
        )
    finally:
        DOCGEN_GUARD.release(user_key)

    # Check for generation errors
    errors = []
    if generate_cv and not docs.cv_success:
        errors.append(f"CV generation failed: {docs.cv_error}")
    if generate_cover_letter and not docs.cover_letter_success:
        errors.append(f"Cover letter generation failed: {docs.cover_letter_error}")

    if errors:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Document generation failed: {'; '.join(errors)}",
        )

    # Create the application record with document paths
    requested_status = _parse_status(payload.status or "draft")

    # Check for existing open applications
    result = await session.execute(
        select(Application).where(
            Application.user_id == current_user.id,
            Application.job_stable_id == payload.stable_id,
        )
    )
    existing_rows = result.scalars().all()
    for existing in existing_rows:
        if existing.status not in TERMINAL_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"An open application already exists for this job (status: {existing.status.value})",
            )

    now = datetime.now(timezone.utc)
    app = Application(
        user_id=current_user.id,
        job_stable_id=payload.stable_id,
        status=requested_status,
        company=job.company,
        role=job.title,
        role_type=payload.role_type,
        sector=payload.sector,
        channel=payload.channel,
        fit_rating=payload.fit_rating,
        notes=payload.notes,
        source=payload.source,
        cv_file=str(docs.cv_path.relative_to(get_project_root())) if docs.cv_path else None,
        cover_letter_file=str(docs.cover_letter_path.relative_to(get_project_root())) if docs.cover_letter_path else None,
        applied_at=now if requested_status == ApplicationStatus.SUBMITTED else None,
    )
    session.add(app)
    await session.commit()
    await session.refresh(app)
    return _build_detail(app, store)


# Document kinds that may be streamed back for an owned application.
_DOCUMENT_KIND_FIELD = {
    "cv": "cv_file",
    "cover_letter": "cover_letter_file",
}


@router.get("/{app_id}/documents/{doc_kind}")
async def download_application_document(
    app_id: str,
    doc_kind: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    """Stream a generated CV or cover letter PDF for one of the user's applications.

    The stored ``cv_file``/``cover_letter_file`` values are server-written
    relative paths (never client input); this endpoint still re-checks ownership
    (mirroring resume download), rejects unknown kinds, and refuses any stored
    path that resolves outside the generated-documents directory so a hostile
    or corrupted DB row can never become an arbitrary file read.
    """
    field = _DOCUMENT_KIND_FIELD.get(doc_kind)
    if field is None or doc_kind not in ("cv", "cover_letter"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown document type")

    app = await _get_owned(session, str(current_user.id), app_id)
    stored = getattr(app, field)
    if not stored:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No {doc_kind} document exists for this application.",
        )

    relative = Path(stored)
    if relative.is_absolute():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document path invalid")

    generated_dir = (get_project_root() / "data" / "generated").resolve()
    candidate = (get_project_root() / relative).resolve()
    # is_relative_to is the traversal guard: a stored path escaping data/generated
    # (e.g. `../../secret`) is refused even though the path is never client-supplied.
    if not candidate.is_relative_to(generated_dir):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document path invalid")
    if not candidate.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found on disk")

    return FileResponse(
        candidate,
        media_type="application/pdf",
        filename=candidate.name,
        content_disposition_type="attachment",
    )