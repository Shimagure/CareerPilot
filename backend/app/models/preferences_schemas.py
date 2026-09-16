"""Pydantic schemas for search preferences (Checkpoint 6).

Preferences describe what the user WANTS, not what they are. They are
user-controlled intent and are never populated from resume/profile data.
"""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

WorkArrangement = Literal["remote", "hybrid", "onsite"]
SalaryPeriod = Literal["monthly", "annual"]

# Validation limits
MAX_LIST_ITEMS = 50
MAX_ITEM_LENGTH = 200
SALARY_MAX = 50_000_000
MAX_CAREER_DIRECTION = 2000


def normalize_string_list(value):
    """Trim, drop empties, dedupe case-insensitively (preserving order), cap size.

    Returns the cleaned list or raises ValueError for pathological payloads.
    """
    cleaned: list[str] = []
    seen = set()
    for raw in value:
        if raw is None:
            continue
        text = str(raw).strip()
        if not text:
            continue
        if len(text) > MAX_ITEM_LENGTH:
            raise ValueError(f"item is too long (max {MAX_ITEM_LENGTH} characters)")
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
    if len(cleaned) > MAX_LIST_ITEMS:
        raise ValueError(f"too many items (max {MAX_LIST_ITEMS})")
    return cleaned


def arrangements_from_bools(remote_ok: bool, hybrid_ok: bool, onsite_ok: bool) -> list[WorkArrangement]:
    """Derive the accepted work arrangements list from the canonical bool flags."""
    out: list[WorkArrangement] = []
    if remote_ok:
        out.append("remote")
    if hybrid_ok:
        out.append("hybrid")
    if onsite_ok:
        out.append("onsite")
    return out


def search_preferences_configured(
    target_roles: list,
    preferred_locations: list,
    excluded_keywords: list,
    salary_min: int | None,
    salary_max: int | None,
    career_direction: str | None,
    work_arrangements: list,
) -> bool:
    """Honest 'configured' signal: meaningful values only, not model defaults.

    Default flags (remote+hybrid OK, NCR-only, all shifts OK, currency/period)
    do NOT count as configuration. A departure from the default arrangement set
    or any real user-provided value does.
    """
    if target_roles or preferred_locations or excluded_keywords:
        return True
    if salary_min is not None or salary_max is not None:
        return True
    if career_direction and career_direction.strip():
        return True
    if set(work_arrangements) != {"remote", "hybrid"}:
        return True
    return False


class SearchPreferencesUpdateRequest(BaseModel):
    """Create-or-update payload (sparse; only provided fields change)."""
    target_roles: Optional[list[str]] = None
    excluded_keywords: Optional[list[str]] = None
    preferred_locations: Optional[list[str]] = None
    ncr_only: Optional[bool] = None
    work_arrangements: Optional[list[WorkArrangement]] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: Optional[str] = None
    salary_period: Optional[SalaryPeriod] = None
    day_shift_ok: Optional[bool] = None
    night_shift_ok: Optional[bool] = None
    rotational_ok: Optional[bool] = None
    career_direction: Optional[str] = None

    @field_validator("target_roles", "preferred_locations", "excluded_keywords", mode="before")
    @classmethod
    def _clean_list(cls, v):
        if v is None:
            return None
        if not isinstance(v, list):
            raise ValueError("must be a list")
        return normalize_string_list(v)

    @field_validator("work_arrangements", mode="before")
    @classmethod
    def _clean_arrangements(cls, v):
        if v is None:
            return None
        if not isinstance(v, list):
            raise ValueError("work_arrangements must be a list")
        seen = set()
        out = []
        for item in v:
            if item not in ("remote", "hybrid", "onsite"):
                raise ValueError("work_arrangements must be one of: remote, hybrid, onsite")
            if item not in seen:
                seen.add(item)
                out.append(item)
        return out

    @field_validator("salary_min", "salary_max", mode="before")
    @classmethod
    def _clean_salary(cls, v):
        if v is None:
            return None
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ValueError("salary must be a number")
        if v < 0:
            raise ValueError("salary must be non-negative")
        if v > SALARY_MAX:
            raise ValueError(f"salary must be <= {SALARY_MAX}")
        return int(v)

    @field_validator("salary_currency", mode="before")
    @classmethod
    def _clean_currency(cls, v):
        if v is None:
            return None
        text = str(v).strip().upper()
        if not (3 <= len(text) <= 10) or not text.isalpha():
            raise ValueError("currency must be 3-10 letters (e.g. PHP)")
        return text

    @field_validator("career_direction", mode="before")
    @classmethod
    def _clean_career_direction(cls, v):
        if v is None:
            return None
        text = str(v).strip()
        if len(text) > MAX_CAREER_DIRECTION:
            raise ValueError(f"career direction is too long (max {MAX_CAREER_DIRECTION} characters)")
        return text or None

    @model_validator(mode="after")
    def _check_salary_range(self):
        if (
            self.salary_min is not None
            and self.salary_max is not None
            and self.salary_min > self.salary_max
        ):
            raise ValueError("salary_min must be less than or equal to salary_max")
        return self


class SearchPreferencesResponse(BaseModel):
    """The user's stored search preferences."""
    id: str
    target_roles: list[str]
    excluded_keywords: list[str]
    preferred_locations: list[str]
    ncr_only: bool
    work_arrangements: list[WorkArrangement]
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str
    salary_period: SalaryPeriod
    day_shift_ok: bool
    night_shift_ok: bool
    rotational_ok: bool
    career_direction: Optional[str] = None
    configured: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PreferencesGetResponse(BaseModel):
    """GET /api/preferences shape: the preferences object or null (never a fabricated default)."""
    preferences: Optional[SearchPreferencesResponse] = None