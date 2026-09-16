"""Tests for database foundation - Checkpoint 1 verification."""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy import select

from app.database import DatabaseManager, get_db_session
from app.models.database_models import (
    Base, User, UserStatus, Resume, ResumeStatus,
    CandidateProfile, SearchPreferences, SearchRun, SearchRunStatus,
    UserJob, UserJobStatus, Application, ApplicationStatus
)


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    """Create a test database manager with isolated SQLite."""
    import tempfile
    import os
    import uuid

    # Create a unique temporary file for each test to ensure isolation
    db_path = os.path.join(tempfile.gettempdir(), f"test_db_{uuid.uuid4().hex}.db")

    manager = DatabaseManager()
    manager.initialize(f"sqlite+aiosqlite:///{db_path}", echo=False)
    await manager.create_all()
    yield manager
    await manager.drop_all()
    await manager.close()

    # Clean up temp file
    if os.path.exists(db_path):
        os.unlink(db_path)


@pytest_asyncio.fixture
async def session(db_manager):
    """Create a test database session."""
    async with db_manager.session() as session:
        yield session


class TestDatabaseModels:
    """Test database models can be created and queried."""

    async def test_create_user(self, session: AsyncSession):
        """Test creating a user."""
        user = User(
            name="Test User",
            email="test@example.com",
            password_hash="hashed_password_123",
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        assert user.id is not None
        assert user.email == "test@example.com"
        assert user.password_hash == "hashed_password_123"
        assert user.status == UserStatus.ACTIVE
        assert user.created_at is not None
        assert user.updated_at is not None

    async def test_create_resume(self, session: AsyncSession):
        """Test creating a resume linked to user."""
        user = User(
            email="test@example.com",
            password_hash="hashed_password_123",
            name="Test User",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        resume = Resume(
            user_id=user.id,
            original_filename="resume.pdf",
            storage_key="s3://bucket/resume.pdf",
            file_type="application/pdf",
            file_size=1024,
            status=ResumeStatus.UPLOADED,
        )
        session.add(resume)
        await session.commit()
        await session.refresh(resume)

        assert resume.id is not None
        assert resume.user_id == user.id
        assert resume.original_filename == "resume.pdf"

    async def test_user_resume_relationship(self, session: AsyncSession):
        """Test user-resume relationship works."""
        from sqlalchemy.orm import selectinload

        user = User(
            email="test@example.com",
            password_hash="hashed_password_123",
            name="Test User",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        resume1 = Resume(
            user_id=user.id,
            original_filename="resume1.pdf",
            storage_key="s3://bucket/resume1.pdf",
            file_type="application/pdf",
            file_size=1024,
        )
        resume2 = Resume(
            user_id=user.id,
            original_filename="resume2.pdf",
            storage_key="s3://bucket/resume2.pdf",
            file_type="application/pdf",
            file_size=2048,
        )
        session.add_all([resume1, resume2])
        await session.commit()

        # Query user with resumes using eager loading
        result = await session.execute(
            select(User).options(selectinload(User.resumes)).where(User.id == user.id)
        )
        loaded_user = result.scalar_one()

        assert len(loaded_user.resumes) == 2
        assert loaded_user.resumes[0].original_filename in ("resume1.pdf", "resume2.pdf")

    async def test_candidate_profile(self, session: AsyncSession):
        """Test candidate profile creation."""
        user = User(
            email="test@example.com",
            password_hash="hashed_password_123",
            name="Test User",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        profile = CandidateProfile(
            user_id=user.id,
            full_name="Test User",
            headline="Software Engineer",
            location="Manila, Philippines",
            skills='["Python", "FastAPI", "SQLAlchemy"]',
        )
        session.add(profile)
        await session.commit()
        await session.refresh(profile)

        assert profile.id is not None
        assert profile.user_id == user.id
        assert profile.full_name == "Test User"

    async def test_search_preferences(self, session: AsyncSession):
        """Test search preferences creation."""
        user = User(
            email="test@example.com",
            password_hash="hashed_password_123",
            name="Test User",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        prefs = SearchPreferences(
            user_id=user.id,
            target_roles='["Software Engineer", "Backend Developer"]',
            remote_ok=True,
            salary_min=50000,
            salary_max=100000,
        )
        session.add(prefs)
        await session.commit()
        await session.refresh(prefs)

        assert prefs.id is not None
        assert prefs.user_id == user.id
        assert prefs.remote_ok is True

    async def test_search_run(self, session: AsyncSession):
        """Test search run creation."""
        user = User(
            email="test@example.com",
            password_hash="hashed_password_123",
            name="Test User",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        run = SearchRun(
            user_id=user.id,
            status=SearchRunStatus.QUEUED,
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)

        assert run.id is not None
        assert run.user_id == user.id
        assert run.status == SearchRunStatus.QUEUED

    async def test_user_job(self, session: AsyncSession):
        """Test user-job association."""
        user = User(
            email="test@example.com",
            password_hash="hashed_password_123",
            name="Test User",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        user_job = UserJob(
            user_id=user.id,
            job_stable_id="abc123",
            status=UserJobStatus.SAVED,
            notes="Interesting role",
        )
        session.add(user_job)
        await session.commit()
        await session.refresh(user_job)

        assert user_job.id is not None
        assert user_job.job_stable_id == "abc123"
        assert user_job.status == UserJobStatus.SAVED

    async def test_application(self, session: AsyncSession):
        """Test application creation."""
        user = User(
            email="test@example.com",
            password_hash="hashed_password_123",
            name="Test User",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        app = Application(
            user_id=user.id,
            job_stable_id="abc123",
            company="Tech Corp",
            role="Software Engineer",
            status=ApplicationStatus.DRAFT,
        )
        session.add(app)
        await session.commit()
        await session.refresh(app)

        assert app.id is not None
        assert app.company == "Tech Corp"
        assert app.role == "Software Engineer"
        assert app.status == ApplicationStatus.DRAFT

    async def test_cascade_delete_user(self, session: AsyncSession):
        """Test cascade delete when user is deleted."""
        user = User(
            email="test@example.com",
            password_hash="hashed_password_123",
            name="Test User",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        # Add related objects
        resume = Resume(
            user_id=user.id,
            original_filename="resume.pdf",
            storage_key="s3://bucket/resume.pdf",
            file_type="application/pdf",
            file_size=1024,
        )
        profile = CandidateProfile(user_id=user.id, full_name="Test User")
        prefs = SearchPreferences(user_id=user.id)
        run = SearchRun(user_id=user.id)
        user_job = UserJob(user_id=user.id, job_stable_id="abc123")
        application = Application(user_id=user.id, job_stable_id="abc123", company="Test", role="Test")

        session.add_all([resume, profile, prefs, run, user_job, application])
        await session.commit()

        # Delete user - should cascade delete all related objects
        await session.delete(user)
        await session.commit()

        # Verify all related objects are deleted
        assert (await session.execute(select(User).where(User.id == user.id))).scalar_one_or_none() is None
        assert (await session.execute(select(Resume).where(Resume.user_id == user.id))).scalar_one_or_none() is None
        assert (await session.execute(select(CandidateProfile).where(CandidateProfile.user_id == user.id))).scalar_one_or_none() is None
        assert (await session.execute(select(SearchPreferences).where(SearchPreferences.user_id == user.id))).scalar_one_or_none() is None
        assert (await session.execute(select(SearchRun).where(SearchRun.user_id == user.id))).scalar_one_or_none() is None
        assert (await session.execute(select(UserJob).where(UserJob.user_id == user.id))).scalar_one_or_none() is None
        assert (await session.execute(select(Application).where(Application.user_id == user.id))).scalar_one_or_none() is None


class TestDatabaseManager:
    """Test DatabaseManager functionality."""

    async def test_database_manager_init(self, db_manager: DatabaseManager):
        """Test DatabaseManager initialization."""
        assert db_manager.engine is not None
        assert db_manager.session_factory is not None

    async def test_get_session(self, db_manager: DatabaseManager):
        """Test getting a session from DatabaseManager."""
        async with db_manager.session() as session:
            assert session is not None
            # Test query works
            result = await session.execute(select(1))
            assert result.scalar() == 1

    async def test_create_all_tables(self, db_manager: DatabaseManager):
        """Test that all tables are created."""
        # Tables should be created by init() - use async inspector
        from sqlalchemy import inspect
        async with db_manager.engine.connect() as conn:
            # Use run_sync to run the synchronous inspector in the greenlet context
            def get_tables(sync_conn):
                inspector = inspect(sync_conn)
                return inspector.get_table_names()
            tables = await conn.run_sync(get_tables)

            expected_tables = {
                "users", "resumes", "candidate_profiles",
                "search_preferences", "search_runs",
                "user_jobs", "applications"
            }
            for table in expected_tables:
                assert table in tables, f"Table {table} not found"


class TestBackwardCompatibility:
    """Test backward compatibility with existing code."""

    async def test_database_url_config(self):
        """Test config can be loaded."""
        from app.config import get_settings
        settings = get_settings()
        assert settings.database_url is not None
        assert "sqlite" in settings.database_url.lower()

    async def test_models_importable(self):
        """Test all models can be imported."""
        from app.models.database_models import (
            User, Resume, CandidateProfile, SearchPreferences,
            SearchRun, UserJob, Application,
            UserStatus, ResumeStatus, SearchRunStatus,
            UserJobStatus, ApplicationStatus
        )
        # If we get here, imports work
        assert True