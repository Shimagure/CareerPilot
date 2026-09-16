"""Configuration and path handling for CareerPilot API."""
import os
import re
from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator, computed_field


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Environment
    environment: str = "development"  # "development" | "production"

    # Database
    database_url: str = "sqlite+aiosqlite:///./careerpilot.db"
    database_echo: bool = False

    # Security
    secret_key: str = "dev-secret-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    # CORS
    cors_allowed_origins: str = "*"  # comma-separated list, e.g., "https://app.example.com,https://admin.example.com"

    # Resume uploads
    upload_dir: str | None = None  # overrides the default uploads location
    max_resume_size_mb: int = 10

    # LLM Provider settings
    llm_provider: str = "openai"  # "openai" | "anthropic"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-3-5-haiku-20241022"

    # ── Rate limiting (P3.1) ────────────────────────────────────────────
    # In-process sliding-window limiter (single-host / single-worker design).
    # See app/rate_limit.py for the trust model and bounds.
    rate_limit_enabled: bool = True
    # Upper bound on tracked clients; oldest entries are evicted when full.
    rate_limit_max_clients: int = 10000
    # Trust "X-Forwarded-For" for the client identity. ONLY enable when the
    # app is reachable exclusively through ONE reverse proxy that sets this
    # header (see P3.1 report). Never trust it when clients can reach the app
    # directly.
    rate_limit_trust_proxy: bool = False

    # Auth endpoints (keyed by client IP unless noted).
    login_limit_per_ip: int = 20          # login attempts per IP
    login_window_seconds: int = 300
    login_limit_per_account: int = 10     # login attempts per account (email)
    login_account_window_seconds: int = 900
    register_limit_per_ip: int = 10       # registrations per IP
    register_window_seconds: int = 3600

    # Expensive operations (keyed by authenticated user id).
    search_start_limit_per_user: int = 6  # run initiations per user
    search_start_window_seconds: int = 300
    # Hard cap on how long a single search run may execute before it is
    # force-failed, so a slow/stuck run cannot hold the global run lock forever.
    search_run_max_duration_seconds: int = 1200

    docgen_limit_per_user: int = 10       # with-documents calls per user
    docgen_window_seconds: int = 3600
    docgen_max_concurrent_per_user: int = 1  # in-flight compiles per user
    docgen_concurrency_retry_after_seconds: int = 10

    # Anonymous public demo reads (/api/public/*); keyed by client IP via the
    # same single-proxy trust model as the auth limits. Generous by default so
    # ordinary demo browsing and readiness probes are unaffected, but a crawler
    # cannot hammer the public plane without bound. P5.1 (§8).
    public_read_limit_per_ip: int = 120   # requests per IP
    public_read_window_seconds: int = 60

    @field_validator("environment")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        allowed = {"development", "production"}
        if v not in allowed:
            raise ValueError(f"environment must be one of {allowed}, got: {v}")
        return v

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, v: str, info) -> str:
        # Check if we're in production mode (need to access other fields)
        # We'll do the production check in a model_validator instead
        return v

    @field_validator("cors_allowed_origins")
    @classmethod
    def validate_cors_origins(cls, v: str) -> str:
        # Basic validation - just ensure it's a non-empty string
        if not v.strip():
            raise ValueError("cors_allowed_origins cannot be empty")
        return v

    @computed_field
    @property
    def cors_origins_list(self) -> list[str]:
        """Parse comma-separated CORS origins into a list."""
        origins = [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]
        return origins if origins else ["*"]

    @computed_field
    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment == "production"

    def validate_production_config(self) -> None:
        """Validate production configuration. Raises ValueError if invalid."""
        if not self.is_production:
            return

        # Reject known development secret in production
        if self.secret_key == "dev-secret-change-in-production":
            raise ValueError(
                "Production environment requires an explicit SECRET_KEY. "
                "The default development secret is not allowed in production."
            )

        # Reject wildcard CORS with credentials in production
        if "*" in self.cors_origins_list and len(self.cors_origins_list) == 1:
            raise ValueError(
                "Production environment requires explicit CORS_ALLOWED_ORIGINS. "
                "Wildcard '*' with credentials is not allowed in production."
            )

        # Reject relative SQLite database path in production
        if self.database_url.startswith("sqlite+aiosqlite:///./"):
            raise ValueError(
                "Production environment requires absolute database path for SQLite. "
                "Use an absolute path (sqlite+aiosqlite:////absolute/path) or PostgreSQL."
            )

        # Rate limiting cannot be disabled in production (fail closed; the
        # development/test escape hatch is preserved by the early return above).
        if not self.rate_limit_enabled:
            raise ValueError(
                "Production environment requires RATE_LIMIT_ENABLED=true. "
                "Disabling rate limiting in production is not allowed."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


# Project root is the ai-job-search directory
PROJECT_ROOT = Path(__file__).resolve().parents[2]  # backend/app -> backend -> project_root
DATA_DIR = PROJECT_ROOT / "job_scraper"

# Canonical data files
CANONICAL_JOBS_FILE = DATA_DIR / "canonical_jobs.json"
SEEN_JOBS_FILE = DATA_DIR / "seen_jobs.json"
RANKED_JOBS_FILE = DATA_DIR / "ranked_jobs.json"
CHECKPOINTS_FILE = DATA_DIR / "checkpoints.json"
TRACKER_FILE = PROJECT_ROOT / "job_search_tracker.csv"

# Top N files
TOP5_FILE = DATA_DIR / "top5_jobs.json"
TOP10_FILE = DATA_DIR / "top10_jobs.json"

# Scored/verified files
SCORED_JOBS_FILE = DATA_DIR / "scored_jobs.json"
VERIFIED_JOBS_FILE = DATA_DIR / "verified_jobs.json"

# Portal health file (CP15.5)
PORTAL_HEALTH_FILE = DATA_DIR / "portal_health.json"

# Retention constants (mirror from retention.js)
STALE_JOB_DAYS = 28
ACTIVE_POOL_STATES = frozenset([
    "ACTIVE_VERIFIED",
    "ACTIVE_UNVERIFIED",
    "CHANGED",
    "POSTING_CHANGED"
])


@lru_cache(maxsize=1)
def get_project_root() -> Path:
    """Return the project root directory."""
    return PROJECT_ROOT


def get_data_dir() -> Path:
    """Return the job_scraper data directory."""
    return DATA_DIR


def get_upload_dir() -> Path:
    """Resolve the resume upload directory (outside the app source tree).

    Defaults to <project_root>/data/uploads/resumes and can be overridden via
    the UPLOAD_DIR setting/environment variable (used by tests).
    """
    settings = get_settings()
    configured = settings.upload_dir
    if configured:
        return Path(configured)
    return PROJECT_ROOT / "data" / "uploads" / "resumes"


def verify_data_files() -> dict:
    """Check which data files exist."""
    return {
        "canonical_jobs": CANONICAL_JOBS_FILE.exists(),
        "seen_jobs": SEEN_JOBS_FILE.exists(),
        "ranked_jobs": RANKED_JOBS_FILE.exists(),
        "checkpoints": CHECKPOINTS_FILE.exists(),
        "tracker": TRACKER_FILE.exists(),
        "top5": TOP5_FILE.exists(),
        "top10": TOP10_FILE.exists(),
        "scored_jobs": SCORED_JOBS_FILE.exists(),
        "verified_jobs": VERIFIED_JOBS_FILE.exists(),
    }