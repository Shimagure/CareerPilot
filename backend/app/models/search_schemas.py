"""Pydantic schemas for authenticated job search runs (Checkpoint 7)."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.validation import validate_search_term


class SearchRunStatus(str, Enum):
    """Search run lifecycle status (mirrors DB enum; explicit for API consumers).

    Matches the DB SearchRunStatus exactly so legacy rows serialize cleanly.
    This API only ever produces queued/running/completed/failed (no fake cancelled).
    """
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SearchPipelineStage(str, Enum):
    """Truthfully derivable pipeline stages — never fabricated."""
    PREPARING = "preparing"
    DISCOVERY = "discovery"
    COMPLETED = "completed"
    FAILED = "failed"


class StartSearchRequest(BaseModel):
    """Runtime execution options — distinct from persisted preferences.

    Preferences are loaded from the user's saved SearchPreferences row.
    Only genuinely supported execution options are accepted here.
    """
    model_config = ConfigDict(extra="forbid")

    dry_run: bool = Field(
        default=False,
        description="Run in dry-run mode: no network requests, no shared file mutation.",
    )
    search_keywords: Optional[str] = Field(
        default=None,
        max_length=500,
        description=(
            "Override search keywords for this run only. "
            "If omitted, the first target role from preferences is used. "
            "Must be safe for CLI argument passing (no shell metacharacters)."
        ),
    )
    search_location: Optional[str] = Field(
        default=None,
        max_length=200,
        description=(
            "Override search location for this run only. "
            "If omitted, the first preferred location from preferences is used."
        ),
    )

    @field_validator("search_keywords", "search_location")
    @classmethod
    def _validate_cli_safe(cls, value: Optional[str]) -> Optional[str]:
        """Reject values unsafe to pass as a CLI argument (defense-in-depth).

        The pipeline adapter enforces the same rule before spawning any
        subprocess; this validates early at the API boundary.
        """
        if value is None:
            return value
        validate_search_term(value)
        return value

    @field_validator("dry_run", mode="before")
    @classmethod
    def _validate_dry_run_type(cls, value) -> bool:
        """Ensure dry_run is a boolean (reject strings like 'yes')."""
        if not isinstance(value, bool):
            raise ValueError("dry_run must be a boolean")
        return value


class SearchRunResponse(BaseModel):
    """Single search run representation — safe for the owning user."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: SearchRunStatus
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    pipeline_stage: Optional[SearchPipelineStage] = None
    preference_snapshot: Optional[dict[str, Any]] = None
    execution_options: Optional[dict[str, Any]] = None
    result_summary: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class SearchRunListResponse(BaseModel):
    """Paginated list of the user's search runs."""
    runs: list[SearchRunResponse]
    total: int
    limit: int
    offset: int
