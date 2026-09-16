"""Pydantic schemas for the authenticated user workspace dashboard."""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict


class DashboardUser(BaseModel):
    """Public user identity for the dashboard (no hash, no token)."""
    id: str
    email: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProfileReadiness(BaseModel):
    """Setup state for the user's future resume/profile/preferences."""
    resume_uploaded: bool
    candidate_profile_configured: bool
    search_preferences_configured: bool
    completed_steps: int
    total_steps: int
    ready: bool


class UserActivity(BaseModel):
    """User-specific career activity (all scoped to the authenticated user)."""
    search_run_count: int
    saved_job_count: int
    application_count: int
    has_activity: bool


class SystemOverview(BaseModel):
    """Global job-search pipeline state — system-level, NOT user-owned."""
    status: str
    pipeline_stage: Optional[str] = None
    pipeline_status: Optional[str] = None
    active_jobs: Optional[int] = None
    stale_jobs: Optional[int] = None
    blocked_jobs: Optional[int] = None


class NextStep(BaseModel):
    """A recommended action, either an existing route or a future capability."""
    id: str
    label: str
    description: str
    href: Optional[str] = None
    coming_soon: bool = False


class LastSearchRun(BaseModel):
    """Last search run summary for the dashboard."""
    id: str
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    pipeline_stage: Optional[str] = None
    result_summary: Optional[dict] = None
    created_at: datetime


class DashboardResponse(BaseModel):
    """Focused payload for the authenticated user workspace."""
    user: DashboardUser
    profile_readiness: ProfileReadiness
    user_activity: UserActivity
    system_overview: SystemOverview
    next_steps: list[NextStep]
    last_search_run: Optional[LastSearchRun] = None
    timestamp: datetime