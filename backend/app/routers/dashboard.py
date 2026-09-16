"""Dashboard router: authenticated user workspace endpoint."""
import json
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db_session
from ..models.database_models import (
    Application,
    CandidateProfile,
    Resume,
    SearchPreferences,
    SearchRun,
    User,
    UserJob,
)
from ..models.dashboard_schemas import (
    DashboardResponse,
    LastSearchRun,
    NextStep,
    ProfileReadiness,
    SystemOverview,
    UserActivity,
)
from ..models.preferences_schemas import (
    arrangements_from_bools,
    search_preferences_configured,
)
from ..store import get_store, DataStore
from .auth import get_current_user

router = APIRouter(prefix="/api", tags=["dashboard"])

TOTAL_SETUP_STEPS = 3


async def _candidate_profile_populated(session: AsyncSession, user_id: str) -> bool:
    """Check if the candidate profile has meaningful content (not just an empty row)."""
    result = await session.execute(
        select(CandidateProfile).where(CandidateProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return False
    # Consider populated if any key field is set
    return any([
        profile.full_name,
        profile.headline,
        profile.location,
        profile.phone,
        profile.email,
        profile.linkedin_url,
        profile.portfolio_url,
        profile.professional_summary,
        profile.skills,
        profile.experience,
        profile.education,
        profile.certifications,
        profile.languages,
        profile.projects,
    ])


def _parse_json_list(value) -> list:
    """Safely parse a JSON-as-Text column into a list (tolerant of legacy shapes)."""
    if not value:
        return []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return []
        return parsed if isinstance(parsed, list) else []
    return value if isinstance(value, list) else []


async def _search_preferences_configured(session: AsyncSession, user_id: str) -> bool:
    """Honest signal: the user has saved meaningful search preferences."""
    result = await session.execute(
        select(SearchPreferences).where(SearchPreferences.user_id == user_id)
    )
    pref = result.scalar_one_or_none()
    if not pref:
        return False
    return search_preferences_configured(
        target_roles=_parse_json_list(pref.target_roles),
        preferred_locations=_parse_json_list(pref.preferred_locations),
        excluded_keywords=_parse_json_list(pref.excluded_keywords),
        salary_min=pref.salary_min,
        salary_max=pref.salary_max,
        career_direction=pref.career_direction,
        work_arrangements=arrangements_from_bools(pref.remote_ok, pref.hybrid_ok, pref.onsite_ok),
    )


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    store: DataStore = Depends(get_store),
) -> DashboardResponse:
    """Return what this specific user needs to know and do from their workspace."""
    user_id = current_user.id

    async def count(model) -> int:
        result = await session.execute(
            select(func.count()).select_from(model).where(model.user_id == user_id)
        )
        return result.scalar_one()

    resume_count = await count(Resume)
    search_run_count = await count(SearchRun)
    saved_job_count = await count(UserJob)
    application_count = await count(Application)

    # Get last search run for this user
    last_search_result = await session.execute(
        select(SearchRun)
        .where(SearchRun.user_id == user_id)
        .order_by(SearchRun.created_at.desc())
        .limit(1)
    )
    last_search_run = last_search_result.scalar_one_or_none()

    profile_populated = await _candidate_profile_populated(session, user_id)
    preferences_configured = await _search_preferences_configured(session, user_id)

    readiness = ProfileReadiness(
        resume_uploaded=resume_count > 0,
        candidate_profile_configured=profile_populated,
        search_preferences_configured=preferences_configured,
        completed_steps=sum([
            resume_count > 0,
            profile_populated,
            preferences_configured,
        ]),
        total_steps=TOTAL_SETUP_STEPS,
        ready=resume_count > 0 and profile_populated and preferences_configured,
    )

    activity = UserActivity(
        search_run_count=search_run_count,
        saved_job_count=saved_job_count,
        application_count=application_count,
        has_activity=(search_run_count + saved_job_count + application_count) > 0,
    )

    # Global pipeline state — clearly system-level, never presented as user-owned.
    info = store.get_health_info()
    overview = SystemOverview(
        status=info.get("status", "unknown"),
        pipeline_stage=info.get("pipeline_stage"),
        pipeline_status=info.get("pipeline_status"),
        active_jobs=info.get("active_jobs_count"),
        stale_jobs=info.get("stale_jobs_count"),
        blocked_jobs=info.get("blocked_jobs_count"),
    )

    last_search_run_schema = None
    if last_search_run:
        import json
        result_summary = None
        if last_search_run.run_metadata:
            try:
                result_summary = json.loads(last_search_run.run_metadata)
            except Exception:
                pass

        last_search_run_schema = LastSearchRun(
            id=last_search_run.id,
            status=last_search_run.status.value,
            started_at=last_search_run.started_at,
            completed_at=last_search_run.completed_at,
            error=last_search_run.error,
            pipeline_stage=last_search_run.run_metadata and json.loads(last_search_run.run_metadata).get("pipeline_stage") if last_search_run.run_metadata else None,
            result_summary=result_summary,
            created_at=last_search_run.created_at,
        )

    next_steps = _build_next_steps(readiness, activity, overview, last_search_run)

    return DashboardResponse(
        user=current_user,
        profile_readiness=readiness,
        user_activity=activity,
        system_overview=overview,
        next_steps=next_steps,
        last_search_run=last_search_run_schema,
        timestamp=datetime.now(timezone.utc),
    )


def _build_next_steps(
    readiness: ProfileReadiness,
    activity: UserActivity,
    overview: SystemOverview,
    last_search_run: Optional[SearchRun] = None,
) -> list[NextStep]:
    """Recommend setup actions first, then existing-route actions."""
    steps: list[NextStep] = []

    if not readiness.resume_uploaded:
        steps.append(NextStep(
            id="upload_resume",
            label="Upload your resume",
            description="Add your CV so CareerPilot can build a candidate profile for you.",
            href="/resume",
        ))
    if not readiness.candidate_profile_configured:
        steps.append(NextStep(
            id="configure_profile",
            label="Complete your candidate profile",
            description="Confirm your skills and experience so matching is tailored to you.",
            href="/profile",
        ))
    if not readiness.search_preferences_configured:
        steps.append(NextStep(
            id="set_preferences",
            label="Set your search preferences",
            description="Choose target roles, salary, and work arrangement for your search.",
            href="/preferences",
        ))

    # If no search runs yet, suggest starting one (after preferences are configured)
    if activity.search_run_count == 0 and readiness.search_preferences_configured:
        steps.append(NextStep(
            id="start_search",
            label="Start a Job Search",
            description="Run your first job search with your configured preferences.",
            href="/search",
        ))

    if activity.application_count == 0:
        steps.append(NextStep(
            id="track_applications",
            label="Track your applications",
            description="Record the jobs you apply to and keep their status up to date.",
            href="/applications",
        ))

    if overview.active_jobs and overview.active_jobs > 0:
        steps.append(NextStep(
            id="browse_top_jobs",
            label="Browse today's top-ranked jobs",
            description=f"{overview.active_jobs} active jobs are ranked and ready to review.",
            href="/ranked",
        ))

    return steps