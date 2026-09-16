"""Tests for configuration validation (P2 - Production Configuration)."""
import os
import tempfile
from pathlib import Path
import pytest
from unittest.mock import patch

from app.config import Settings, get_settings


class TestSettingsValidation:
    """Test Settings validation logic."""

    def test_default_development_settings(self):
        """Test that development settings load with defaults."""
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.environment == "development"
            assert settings.secret_key == "dev-secret-change-in-production"
            assert settings.cors_allowed_origins == "*"
            assert settings.database_url == "sqlite+aiosqlite:///./careerpilot.db"

    def test_environment_validation_accepts_valid(self):
        """Test that valid environments are accepted."""
        for env in ["development", "production"]:
            with patch.dict(os.environ, {"ENVIRONMENT": env}, clear=True):
                settings = Settings()
                assert settings.environment == env

    def test_environment_validation_rejects_invalid(self):
        """Test that invalid environments are rejected."""
        with patch.dict(os.environ, {"ENVIRONMENT": "staging"}, clear=True):
            with pytest.raises(ValueError, match="environment must be one of"):
                Settings()

    def test_cors_origins_parsing_single(self):
        """Test CORS origins parsing with single origin."""
        with patch.dict(os.environ, {"CORS_ALLOWED_ORIGINS": "https://app.example.com"}, clear=True):
            settings = Settings()
            assert settings.cors_origins_list == ["https://app.example.com"]

    def test_cors_origins_parsing_multiple(self):
        """Test CORS origins parsing with multiple origins."""
        with patch.dict(os.environ, {"CORS_ALLOWED_ORIGINS": "https://app.example.com,https://admin.example.com"}, clear=True):
            settings = Settings()
            assert settings.cors_origins_list == ["https://app.example.com", "https://admin.example.com"]

    def test_cors_origins_parsing_with_spaces(self):
        """Test CORS origins parsing handles spaces around commas."""
        with patch.dict(os.environ, {"CORS_ALLOWED_ORIGINS": "https://app.example.com, https://admin.example.com"}, clear=True):
            settings = Settings()
            assert settings.cors_origins_list == ["https://app.example.com", "https://admin.example.com"]

    def test_cors_origins_wildcard(self):
        """Test CORS wildcard parsing."""
        with patch.dict(os.environ, {"CORS_ALLOWED_ORIGINS": "*"}, clear=True):
            settings = Settings()
            assert settings.cors_origins_list == ["*"]

    def test_is_production_property(self):
        """Test is_production computed property."""
        with patch.dict(os.environ, {"ENVIRONMENT": "production"}, clear=True):
            settings = Settings()
            assert settings.is_production is True

        with patch.dict(os.environ, {"ENVIRONMENT": "development"}, clear=True):
            settings = Settings()
            assert settings.is_production is False


class TestProductionConfigValidation:
    """Test production configuration validation."""

    def test_development_passes_validation(self):
        """Test that development environment passes validation (no-op)."""
        with patch.dict(os.environ, {"ENVIRONMENT": "development"}, clear=True):
            settings = Settings()
            # Should not raise
            settings.validate_production_config()

    def test_production_rejects_default_secret(self):
        """Test that production rejects the default development secret."""
        with patch.dict(os.environ, {"ENVIRONMENT": "production", "SECRET_KEY": "dev-secret-change-in-production"}, clear=True):
            settings = Settings()
            with pytest.raises(ValueError, match="Production environment requires an explicit SECRET_KEY"):
                settings.validate_production_config()

    def test_production_accepts_custom_secret(self):
        """Test that production accepts a custom secret key."""
        with patch.dict(os.environ, {
            "ENVIRONMENT": "production",
            "SECRET_KEY": "strong-random-secret-key-32-chars-min",
            "CORS_ALLOWED_ORIGINS": "https://app.example.com",
            "DATABASE_URL": "postgresql+asyncpg://user:pass@localhost:5432/dbname"
        }, clear=True):
            settings = Settings()
            # Should not raise
            settings.validate_production_config()

    def test_production_rejects_wildcard_cors(self):
        """Test that production rejects wildcard CORS with credentials."""
        with patch.dict(os.environ, {
            "ENVIRONMENT": "production",
            "SECRET_KEY": "strong-random-secret-key-32-chars-min",
            "CORS_ALLOWED_ORIGINS": "*"
        }, clear=True):
            settings = Settings()
            with pytest.raises(ValueError, match="Production environment requires explicit CORS_ALLOWED_ORIGINS"):
                settings.validate_production_config()

    def test_production_accepts_explicit_cors(self):
        """Test that production accepts explicit CORS origins."""
        with patch.dict(os.environ, {
            "ENVIRONMENT": "production",
            "SECRET_KEY": "strong-random-secret-key-32-chars-min",
            "CORS_ALLOWED_ORIGINS": "https://app.example.com,https://admin.example.com",
            "DATABASE_URL": "postgresql+asyncpg://user:pass@localhost:5432/dbname"
        }, clear=True):
            settings = Settings()
            # Should not raise
            settings.validate_production_config()

    def test_production_rejects_relative_sqlite_path(self):
        """Test that production rejects relative SQLite database path."""
        with patch.dict(os.environ, {
            "ENVIRONMENT": "production",
            "SECRET_KEY": "strong-random-secret-key-32-chars-min",
            "CORS_ALLOWED_ORIGINS": "https://app.example.com",
            "DATABASE_URL": "sqlite+aiosqlite:///./careerpilot.db"
        }, clear=True):
            settings = Settings()
            with pytest.raises(ValueError, match="Production environment requires absolute database path for SQLite"):
                settings.validate_production_config()

    def test_production_accepts_absolute_sqlite_path(self):
        """Test that production accepts absolute SQLite database path."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "careerpilot.db"
            with patch.dict(os.environ, {
                "ENVIRONMENT": "production",
                "SECRET_KEY": "strong-random-secret-key-32-chars-min",
                "CORS_ALLOWED_ORIGINS": "https://app.example.com",
                "DATABASE_URL": f"sqlite+aiosqlite:///{db_path}"
            }, clear=True):
                settings = Settings()
                # Should not raise
                settings.validate_production_config()

    def test_production_accepts_postgresql(self):
        """Test that production accepts PostgreSQL URL."""
        with patch.dict(os.environ, {
            "ENVIRONMENT": "production",
            "SECRET_KEY": "strong-random-secret-key-32-chars-min",
            "CORS_ALLOWED_ORIGINS": "https://app.example.com",
            "DATABASE_URL": "postgresql+asyncpg://user:pass@localhost:5432/dbname"
        }, clear=True):
            settings = Settings()
            # Should not raise
            settings.validate_production_config()

    def test_development_allows_relative_sqlite_path(self):
        """Test that development allows relative SQLite database path."""
        with patch.dict(os.environ, {
            "ENVIRONMENT": "development",
            "DATABASE_URL": "sqlite+aiosqlite:///./careerpilot.db"
        }, clear=True):
            settings = Settings()
            # Should not raise
            settings.validate_production_config()


class TestRateLimitProductionInvariant:
    """Production rate-limiting invariant (P3.4): production cannot disable
    rate limiting; development/tests retain the escape hatch."""

    _VALID_PROD = {
        "ENVIRONMENT": "production",
        "SECRET_KEY": "strong-random-secret-key-32-chars-min",
        "CORS_ALLOWED_ORIGINS": "https://app.example.com",
        "DATABASE_URL": "postgresql+asyncpg://user:pass@localhost:5432/dbname",
    }

    def test_production_rejects_rate_limit_disabled(self):
        """Production + RATE_LIMIT_ENABLED=false fails closed with a clear error."""
        env = dict(self._VALID_PROD, RATE_LIMIT_ENABLED="false")
        with patch.dict(os.environ, env, clear=True):
            settings = Settings()
            with pytest.raises(ValueError, match="RATE_LIMIT_ENABLED"):
                settings.validate_production_config()

    def test_production_accepts_rate_limit_enabled(self):
        """Production + RATE_LIMIT_ENABLED=true passes validation."""
        env = dict(self._VALID_PROD, RATE_LIMIT_ENABLED="true")
        with patch.dict(os.environ, env, clear=True):
            settings = Settings()
            settings.validate_production_config()
            assert settings.rate_limit_enabled is True

    def test_development_allows_rate_limit_disabled(self):
        """Development/test may disable rate limiting (escape hatch preserved)."""
        with patch.dict(os.environ, {
            "ENVIRONMENT": "development",
            "RATE_LIMIT_ENABLED": "false",
        }, clear=True):
            settings = Settings()
            settings.validate_production_config()
            assert settings.rate_limit_enabled is False


class TestGetSettingsCaching:
    """Test get_settings caching behavior."""

    def test_get_settings_returns_cached_instance(self):
        """Test that get_settings returns cached instance."""
        get_settings.cache_clear()
        with patch.dict(os.environ, {"SECRET_KEY": "test-secret"}, clear=True):
            settings1 = get_settings()
            settings2 = get_settings()
            assert settings1 is settings2

    def test_get_settings_cache_can_be_cleared(self):
        """Test that cache can be cleared for testing."""
        get_settings.cache_clear()
        with patch.dict(os.environ, {"SECRET_KEY": "test-secret-1"}, clear=True):
            settings1 = get_settings()
            assert settings1.secret_key == "test-secret-1"

        get_settings.cache_clear()

        with patch.dict(os.environ, {"SECRET_KEY": "test-secret-2"}, clear=True):
            settings2 = get_settings()
            assert settings2.secret_key == "test-secret-2"
            assert settings1 is not settings2


class TestUploadDirResolution:
    """Test upload directory resolution."""

    def test_upload_dir_uses_configured_path(self):
        """Test that configured UPLOAD_DIR is used."""
        with tempfile.TemporaryDirectory() as tmpdir:
            get_settings.cache_clear()
            with patch.dict(os.environ, {"UPLOAD_DIR": tmpdir}, clear=True):
                from app.config import get_upload_dir
                upload_dir = get_upload_dir()
                assert upload_dir == Path(tmpdir)

    def test_upload_dir_defaults_to_project_data(self):
        """Test that default upload dir is project_root/data/uploads/resumes."""
        get_settings.cache_clear()
        with patch.dict(os.environ, {}, clear=True):
            # Clear the cache to pick up new settings
            get_settings.cache_clear()
            from app.config import get_upload_dir
            upload_dir = get_upload_dir()
            # Should be project_root/data/uploads/resumes
            expected = Path(__file__).resolve().parents[2] / "data" / "uploads" / "resumes"
            assert upload_dir == expected


class TestDataDirConstants:
    """Test data directory constants."""

    def test_data_dir_points_to_job_scraper(self):
        """Test DATA_DIR points to job_scraper directory."""
        from app.config import DATA_DIR
        expected = Path(__file__).resolve().parents[2] / "job_scraper"
        assert DATA_DIR == expected

    def test_canonical_files_exist(self):
        """Test that canonical file constants are defined."""
        from app.config import (
            CANONICAL_JOBS_FILE, SEEN_JOBS_FILE, RANKED_JOBS_FILE,
            CHECKPOINTS_FILE, TRACKER_FILE, TOP5_FILE, TOP10_FILE,
            SCORED_JOBS_FILE, VERIFIED_JOBS_FILE, PORTAL_HEALTH_FILE
        )
        # All should be Path objects
        for path in [CANONICAL_JOBS_FILE, SEEN_JOBS_FILE, RANKED_JOBS_FILE,
                     CHECKPOINTS_FILE, TRACKER_FILE, TOP5_FILE, TOP10_FILE,
                     SCORED_JOBS_FILE, VERIFIED_JOBS_FILE, PORTAL_HEALTH_FILE]:
            assert isinstance(path, Path)


class TestVerifyDataFiles:
    """Test verify_data_files function."""

    def test_verify_data_files_returns_dict(self):
        """Test that verify_data_files returns a dict with expected keys."""
        from app.config import verify_data_files
        result = verify_data_files()
        assert isinstance(result, dict)
        expected_keys = {
            "canonical_jobs", "seen_jobs", "ranked_jobs", "checkpoints",
            "tracker", "top5", "top10", "scored_jobs", "verified_jobs"
        }
        assert set(result.keys()) == expected_keys
        # All values should be booleans
        for value in result.values():
            assert isinstance(value, bool)


class TestSettingsFields:
    """Test individual settings fields."""

    def test_database_echo_default(self):
        """Test database_echo defaults to False."""
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.database_echo is False

    def test_database_echo_can_be_enabled(self):
        """Test database_echo can be enabled."""
        with patch.dict(os.environ, {"DATABASE_ECHO": "true"}, clear=True):
            settings = Settings()
            assert settings.database_echo is True

    def test_max_resume_size_mb_default(self):
        """Test max_resume_size_mb defaults to 10."""
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.max_resume_size_mb == 10

    def test_max_resume_size_mb_custom(self):
        """Test max_resume_size_mb can be customized."""
        with patch.dict(os.environ, {"MAX_RESUME_SIZE_MB": "25"}, clear=True):
            settings = Settings()
            assert settings.max_resume_size_mb == 25

    def test_llm_provider_default(self):
        """Test llm_provider defaults to openai."""
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.llm_provider == "openai"

    def test_llm_provider_can_be_anthropic(self):
        """Test llm_provider can be set to anthropic."""
        with patch.dict(os.environ, {"LLM_PROVIDER": "anthropic"}, clear=True):
            settings = Settings()
            assert settings.llm_provider == "anthropic"

    def test_openai_model_default(self):
        """Test openai_model defaults to gpt-4o-mini."""
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.openai_model == "gpt-4o-mini"

    def test_anthropic_model_default(self):
        """Test anthropic_model defaults to claude-3-5-haiku-20241022."""
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.anthropic_model == "claude-3-5-haiku-20241022"

    def test_algorithm_default(self):
        """Test algorithm defaults to HS256."""
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.algorithm == "HS256"

    def test_access_token_expire_minutes_default(self):
        """Test access_token_expire_minutes defaults to 30."""
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.access_token_expire_minutes == 30