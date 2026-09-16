"""Database models package."""
from .schemas import (
    ProcessingState,
    WorkArrangement,
    FitLevel,
    Evaluation,
    JobRecord,
    JobSummary,
    ApplicationRecord,
    PipelineStage,
    StageStatus,
    PipelineCheckpoint,
    PipelineStatus,
    HealthResponse,
    JobListResponse,
    ErrorResponse,
)

# Import database models to register them with SQLAlchemy
from .database_models import (
    User,
    Resume,
    CandidateProfile,
    SearchPreferences,
    SearchRun,
    UserJob,
    Job,
    Application,
)

__all__ = [
    # API Schemas
    "ProcessingState",
    "WorkArrangement",
    "FitLevel",
    "Evaluation",
    "JobRecord",
    "JobSummary",
    "ApplicationRecord",
    "PipelineStage",
    "StageStatus",
    "PipelineCheckpoint",
    "PipelineStatus",
    "HealthResponse",
    "JobListResponse",
    "ErrorResponse",
    # Database Models
    "User",
    "Resume",
    "CandidateProfile",
    "SearchPreferences",
    "SearchRun",
    "UserJob",
    "Job",
    "Application",
]