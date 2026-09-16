"""SQLAlchemy database models for CareerPilot multi-user foundation."""
from datetime import datetime
from enum import Enum as PyEnum
from typing import List
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def enum_values(enum_cls):
    """Return list of enum member values for SQLAlchemy values_callable."""
    return [member.value for member in enum_cls]


class UserStatus(str, PyEnum):
    """User account status."""
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"


class UserRole(str, PyEnum):
    """User role for access control."""
    USER = "user"
    ADMIN = "admin"


class ResumeStatus(str, PyEnum):
    """Resume processing status."""
    UPLOADED = "uploaded"
    PARSING = "parsing"
    PARSED = "parsed"
    FAILED = "failed"
    ACTIVE = "active"
    ARCHIVED = "archived"


class SearchRunStatus(str, PyEnum):
    """Job search run status."""
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class UserJobStatus(str, PyEnum):
    """User-job association status."""
    SAVED = "saved"
    VIEWED = "viewed"
    INTERESTED = "interested"
    DISMISSED = "dismissed"
    ANALYZED = "analyzed"


class ApplicationStatus(str, PyEnum):
    """Application tracking status."""
    DRAFT = "draft"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    INTERVIEW = "interview"
    OFFER = "offer"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    ACCEPTED = "accepted"


class JobSourceType(str, PyEnum):
    """Job source type classification."""
    DIRECT_EMPLOYER = "direct_employer"
    JOB_BOARD = "job_board"
    GOVERNMENT_PORTAL = "government_portal"
    CUSTOM_FEED = "custom_feed"


class JobSourceStatus(str, PyEnum):
    """Job source lifecycle status."""
    DISCOVERED = "discovered"
    ANALYZING = "analyzing"
    READY_FOR_REVIEW = "ready_for_review"
    APPROVED = "approved"
    ENABLED = "enabled"
    DISABLED = "disabled"


def generate_uuid() -> str:
    """Generate a UUID string."""
    return str(uuid4())


class User(Base):
    """User account model."""
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=generate_uuid
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, native_enum=False, values_callable=enum_values), default=UserStatus.ACTIVE, nullable=False
    )
    # Server-side session version.  Issued JWTs carry this counter as a
    # claim; get_current_user rejects any token whose claim does not match
    # the stored value.  Logout (and any future security-sensitive state
    # change such as a password reset) increments it to revoke all
    # outstanding tokens.  Fresh databases create the column via create_all;
    # existing databases need: ALTER TABLE users ADD COLUMN token_version
    # INTEGER NOT NULL DEFAULT 1.
    token_version: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, native_enum=False, values_callable=enum_values), default=UserRole.USER, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    resumes: Mapped[list["Resume"]] = relationship(
        "Resume", back_populates="user", cascade="all, delete-orphan"
    )
    candidate_profile: Mapped["CandidateProfile"] = relationship(
        "CandidateProfile", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    search_preferences: Mapped["SearchPreferences"] = relationship(
        "SearchPreferences", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    search_runs: Mapped[list["SearchRun"]] = relationship(
        "SearchRun", back_populates="user", cascade="all, delete-orphan"
    )
    user_jobs: Mapped[list["UserJob"]] = relationship(
        "UserJob", back_populates="user", cascade="all, delete-orphan"
    )
    applications: Mapped[list["Application"]] = relationship(
        "Application", back_populates="user", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_users_status", "status"),
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email}, role={self.role}, status={self.status})>"


class Resume(Base):
    """User resume model."""
    __tablename__ = "resumes"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=generate_uuid
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[ResumeStatus] = mapped_column(
        Enum(ResumeStatus, native_enum=False, values_callable=enum_values), default=ResumeStatus.UPLOADED, nullable=False
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    parsed_at: Mapped["datetime"] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="resumes")

    __table_args__ = (
        Index("ix_resumes_status", "status"),
        Index("ix_resumes_user_active", "user_id", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<Resume(id={self.id}, user_id={self.user_id}, filename={self.original_filename}, status={self.status})>"


class CandidateProfile(Base):
    """User candidate profile model - structured candidate information."""
    __tablename__ = "candidate_profiles"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=generate_uuid
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    # Personal info
    full_name: Mapped["str"] = mapped_column(String(255), nullable=True)
    headline: Mapped["str"] = mapped_column(String(500), nullable=True)
    location: Mapped["str"] = mapped_column(String(255), nullable=True)
    phone: Mapped["str"] = mapped_column(String(50), nullable=True)
    email: Mapped["str"] = mapped_column(String(255), nullable=True)
    linkedin_url: Mapped["str"] = mapped_column(String(500), nullable=True)
    portfolio_url: Mapped["str"] = mapped_column(String(500), nullable=True)

    # Professional summary
    professional_summary: Mapped["str"] = mapped_column(Text, nullable=True)

    # Structured data (JSON for flexibility)
    skills: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON array
    experience: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON array
    education: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON array
    certifications: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON array
    projects: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON array
    languages: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON array

    # Source tracking
    source_resume_id: Mapped["str"] = mapped_column(
        UUID(as_uuid=False), ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True
    )
    manually_edited: Mapped[bool] = mapped_column(default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="candidate_profile")
    source_resume: Mapped["Resume | None"] = relationship("Resume")

    __table_args__ = (
        Index("ix_candidate_profiles_user_id", "user_id"),
    )

    def __repr__(self) -> str:
        return f"<CandidateProfile(id={self.id}, user_id={self.user_id})>"


class SearchPreferences(Base):
    """User job search preferences model."""
    __tablename__ = "search_preferences"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=generate_uuid
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    # Role preferences
    target_roles: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON array
    excluded_keywords: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON array

    # Work arrangement
    preferred_arrangements: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON array
    remote_ok: Mapped[bool] = mapped_column(default=True, nullable=False)
    hybrid_ok: Mapped[bool] = mapped_column(default=True, nullable=False)
    onsite_ok: Mapped[bool] = mapped_column(default=False, nullable=False)

    # Location
    preferred_locations: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON array
    ncr_only: Mapped[bool] = mapped_column(default=True, nullable=False)

    # Salary
    salary_min: Mapped["int"] = mapped_column(Integer, nullable=True)
    salary_max: Mapped["int"] = mapped_column(Integer, nullable=True)
    salary_currency: Mapped[str] = mapped_column(String(10), default="PHP", nullable=False)
    salary_period: Mapped[str] = mapped_column(String(20), default="monthly", nullable=False)

    # Shift preferences
    day_shift_ok: Mapped[bool] = mapped_column(default=True, nullable=False)
    night_shift_ok: Mapped[bool] = mapped_column(default=True, nullable=False)
    rotational_ok: Mapped[bool] = mapped_column(default=True, nullable=False)

    # Career direction
    career_direction: Mapped["str"] = mapped_column(Text, nullable=True)

    # Search behavior
    auto_search_enabled: Mapped[bool] = mapped_column(default=False, nullable=False)
    search_frequency_days: Mapped[int] = mapped_column(default=7, nullable=False)
    max_results_per_search: Mapped[int] = mapped_column(default=50, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="search_preferences")

    __table_args__ = (
        Index("ix_search_preferences_user_id", "user_id"),
    )

    def __repr__(self) -> str:
        return f"<SearchPreferences(id={self.id}, user_id={self.user_id})>"


class SearchRun(Base):
    """Job search execution run model."""
    __tablename__ = "search_runs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=generate_uuid
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[SearchRunStatus] = mapped_column(
        Enum(SearchRunStatus, native_enum=False, values_callable=enum_values), default=SearchRunStatus.QUEUED, nullable=False
    )
    started_at: Mapped["datetime"] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped["datetime"] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped["str"] = mapped_column(Text, nullable=True)
    run_metadata: Mapped["str"] = mapped_column(Text, nullable=True)  # JSON
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="search_runs")

    __table_args__ = (
        Index("ix_search_runs_status", "status"),
        Index("ix_search_runs_user_status", "user_id", "status"),
    )

    def __repr__(self) -> str:
        return f"<SearchRun(id={self.id}, user_id={self.user_id}, status={self.status})>"


class UserJob(Base):
    """User-job association model (saved/interested/dismissed jobs)."""
    __tablename__ = "user_jobs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=generate_uuid
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_stable_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[UserJobStatus] = mapped_column(
        Enum(UserJobStatus, native_enum=False, values_callable=enum_values), default=UserJobStatus.SAVED, nullable=False
    )
    notes: Mapped["str"] = mapped_column(Text, nullable=True)
    viewed_at: Mapped["datetime"] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="user_jobs")

    __table_args__ = (
        UniqueConstraint("user_id", "job_stable_id", name="uq_user_job"),
        Index("ix_user_jobs_job_stable_id", "job_stable_id"),
        Index("ix_user_jobs_user_status", "user_id", "status"),
    )

    def __repr__(self) -> str:
        return f"<UserJob(id={self.id}, user_id={self.user_id}, job_stable_id={self.job_stable_id}, status={self.status})>"


class Job(Base):
    """Global pipeline job mirror."""
    __tablename__ = "jobs"

    stable_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_key: Mapped[str] = mapped_column(String(255), nullable=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    company: Mapped[str] = mapped_column(String(500), nullable=False)
    location: Mapped[str] = mapped_column(String(500), nullable=True)
    salary: Mapped[str] = mapped_column(String(255), nullable=True)
    url: Mapped[str] = mapped_column(String(2000), nullable=False)
    portal: Mapped[str] = mapped_column(String(100), nullable=True)
    arrangement: Mapped[str] = mapped_column(String(32), nullable=True)
    work_mode: Mapped[str] = mapped_column(String(64), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    processing_state: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(64), nullable=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    last_verified: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    blocked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    blocked_reason: Mapped[str] = mapped_column(String(100), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    changed_fields: Mapped[str] = mapped_column(Text, nullable=True)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=True)
    previous_fingerprint: Mapped[str] = mapped_column(String(64), nullable=True)
    rank: Mapped[int] = mapped_column(Integer, nullable=True)
    rank_score: Mapped[int] = mapped_column(Integer, nullable=True)
    rank_verdict: Mapped[str] = mapped_column(String(100), nullable=True)
    rank_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    fit: Mapped[str] = mapped_column(String(32), nullable=True)
    priority_tier: Mapped[int] = mapped_column(Integer, nullable=True)
    strengths: Mapped[str] = mapped_column(Text, nullable=True)
    gaps: Mapped[str] = mapped_column(Text, nullable=True)
    evaluation: Mapped[str] = mapped_column(Text, nullable=True)
    source_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    sync_run_id: Mapped[str] = mapped_column(String(64), nullable=True)
    source_schema_version: Mapped[str] = mapped_column(String(32), nullable=True)
    is_tombstone: Mapped[bool] = mapped_column(default=False, nullable=False)

    __table_args__ = (
        Index("ix_jobs_processing_state", "processing_state"),
        Index("ix_jobs_processing_state_rank", "processing_state", "rank_score"),
        Index("ix_jobs_portal", "portal"),
        Index("ix_jobs_last_active_at", "last_active_at"),
        Index("ix_jobs_sync_run_id", "sync_run_id"),
    )

    def __repr__(self) -> str:
        return f"<Job(stable_id={self.stable_id}, title={self.title!r})>"


class JobSource(Base):
    """Job source catalog for portal management."""
    __tablename__ = "job_sources"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=generate_uuid
    )
    name: Mapped[str] = mapped_column(
        String(100), unique=True, nullable=False, index=True
    )
    display_name: Mapped[str] = mapped_column(String(150), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    domain: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    source_type: Mapped[JobSourceType] = mapped_column(
        Enum(JobSourceType, native_enum=False, values_callable=enum_values), default=JobSourceType.JOB_BOARD, nullable=False
    )
    status: Mapped[JobSourceStatus] = mapped_column(
        Enum(JobSourceStatus, native_enum=False, values_callable=enum_values), default=JobSourceStatus.DISCOVERED, nullable=False, index=True
    )
    enabled: Mapped[bool] = mapped_column(default=False, nullable=False, index=True)
    analysis_data: Mapped[dict] = mapped_column(Text, nullable=True)  # JSON
    adapter_name: Mapped["str"] = mapped_column(String(100), nullable=True)
    health_status: Mapped["str"] = mapped_column(String(50), default="insufficient_evidence", nullable=True)
    last_checked_at: Mapped["datetime"] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped["str"] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    created_by_user: Mapped["User"] = relationship("User")

    __table_args__ = (
        Index("ix_job_sources_source_type", "source_type"),
        Index("ix_job_sources_created_by_user_id", "created_by_user_id"),
    )

    def __repr__(self) -> str:
        return f"<JobSource(id={self.id}, name={self.name!r}, status={self.status}, enabled={self.enabled})>"


class Application(Base):
    """User application tracking model."""
    __tablename__ = "applications"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=generate_uuid
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_stable_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[ApplicationStatus] = mapped_column(
        Enum(ApplicationStatus, native_enum=False, values_callable=enum_values), default=ApplicationStatus.DRAFT, nullable=False
    )
    # Application details
    company: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(255), nullable=False)
    role_type: Mapped["str"] = mapped_column(String(100), nullable=True)
    sector: Mapped["str"] = mapped_column(String(100), nullable=True)
    channel: Mapped["str"] = mapped_column(String(100), nullable=True)
    contact_person: Mapped["str"] = mapped_column(String(255), nullable=True)
    fit_rating: Mapped["int"] = mapped_column(Integer, nullable=True)
    notes: Mapped["str"] = mapped_column(Text, nullable=True)
    cv_file: Mapped["str"] = mapped_column(String(500), nullable=True)
    cover_letter_file: Mapped["str"] = mapped_column(String(500), nullable=True)
    source: Mapped["str"] = mapped_column(String(100), nullable=True)

    # Dates
    applied_at: Mapped["datetime"] = mapped_column(DateTime(timezone=True), nullable=True)
    responded_at: Mapped["datetime"] = mapped_column(DateTime(timezone=True), nullable=True)
    interview_at: Mapped["datetime"] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped["datetime"] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="applications")

    __table_args__ = (
        Index("ix_applications_job_stable_id", "job_stable_id"),
        Index("ix_applications_user_status", "user_id", "status"),
        Index("ix_applications_applied_at", "applied_at"),
    )

    def __repr__(self) -> str:
        return f"<Application(id={self.id}, user_id={self.user_id}, job_stable_id={self.job_stable_id}, status={self.status})>"