"""Admin job sources router."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, Field, HttpUrl
from datetime import datetime

from .. import enabled_bridge
from ..audit import log_admin_action
from ..database import get_db_session
from ..models.database_models import User, UserRole, JobSource, JobSourceStatus, JobSourceType
from ..portal_registry import is_known_skill_name
from ..routers.auth import get_current_admin_user
from ..ssrf import (
    BlockedDestinationError,
    validate_outbound_url,
    PinnedTransport,
    safe_destination_summary,
)

router = APIRouter(prefix="/api/admin/sources", tags=["admin-sources"])


# Pydantic schemas
class JobSourceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Unique source identifier (e.g., 'indeed')")
    display_name: str = Field(..., min_length=1, max_length=150, description="Human-readable name (e.g., 'Indeed')")
    base_url: HttpUrl = Field(..., description="Base URL of the job portal")
    source_type: JobSourceType = Field(default=JobSourceType.JOB_BOARD, description="Type of job source")


class JobSourceUpdate(BaseModel):
    display_name: Optional[str] = Field(None, min_length=1, max_length=150)
    source_type: Optional[JobSourceType] = None
    status: Optional[JobSourceStatus] = None
    enabled: Optional[bool] = None
    adapter_name: Optional[str] = Field(None, max_length=100)
    analysis_data: Optional[dict] = None


class JobSourceResponse(BaseModel):
    id: str
    name: str
    display_name: str
    base_url: str
    domain: str
    source_type: str
    status: str
    enabled: bool
    adapter_name: Optional[str]
    health_status: Optional[str]
    last_checked_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class JobSourceListResponse(BaseModel):
    sources: List[JobSourceResponse]
    total: int
    page: int
    page_size: int


class SourceAnalyzeRequest(BaseModel):
    url: HttpUrl = Field(..., description="URL to analyze")
    source_name: Optional[str] = Field(None, max_length=100)


class SourceAnalyzeResponse(BaseModel):
    url: str
    domain: str
    title: Optional[str]
    meta_description: Optional[str]
    platform_detected: Optional[str]
    has_search_form: bool
    has_pagination: bool
    has_json_ld: bool
    robots_txt_status: str
    feasibility: str


# Helper to extract domain from URL
def extract_domain(url: str) -> str:
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return parsed.netloc.lower().replace('www.', '')


@router.get("", response_model=JobSourceListResponse)
async def list_job_sources(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[JobSourceStatus] = None,
    source_type: Optional[JobSourceType] = None,
    enabled: Optional[bool] = None,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_admin_user)
):
    """List all job sources with optional filters."""
    query = select(JobSource)
    count_query = select(func.count()).select_from(JobSource)

    if status:
        query = query.where(JobSource.status == status)
        count_query = count_query.where(JobSource.status == status)
    if source_type:
        query = query.where(JobSource.source_type == source_type)
        count_query = count_query.where(JobSource.source_type == source_type)
    if enabled is not None:
        query = query.where(JobSource.enabled == enabled)
        count_query = count_query.where(JobSource.enabled == enabled)

    query = query.order_by(JobSource.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await session.execute(query)
    sources = result.scalars().all()

    total_result = await session.execute(count_query)
    total = total_result.scalar()

    return JobSourceListResponse(
        sources=[JobSourceResponse.model_validate(s) for s in sources],
        total=total,
        page=page,
        page_size=page_size
    )


@router.post("", response_model=JobSourceResponse, status_code=status.HTTP_201_CREATED)
async def create_job_source(
    source_data: JobSourceCreate,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_admin_user)
):
    """Create a new job source in DISCOVERED state."""
    domain = extract_domain(str(source_data.base_url))

    # Check for duplicate name
    result = await session.execute(select(JobSource).where(JobSource.name == source_data.name))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source with this name already exists"
        )

    # Check for duplicate domain
    result = await session.execute(select(JobSource).where(JobSource.domain == domain))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source with this domain already exists"
        )

    source = JobSource(
        name=source_data.name,
        display_name=source_data.display_name,
        base_url=str(source_data.base_url),
        domain=domain,
        source_type=source_data.source_type,
        status=JobSourceStatus.DISCOVERED,
        enabled=False,
        created_by_user_id=current_user.id,
    )
    session.add(source)
    await session.commit()
    await session.refresh(source)

    return JobSourceResponse.model_validate(source)


@router.get("/{source_id}", response_model=JobSourceResponse)
async def get_job_source(
    source_id: str,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_admin_user)
):
    """Get detailed job source record."""
    result = await session.execute(select(JobSource).where(JobSource.id == source_id))
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job source not found"
        )

    return JobSourceResponse.model_validate(source)


@router.patch("/{source_id}", response_model=JobSourceResponse)
async def update_job_source(
    source_id: str,
    source_data: JobSourceUpdate,
    http_request: Request,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_admin_user)
):
    """Update job source fields, bridging `enabled` changes to the runtime.

    When `enabled` changes the DB row's enabled/status are updated and, for a
    valid known adapter_name, the SKILL.md runtime gate and the portal_health.json
    disable fields are written through (CP16.6). Enabling requires a valid,
    installed adapter — otherwise a clear 4xx with no runtime modifications.
    The DB row is committed first; a later write-through failure triggers
    compensating rollback so no half-consistent enabled state survives.
    """
    result = await session.execute(select(JobSource).where(JobSource.id == source_id))
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job source not found"
        )

    update_data = source_data.model_dump(exclude_unset=True)
    enabling = update_data.get("enabled")
    target_adapter = update_data.get("adapter_name", source.adapter_name)

    # Enabling re-opens the runtime gate, so it must be able to reach a real,
    # installed SKILL.md — otherwise the admin sees an Enabled intent while the
    # runtime is still off, recreating the divergence this bridge exists to fix.
    if enabling is True:
        if not target_adapter or not is_known_skill_name(target_adapter):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot enable: a valid known adapter_name is required (e.g. "
                       "'indeed-search') so the runtime SKILL.md gate can be enabled; "
                       "no files were modified.",
            )
        if not (enabled_bridge.SKILLS_DIR / target_adapter / "SKILL.md").exists():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot enable: no installed portal skill at "
                       f".agents/skills/{target_adapter}/SKILL.md; no files were modified.",
            )

    # Capture prior state for compensating rollback if a write-through fails.
    prev_enabled = source.enabled
    prev_status = source.status
    prev_fields = {f: getattr(source, f) for f in update_data if hasattr(source, f)}

    for field, value in update_data.items():
        setattr(source, field, value)
    if enabling is not None:
        source.status = JobSourceStatus.ENABLED if enabling else JobSourceStatus.DISABLED

    await session.commit()
    await session.refresh(source)

    if enabling is not None and target_adapter and is_known_skill_name(target_adapter):
        skill_written = False
        try:
            if enabling:
                enabled_bridge.set_skill_enabled(target_adapter, True)
                skill_written = True
            else:
                # Disable is tolerant: skip the SKILL.md write if the skill is gone,
                # but never leave DB/health inconsistent once the file write happens.
                if (enabled_bridge.SKILLS_DIR / target_adapter / "SKILL.md").exists():
                    enabled_bridge.set_skill_enabled(target_adapter, False)
                    skill_written = True
            enabled_bridge.update_health_store(target_adapter, enabling)
        except Exception as exc:
            # Compensating rollback: file writes are made after the DB commit, so a
            # failure here must restore both the runtime file and the DB row.
            if skill_written:
                try:
                    enabled_bridge.set_skill_enabled(target_adapter, prev_enabled)
                except Exception:
                    pass
            for field, value in prev_fields.items():
                setattr(source, field, value)
            source.status = prev_status
            await session.commit()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Enabled-state bridge write-through failed; DB and runtime "
                       "state rolled back to their prior values.",
            )

    log_admin_action(
        "source_update",
        user_id=str(current_user.id),
        target_type="source",
        target_id=source_id,
        detail=f"Updated fields: {', '.join(update_data.keys())}",
        ip=http_request.client.host if http_request.client else None,
    )
    return JobSourceResponse.model_validate(source)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job_source(
    source_id: str,
    http_request: Request,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_admin_user)
):
    """Delete or archive an unapproved job source."""
    result = await session.execute(select(JobSource).where(JobSource.id == source_id))
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job source not found"
        )

    # Only allow deletion of unapproved sources (not ENABLED)
    if source.status in (JobSourceStatus.ENABLED, JobSourceStatus.APPROVED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete an approved or enabled source. Disable it first."
        )

    await session.delete(source)
    await session.commit()
    log_admin_action(
        "source_delete",
        user_id=str(current_user.id),
        target_type="source",
        target_id=source_id,
        detail=f"Deleted source '{source.name}'",
        ip=http_request.client.host if http_request.client else None,
    )


@router.post("/analyze", response_model=SourceAnalyzeResponse)
async def analyze_url(
    request: SourceAnalyzeRequest,
    http_request: Request,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_admin_user)
):
    """Run safe non-executing URL analysis on a candidate URL."""
    import httpx
    from bs4 import BeautifulSoup
    from urllib.parse import urlparse, urljoin

    url = str(request.url)
    domain = extract_domain(url)

    # Basic analysis result
    analysis = {
        "url": url,
        "domain": domain,
        "title": None,
        "meta_description": None,
        "platform_detected": None,
        "has_search_form": False,
        "has_pagination": False,
        "has_json_ld": False,
        "robots_txt_status": "not_checked",
        "feasibility": "unknown",
    }

    # SSRF protection: validate scheme + resolve DNS + check resolved IPs
    try:
        validation = validate_outbound_url(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        # Fetch with manual redirect handling (max 3 redirects).  Every request
        # is issued through a PinnedTransport, which connects ONLY to the IP(s)
        # validated at SSRF-check time — no fresh DNS lookup can re-route the
        # connection (no DNS-rebinding TOCTOU).  Each redirect destination is
        # validated and re-pinned before the next hop is followed.
        max_redirects = 3
        current_url = url
        redirect_count = 0
        pinned_hosts = {validation.hostname.lower(): validation.resolved_ips}
        content = None

        while redirect_count <= max_redirects:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(8.0, connect=5.0),
                follow_redirects=False,  # redirects are validated and followed manually
                limits=httpx.Limits(max_connections=1, max_keepalive_connections=1),
                transport=PinnedTransport(pinned_hosts, trust_env=False),
                trust_env=False,  # never route the analysis request through a proxy
            ) as client:
                response = await client.get(current_url, headers={
                    "User-Agent": "CareerPilot-Analyzer/1.0 (+https://careerpilot.local)"
                })

            # Handle redirects manually with full SSRF validation at each hop
            if response.status_code in (301, 302, 303, 307, 308) and redirect_count < max_redirects:
                location = response.headers.get("location")
                if not location:
                    break
                # Resolve relative redirect
                next_url = urljoin(current_url, location)
                # Validate redirect destination (scheme + DNS + IP) BEFORE
                # following. A blocked destination surfaces a clear message;
                # a malformed/unsafe-but-not-blocked redirect is not followed.
                try:
                    next_validation = validate_outbound_url(next_url)
                except BlockedDestinationError as exc:
                    analysis["feasibility"] = f"error: {exc}"
                    return SourceAnalyzeResponse(**analysis)
                except ValueError:
                    analysis["feasibility"] = "redirect_loop"
                    return SourceAnalyzeResponse(**analysis)
                # Re-pin the new hostname to its freshly validated IPs; the
                # next loop iteration opens a fresh transport for that hop.
                current_url = next_url
                pinned_hosts = {next_validation.hostname.lower(): next_validation.resolved_ips}
                redirect_count += 1
                continue

            # Reached a non-redirect response (or the redirect limit).
            if response.status_code in (301, 302, 303, 307, 308):
                # Redirect but max redirects exceeded
                analysis["feasibility"] = "redirect_loop"
                return SourceAnalyzeResponse(**analysis)
            if response.status_code != 200:
                analysis["feasibility"] = "http_error"
                return SourceAnalyzeResponse(**analysis)

            # Content-Type guard: only process HTML
            content_type = response.headers.get("content-type", "").lower()
            if not any(ct in content_type for ct in ("text/html", "application/xhtml+xml")):
                analysis["feasibility"] = "non_html_content"
                return SourceAnalyzeResponse(**analysis)

            content = response.text[:2_000_000]  # Max 2MB
            break

        # Parse HTML
        soup = BeautifulSoup(content, 'lxml')

        # Title
        if soup.title and soup.title.string:
            analysis["title"] = soup.title.string.strip()[:200]

        # Meta description
        meta_desc = soup.find('meta', attrs={'name': 'description'})
        if meta_desc and meta_desc.get('content'):
            analysis["meta_description"] = meta_desc['content'].strip()[:300]

        # Platform detection
        platform_signatures = {
            'workday': ['workday', 'wd-'],
            'greenhouse': ['greenhouse.io', 'greenhouse'],
            'lever': ['lever.co', 'lever'],
            'smartrecruiters': ['smartrecruiters'],
            'taleo': ['taleo'],
            'ashby': ['ashbyhq'],
            'indeed': ['indeed'],
            'jobstreet': ['jobstreet'],
            'linkedin': ['linkedin'],
            'kalibrr': ['kalibrr'],
            'bossjob': ['bossjob'],
        }

        content_lower = content.lower()
        for platform, sigs in platform_signatures.items():
            if any(sig in content_lower for sig in sigs):
                analysis["platform_detected"] = platform
                break

        # Search form detection
        search_forms = soup.find_all('form')
        search_keywords = ['q', 'query', 'k', 'job_title', 'keyword', 'search', 'location', 'l']
        for form in search_forms:
            inputs = form.find_all('input')
            for inp in inputs:
                name = inp.get('name', '').lower()
                if any(kw in name for kw in search_keywords):
                    analysis["has_search_form"] = True
                    break
            if analysis["has_search_form"]:
                break

        # Pagination detection
        pagination_indicators = ['page=', 'offset=', 'start=', 'p=', 'pageNumber=', 'next']
        for link in soup.find_all('a', href=True):
            href = link['href'].lower()
            if any(ind in href for ind in pagination_indicators):
                analysis["has_pagination"] = True
                break

        # JSON-LD JobPosting
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                import json
                data = json.loads(script.string or '{}')
                if isinstance(data, list):
                    data = data[0] if data else {}
                if data.get('@type') == 'JobPosting' or data.get('@type') == 'ItemList':
                    analysis["has_json_ld"] = True
                    break
            except Exception:
                pass

        # Robots.txt check — validated with same SSRF protection and pinned transport
        base_parsed = urlparse(url)
        base_host = base_parsed.hostname or ""
        base_netloc = base_host
        if ":" in base_host and not base_host.startswith("["):
            base_netloc = f"[{base_host}]"
        if base_parsed.port is not None:
            base_netloc = f"{base_netloc}:{base_parsed.port}"
        robots_url = f"{base_parsed.scheme}://{base_netloc}/robots.txt"
        robots_validation = validate_outbound_url(robots_url, allow_redirect=True)
        if robots_validation is not None:
            try:
                robots_hosts = {robots_validation.hostname.lower(): robots_validation.resolved_ips}
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(5.0),
                    transport=PinnedTransport(robots_hosts, trust_env=False),
                    trust_env=False,
                ) as client:
                    robots_resp = await client.get(robots_url)
                    if robots_resp.status_code == 200:
                        analysis["robots_txt_status"] = "found"
                        robots_content = robots_resp.text.lower()
                        if 'disallow' in robots_content and ('/search' in robots_content or '/jobs' in robots_content):
                            analysis["robots_txt_status"] = "restrictive"
                    else:
                        analysis["robots_txt_status"] = "not_found"
            except Exception:
                analysis["robots_txt_status"] = "error"

        # Feasibility assessment
        if analysis["platform_detected"]:
            analysis["feasibility"] = "high_feasibility"
        elif analysis["has_json_ld"]:
            analysis["feasibility"] = "api_available"
        elif analysis["has_search_form"]:
            analysis["feasibility"] = "requires_scraping"
        elif analysis["robots_txt_status"] == "restrictive":
            analysis["feasibility"] = "blocked_by_robots"
        else:
            analysis["feasibility"] = "requires_manual_review"

    except httpx.TimeoutException:
        analysis["feasibility"] = "timeout"
    except httpx.TooManyRedirects:
        analysis["feasibility"] = "redirect_loop"
    except Exception:
        analysis["feasibility"] = "error"

    # Audit: log only safe normalized destination data — scheme, host (never
    # userinfo), optional port, and a bounded path.  Query strings, fragments,
    # access tokens/API keys, and passwords must never reach the audit log.
    safe = safe_destination_summary(url)
    if safe["host"]:
        rendered_host = safe["host"]
        if ":" in rendered_host and not rendered_host.startswith("["):
            rendered_host = f"[{rendered_host}]"
        if safe["port"] is not None:
            rendered_host = f"{rendered_host}:{safe['port']}"
        safe_detail = f"Analysis of {safe['scheme']}://{rendered_host}{safe['path']}"
        safe_target_id = safe["host"]
    else:
        safe_detail = f"Analysis of {safe['scheme']}://{safe['path']}"
        safe_target_id = safe["scheme"] or "unknown"

    log_admin_action(
        "source_analyze",
        user_id=str(current_user.id),
        target_type="source",
        target_id=safe_target_id,
        detail=safe_detail,
        ip=http_request.client.host if http_request.client else None,
    )
    return SourceAnalyzeResponse(**analysis)


@router.post("/{source_id}/analyze", response_model=SourceAnalyzeResponse)
async def analyze_source(
    source_id: str,
    http_request: Request,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_admin_user)
):
    """Trigger safe analysis on an existing registered source."""
    result = await session.execute(select(JobSource).where(JobSource.id == source_id))
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job source not found"
        )

    # Update status to ANALYZING
    source.status = JobSourceStatus.ANALYZING
    await session.commit()

    # Run analysis
    from ..routers.admin_sources import analyze_url, SourceAnalyzeRequest
    analysis_request = SourceAnalyzeRequest(url=source.base_url)
    analysis_result = await analyze_url(analysis_request, http_request, session, current_user)

    # Store analysis data
    source.analysis_data = analysis_result.model_dump()
    source.status = JobSourceStatus.READY_FOR_REVIEW
    await session.commit()

    return analysis_result