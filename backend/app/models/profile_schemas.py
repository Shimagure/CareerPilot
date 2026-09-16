"""Pydantic schemas for the authenticated user's candidate profile.

Provenance: every structured item carries a ``source`` of ``resume_extracted``
or ``user_verified``. ``resume_extracted`` means the item came from an
automated resume read and has NOT been confirmed by the user; ``user_verified``
means the user provided or explicitly confirmed it. Nothing in the API ever
silently upgrades one to the other.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

ProfileSource = Literal["resume_extracted", "user_verified"]

_URL_RE = re.compile(r"^https?://", re.IGNORECASE)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _strip_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip().strip("*•·")
    return value or None


def _validate_url(value: str | None, max_len: int) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) > max_len:
        raise ValueError("URL is too long")
    if not _URL_RE.match(value):
        raise ValueError("URL must start with http:// or https://")
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("Invalid URL")
    return value


class SkillItem(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    source: ProfileSource = "user_verified"

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        cleaned = _strip_or_none(v)
        if not cleaned:
            raise ValueError("Skill name must not be empty")
        return cleaned


class ExperienceItem(BaseModel):
    employer: str | None = Field(default=None, max_length=255)
    title: str | None = Field(default=None, max_length=255)
    start_date: str | None = Field(default=None, max_length=50)
    end_date: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=2000)
    source: ProfileSource = "user_verified"

    @field_validator("employer", "title", "start_date", "end_date", "description")
    @classmethod
    def clean_optional(cls, v: str | None) -> str | None:
        return _strip_or_none(v)


class EducationItem(BaseModel):
    institution: str | None = Field(default=None, max_length=255)
    degree: str | None = Field(default=None, max_length=255)
    field: str | None = Field(default=None, max_length=255)
    start_date: str | None = Field(default=None, max_length=50)
    end_date: str | None = Field(default=None, max_length=50)
    source: ProfileSource = "user_verified"

    @field_validator("institution", "degree", "field", "start_date", "end_date")
    @classmethod
    def clean_optional(cls, v: str | None) -> str | None:
        return _strip_or_none(v)


class CertificationItem(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    issuer: str | None = Field(default=None, max_length=200)
    year: str | None = Field(default=None, max_length=4)
    source: ProfileSource = "user_verified"

    @field_validator("name", "issuer", "year")
    @classmethod
    def clean_optional(cls, v: str | None) -> str | None:
        return _strip_or_none(v)

    @field_validator("year")
    @classmethod
    def clean_year(cls, v: str | None) -> str | None:
        cleaned = _strip_or_none(v)
        if cleaned is None:
            return None
        if not re.fullmatch(r"(?:19|20)\d{2}", cleaned):
            raise ValueError("Year must be a 4-digit year")
        return cleaned


class LanguageItem(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    level: str | None = Field(default=None, max_length=100)
    source: ProfileSource = "user_verified"

    @field_validator("name", "level")
    @classmethod
    def clean_optional(cls, v: str | None) -> str | None:
        return _strip_or_none(v)


class ProjectItem(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    url: str | None = Field(default=None, max_length=500)
    source: ProfileSource = "user_verified"

    @field_validator("name", "description")
    @classmethod
    def clean_optional(cls, v: str | None) -> str | None:
        return _strip_or_none(v)

    @field_validator("url")
    @classmethod
    def clean_url(cls, v: str | None) -> str | None:
        return _validate_url(v, 500)


class ProfileUpdateRequest(BaseModel):
    """Editable profile fields. All optional; missing fields are left unchanged."""

    full_name: str | None = Field(default=None, max_length=255)
    headline: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    linkedin_url: str | None = Field(default=None, max_length=500)
    portfolio_url: str | None = Field(default=None, max_length=500)
    professional_summary: str | None = Field(default=None, max_length=4000)
    skills: list[SkillItem] | None = Field(default=None, max_length=200)
    experience: list[ExperienceItem] | None = Field(default=None, max_length=50)
    education: list[EducationItem] | None = Field(default=None, max_length=20)
    certifications: list[CertificationItem] | None = Field(default=None, max_length=30)
    languages: list[LanguageItem] | None = Field(default=None, max_length=30)
    projects: list[ProjectItem] | None = Field(default=None, max_length=20)
    source_resume_id: str | None = Field(default=None)

    @field_validator("full_name", "headline", "location", "phone", "professional_summary")
    @classmethod
    def clean_text(cls, v: str | None) -> str | None:
        return _strip_or_none(v)

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str | None) -> str | None:
        cleaned = _strip_or_none(v)
        if cleaned is None:
            return None
        if not _EMAIL_RE.match(cleaned) or len(cleaned) > 255:
            raise ValueError("A valid email address is required")
        return cleaned

    @field_validator("linkedin_url", "portfolio_url")
    @classmethod
    def clean_links(cls, v: str | None) -> str | None:
        return _validate_url(v, 500)


class CandidateProfileResponse(BaseModel):
    """Full public profile state. Never includes storage paths or raw resume text."""

    id: str | None = None
    full_name: str | None = None
    headline: str | None = None
    location: str | None = None
    phone: str | None = None
    email: str | None = None
    linkedin_url: str | None = None
    portfolio_url: str | None = None
    professional_summary: str | None = None
    skills: list[SkillItem] = Field(default_factory=list)
    experience: list[ExperienceItem] = Field(default_factory=list)
    education: list[EducationItem] = Field(default_factory=list)
    certifications: list[CertificationItem] = Field(default_factory=list)
    languages: list[LanguageItem] = Field(default_factory=list)
    projects: list[ProjectItem] = Field(default_factory=list)
    source_resume_id: str | None = None
    source_resume_filename: str | None = None
    manually_edited: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ProfileGetResponse(BaseModel):
    """GET /api/profile — the user's profile (or none) plus resume availability."""

    profile: CandidateProfileResponse | None
    has_active_resume: bool


class ProfileExtractResponse(BaseModel):
    """POST /api/profile/extract — a *reviewable draft*. Nothing is persisted."""

    resume_id: str
    resume_filename: str
    has_text: bool
    warning: str | None = None
    draft: CandidateProfileResponse


# Reusable annotation for list item types exposed to the frontend.
SkillList = Annotated[list[SkillItem], Field(max_length=200)]