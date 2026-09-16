"""Profile router: GET, PUT, and resume-based extraction (review-only, no persistence)."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db_session
from app.models.database_models import CandidateProfile, Resume, User
from app.models.profile_schemas import (
    CandidateProfileResponse,
    ProfileExtractResponse,
    ProfileGetResponse,
    ProfileUpdateRequest,
)
from app.profile_extraction import build_profile_draft
from app.routers.auth import get_current_user
from app.routers.resume import _get_active_resume, get_resume_storage
from app.storage import ResumeStorage

router = APIRouter(prefix="/api/profile", tags=["profile"])


def _serialize_json_field(value: Any) -> list[dict[str, Any]]:
    """Normalize a JSON column (Text with JSON content) into a list of dicts.

    Legacy/hand-crafted data may be a list of strings or dicts without 'source'.
    This converts everything to dicts with a default 'source' of 'user_verified'.
    """
    if not value:
        return []
    # Handle JSON string from database
    if isinstance(value, str):
        try:
            import json
            value = json.loads(value)
        except Exception:
            return []
    if isinstance(value, list):
        result = []
        for item in value:
            if isinstance(item, dict):
                if "source" not in item:
                    item = {**item, "source": "user_verified"}
                result.append(item)
            elif isinstance(item, str):
                result.append({"name": item, "source": "user_verified"})
        return result
    return []


def _profile_to_response(profile: CandidateProfile, resume_filename: str | None) -> CandidateProfileResponse:
    """Convert ORM CandidateProfile to response schema."""
    return CandidateProfileResponse(
        id=str(profile.id),
        full_name=profile.full_name,
        headline=profile.headline,
        location=profile.location,
        phone=profile.phone,
        email=profile.email,
        linkedin_url=profile.linkedin_url,
        portfolio_url=profile.portfolio_url,
        professional_summary=profile.professional_summary,
        skills=_serialize_json_field(profile.skills),
        experience=_serialize_json_field(profile.experience),
        education=_serialize_json_field(profile.education),
        certifications=_serialize_json_field(profile.certifications),
        languages=_serialize_json_field(profile.languages),
        projects=_serialize_json_field(profile.projects),
        source_resume_id=profile.source_resume_id,
        source_resume_filename=resume_filename,
        manually_edited=profile.manually_edited,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


@router.get("", response_model=ProfileGetResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> ProfileGetResponse:
    """Return the authenticated user's candidate profile (or null) and resume availability."""
    # Active resume
    resume = await _get_active_resume(session, current_user.id)

    # Candidate profile
    result = await session.execute(
        select(CandidateProfile).where(CandidateProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()

    return ProfileGetResponse(
        profile=_profile_to_response(profile, resume.original_filename if resume else None) if profile else None,
        has_active_resume=resume is not None,
    )


@router.put("", response_model=CandidateProfileResponse, status_code=status.HTTP_200_OK)
async def update_profile(
    payload: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> CandidateProfileResponse:
    """Sparse update: only provided fields are changed. Empty body -> 400."""
    # Require at least one field
    if not payload.model_dump(exclude_unset=True):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field must be provided.",
        )

    # Validate source_resume_id ownership if provided
    if payload.source_resume_id is not None:
        resume = await session.get(Resume, payload.source_resume_id)
        if not resume or resume.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Referenced resume not found.",
            )

    # Load or create profile
    result = await session.execute(
        select(CandidateProfile).where(CandidateProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()

    if profile is None:
        profile = CandidateProfile(user_id=current_user.id)
        session.add(profile)

    import json

    # Apply sparse updates
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field == "source_resume_id":
            setattr(profile, field, value)
        elif field in {"skills", "experience", "education", "certifications", "languages", "projects"}:
            # Serialize Pydantic models to plain dicts for JSON storage
            # model_dump(exclude_unset=True) returns dicts, so handle both cases
            if value:
                serialized = []
                for item in value:
                    if hasattr(item, "model_dump"):
                        serialized.append(item.model_dump())
                    else:
                        serialized.append(item)
                setattr(profile, field, json.dumps(serialized))
            else:
                setattr(profile, field, json.dumps([]))
        else:
            setattr(profile, field, value)

    profile.manually_edited = True
    await session.commit()
    await session.refresh(profile)

    resume = await _get_active_resume(session, current_user.id)
    return _profile_to_response(profile, resume.original_filename if resume else None)


@router.post("/extract", response_model=ProfileExtractResponse)
async def extract_profile_from_resume(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> ProfileExtractResponse:
    """Extract a reviewable draft from the user's active resume.

    Does NOT persist anything. Returns a draft with provenance 'resume_extracted'
    that the user can review, edit, and then explicitly save via PUT /api/profile.
    """
    resume = await _get_active_resume(session, current_user.id)
    if not resume:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active resume to extract from. Upload a resume first.",
        )

    # Read the resume file from storage
    storage: ResumeStorage = get_resume_storage()
    try:
        file_bytes = await storage.read(current_user.id, resume.storage_key)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resume file not found on disk.",
        )

    # Determine type from filename extension
    filename = resume.original_filename.lower()
    kind = "pdf" if filename.endswith(".pdf") else "docx"

    # Build draft (never raises; returns warning on failure)
    draft, warning = build_profile_draft(file_bytes, kind)

    # Attach source resume id to the draft for traceability
    draft["source_resume_id"] = str(resume.id)

    # Wrap in response model
    draft_response = CandidateProfileResponse(**draft)
    return ProfileExtractResponse(
        resume_id=str(resume.id),
        resume_filename=resume.original_filename,
        has_text=warning is None,
        warning=warning,
        draft=draft_response,
    )