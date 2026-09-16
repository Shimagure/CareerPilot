"""Pydantic schemas for user-scoped application tracking (Checkpoint 12).

The web app's application tracker is backed by the existing ``Application``
model (one row per (user, job)), keyed by the job's ``stable_id``. Company and
role are snapshotted from the global job dataset at creation time — never
fabricated from client input. If the job later leaves the dataset, ``available``
is False and ``job`` is None; the stored snapshot fields remain the honest
record of what was applied to.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from .schemas import JobRecord


class ApplicationCreate(BaseModel):
    """Create an application for the authenticated user from a job.

    ``stable_id`` must reference a job in the current global dataset (404
    otherwise). ``company``/``role`` are derived server-side from the dataset.
    """
    stable_id: str = Field(min_length=1)
    status: Optional[str] = Field(default="draft", description="ApplicationStatus value")
    fit_rating: Optional[int] = Field(default=None, ge=0, le=100)
    sector: Optional[str] = None
    role_type: Optional[str] = None
    channel: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None


class ApplicationUpdate(BaseModel):
    """Update an existing application (any subset of fields)."""
    status: Optional[str] = None
    fit_rating: Optional[int] = Field(default=None, ge=0, le=100)
    sector: Optional[str] = None
    role_type: Optional[str] = None
    channel: Optional[str] = None
    contact_person: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None


class ApplicationDetail(BaseModel):
    """Full application tracking record for the API.

    Reflects the ``Application`` model, enriched with the job record when the
    job is still in the global dataset. ``available``/``job`` are set honestly:
    a job that has left the dataset is reported as unavailable and never given
    fabricated fields.
    """
    id: str
    job_stable_id: str
    status: str
    company: str
    role: str
    role_type: Optional[str] = None
    sector: Optional[str] = None
    channel: Optional[str] = None
    contact_person: Optional[str] = None
    fit_rating: Optional[int] = None
    notes: Optional[str] = None
    cv_file: Optional[str] = None
    cover_letter_file: Optional[str] = None
    source: Optional[str] = None

    applied_at: Optional[datetime] = None
    responded_at: Optional[datetime] = None
    interview_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None

    created_at: datetime
    updated_at: datetime

    available: bool
    job: Optional[JobRecord] = None