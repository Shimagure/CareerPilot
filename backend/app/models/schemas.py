"""Pydantic models for CareerPilot API."""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum


class ProcessingState(str, Enum):
    """Job processing states from the pipeline."""
    NEW = "NEW"
    NEEDS_VERIFICATION = "NEEDS_VERIFICATION"
    ACTIVE_VERIFIED = "ACTIVE_VERIFIED"
    ACTIVE_UNVERIFIED = "ACTIVE_UNVERIFIED"
    STALE = "STALE"
    CHANGED = "CHANGED"
    CLOSED_OR_EXPIRED = "CLOSED_OR_EXPIRED"
    POSTING_CHANGED = "POSTING_CHANGED"
    DUPLICATE_OR_INVALID = "DUPLICATE_OR_INVALID"
    DEPRIORITIZE = "DEPRIORITIZE"
    UNKNOWN = "UNKNOWN"


class WorkArrangement(str, Enum):
    """Work arrangement types."""
    REMOTE = "remote"
    HYBRID = "hybrid"
    ONSITE = "onsite"
    UNSPECIFIED = "unspecified"


class FitLevel(str, Enum):
    """Quick fit assessment levels."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNKNOWN = "unknown"


class Evaluation(BaseModel):
    """Stored evaluation/scoring data from the pipeline."""
    technical: Optional[int] = None
    experience: Optional[int] = None
    behavioral: Optional[int] = None
    location: Optional[str] = None
    location_note: Optional[str] = None
    career: Optional[int] = None
    overall: Optional[int] = None
    verdict: Optional[str] = None
    key_strengths: List[str] = []
    gaps: List[str] = []
    recommendation: Optional[str] = None
    evaluated_at: Optional[str] = None


class JobRecord(BaseModel):
    """Core job record from canonical pipeline."""
    stable_id: str
    title: str
    company: str
    location: Optional[str] = None
    salary: Optional[str] = None
    url: str
    portal: Optional[str] = None
    arrangement: WorkArrangement = WorkArrangement.UNSPECIFIED
    work_mode: Optional[str] = None
    description: Optional[str] = None
    processing_state: ProcessingState = ProcessingState.UNKNOWN
    first_seen: Optional[str] = None
    last_verified: Optional[str] = None
    blocked_at: Optional[str] = None
    blocked_reason: Optional[str] = None
    changed_at: Optional[str] = None
    changed_fields: List[str] = []
    closed_at: Optional[str] = None
    fingerprint: Optional[str] = None
    previous_fingerprint: Optional[str] = None
    rank_score: Optional[int] = None
    rank_verdict: Optional[str] = None
    rank_date: Optional[str] = None
    strengths: List[str] = []
    gaps: List[str] = []
    fit: FitLevel = FitLevel.UNKNOWN
    status: Optional[str] = None
    priority_tier: Optional[int] = None
    # Retention fields
    last_active_at: Optional[str] = None
    is_active_pool: Optional[bool] = None
    is_application_protected: Optional[bool] = None
    # Evaluation data from scoring stage
    evaluation: Optional[Evaluation] = None


class JobSummary(BaseModel):
    """Lightweight job summary for list views."""
    stable_id: str
    title: str
    company: str
    location: Optional[str] = None
    arrangement: WorkArrangement = WorkArrangement.UNSPECIFIED
    salary: Optional[str] = None
    portal: Optional[str] = None
    processing_state: ProcessingState
    rank_score: Optional[int] = None
    rank_verdict: Optional[str] = None
    fit: FitLevel = FitLevel.UNKNOWN
    is_active_pool: bool = True
    is_application_protected: bool = False


class ApplicationRecord(BaseModel):
    """Application tracking record."""
    date: str
    company: str
    sector: Optional[str] = None
    role: str
    role_type: Optional[str] = None
    channel: Optional[str] = None
    status: str
    contact_person: Optional[str] = None
    fit_rating: Optional[int] = None
    notes: Optional[str] = None
    cv_file: Optional[str] = None
    cover_letter_file: Optional[str] = None
    source: Optional[str] = None
    stable_id: Optional[str] = None  # Resolved from canonical


class PipelineStage(str, Enum):
    """Pipeline stage names."""
    DISCOVERY = "discovery"
    CANONICALIZATION = "canonicalization"
    HARD_FILTER = "hard_filter"
    PRIORITY_QUEUE = "priority_queue"
    VERIFICATION = "verification"
    SCORING = "scoring"
    RANKING_REPORT = "ranking_report"


class StageStatus(str, Enum):
    """Stage status values."""
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"
    FAILED = "failed"


class PipelineCheckpoint(BaseModel):
    """Pipeline checkpoint from checkpoints.json."""
    run_id: str
    started_at: str
    mode: Optional[str] = None
    stage: PipelineStage
    stage_status: StageStatus
    jobs_processed_in_stage: int
    total_jobs_in_stage: int
    batch_index: Optional[int] = None
    total_batches: Optional[int] = None
    last_updated: str
    error: Optional[str] = None
    # Summary fields from final checkpoint
    passed: Optional[int] = None
    deprioritized: Optional[int] = None
    queue_length: Optional[int] = None
    tier_breakdown: Optional[Dict[str, int]] = None
    verified: Optional[int] = None
    blocked: Optional[int] = None
    changed: Optional[int] = None
    closed: Optional[int] = None
    top5_count: Optional[int] = None
    top10_count: Optional[int] = None


class PipelineStatus(BaseModel):
    """Pipeline status for API."""
    current_checkpoint: Optional[PipelineCheckpoint] = None
    run_history: List[PipelineCheckpoint] = []
    data_files: Dict[str, bool] = {}


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "ok"
    timestamp: str
    data_files: Dict[str, bool]
    pipeline_stage: Optional[str] = None
    pipeline_status: Optional[str] = None
    active_jobs_count: Optional[int] = None
    stale_jobs_count: Optional[int] = None
    blocked_jobs_count: Optional[int] = None


class JobListResponse(BaseModel):
    """Response for job list endpoint."""
    jobs: List[JobSummary]
    total: int
    page: int
    page_size: int
    filters: Dict[str, Any] = {}


class ErrorResponse(BaseModel):
    """Standard error response."""
    detail: str
    status_code: int


class PortalHealthObservation(BaseModel):
    """Single observation from portal health evidence."""
    evidence_id: str
    observed_at: str
    result: str  # "success" | "explicit_403_blocked" | "inconclusive"
    source: str = "seen_jobs"  # "seen_jobs" | "run_history"


class PortalHealthWindow(BaseModel):
    """Rolling 7-day window statistics."""
    explicit_403_blocked: int = 0
    success: int = 0
    inconclusive: int = 0
    total_observed: int = 0
    block_rate_percent: Optional[float] = None


class PortalHealthCounts(BaseModel):
    """Cumulative health counts."""
    success: int = 0
    explicit_403_blocked: int = 0
    inconclusive: int = 0
    total_observed: int = 0


class PortalHealthStatus(BaseModel):
    """Complete portal health status."""
    name: str
    display_name: str
    observations: List[PortalHealthObservation] = []
    counts: PortalHealthCounts = Field(default_factory=PortalHealthCounts)
    status: str = "insufficient_evidence"  # "ok" | "blocked" | "insufficient_evidence"
    window: PortalHealthWindow = Field(default_factory=PortalHealthWindow)
    disabled: bool = False
    disabled_at: Optional[str] = None
    disabled_reason: Optional[str] = None
    skill_enabled: Optional[bool] = None
    skill_present: bool = True
    job_source_enabled: Optional[bool] = None


class PortalHealthListResponse(BaseModel):
    """Response for portal health list endpoint."""
    portals: List[PortalHealthStatus]
    summary: Dict[str, int]  # {"ok": N, "blocked": N, "insufficient_evidence": N, "disabled": N}
    rolling_window_days: int = 7
    disable_threshold_percent: int = 50
    updated_at: Optional[str] = None


class PortalHealthResponse(BaseModel):
    """Response for single portal health detail endpoint."""
    portal: PortalHealthStatus