"""Search preferences router: authenticated GET/PUT of the user's job-search intent.

Preferences describe what the user WANTS. They are only ever written from the
user's explicit request body — never inferred from resumes, profiles, or jobs.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.models.database_models import SearchPreferences, User
from app.models.preferences_schemas import (
    PreferencesGetResponse,
    SearchPreferencesResponse,
    SearchPreferencesUpdateRequest,
    arrangements_from_bools,
    search_preferences_configured,
)
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


def _load_json_list(value: Any) -> list:
    """Read a JSON-as-Text column safely into a list (tolerant of legacy shapes)."""
    if not value:
        return []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return []
        return parsed if isinstance(parsed, list) else []
    return value if isinstance(value, list) else []


def _to_response(pref: SearchPreferences) -> SearchPreferencesResponse:
    """Convert the ORM row to the API response (arrangements derived from bool flags)."""
    arrangements = arrangements_from_bools(pref.remote_ok, pref.hybrid_ok, pref.onsite_ok)
    return SearchPreferencesResponse(
        id=str(pref.id),
        target_roles=_load_json_list(pref.target_roles),
        excluded_keywords=_load_json_list(pref.excluded_keywords),
        preferred_locations=_load_json_list(pref.preferred_locations),
        ncr_only=pref.ncr_only,
        work_arrangements=arrangements,
        salary_min=pref.salary_min,
        salary_max=pref.salary_max,
        salary_currency=pref.salary_currency or "PHP",
        salary_period=pref.salary_period or "monthly",
        day_shift_ok=pref.day_shift_ok,
        night_shift_ok=pref.night_shift_ok,
        rotational_ok=pref.rotational_ok,
        career_direction=pref.career_direction,
        configured=search_preferences_configured(
            target_roles=_load_json_list(pref.target_roles),
            preferred_locations=_load_json_list(pref.preferred_locations),
            excluded_keywords=_load_json_list(pref.excluded_keywords),
            salary_min=pref.salary_min,
            salary_max=pref.salary_max,
            career_direction=pref.career_direction,
            work_arrangements=arrangements,
        ),
        created_at=pref.created_at,
        updated_at=pref.updated_at,
    )


@router.get("", response_model=PreferencesGetResponse)
async def get_preferences(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> PreferencesGetResponse:
    """Return the authenticated user's search preferences (or null if never saved)."""
    result = await session.execute(
        select(SearchPreferences).where(SearchPreferences.user_id == current_user.id)
    )
    pref = result.scalar_one_or_none()
    return PreferencesGetResponse(
        preferences=_to_response(pref) if pref else None
    )


@router.put("", response_model=SearchPreferencesResponse)
async def update_preferences(
    payload: SearchPreferencesUpdateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> SearchPreferencesResponse:
    """Create-or-update the user's preferences. Sparse: only provided fields change."""
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field must be provided.",
        )

    result = await session.execute(
        select(SearchPreferences).where(SearchPreferences.user_id == current_user.id)
    )
    pref = result.scalar_one_or_none()
    if pref is None:
        pref = SearchPreferences(user_id=current_user.id)
        session.add(pref)

    # Cross-field salary check against stored values (sparse updates may not send both).
    merged_min = data["salary_min"] if "salary_min" in data else pref.salary_min
    merged_max = data["salary_max"] if "salary_max" in data else pref.salary_max
    if merged_min is not None and merged_max is not None and merged_min > merged_max:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="salary_min must be less than or equal to salary_max.",
        )

    for field, value in data.items():
        if field in {"target_roles", "excluded_keywords", "preferred_locations"}:
            setattr(pref, field, json.dumps(value or []))
        elif field == "work_arrangements":
            arrs = value or []
            pref.remote_ok = "remote" in arrs
            pref.hybrid_ok = "hybrid" in arrs
            pref.onsite_ok = "onsite" in arrs
            pref.preferred_arrangements = json.dumps(arrs)
        else:
            setattr(pref, field, value)

    await session.commit()
    await session.refresh(pref)
    return _to_response(pref)