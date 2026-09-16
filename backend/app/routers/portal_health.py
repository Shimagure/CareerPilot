"""Portal health router — PRIVATE: requires authentication.

Endpoints:
  GET /api/health/portals              — list all portal health statuses (authenticated)
  GET /api/health/portals/{portal_name} — single portal detail with observations (authenticated)

Both endpoints require authentication to protect real portal health data.
No mutations — CP15.5 owns all writes via portal_health.js CLI.
"""
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends

from app.config import PORTAL_HEALTH_FILE, get_project_root
from app import enabled_bridge
from app.models.schemas import (
    PortalHealthCounts,
    PortalHealthListResponse,
    PortalHealthObservation,
    PortalHealthResponse,
    PortalHealthStatus,
    PortalHealthWindow,
)
from app.portal_registry import (
    ALL_PORTAL_SKILL_NAMES,
    get_portal_display_name,
    is_known_skill_name,
    normalize_portal_name,
)
from .auth import get_current_user
from ..models.database_models import User

router = APIRouter(prefix="/api/health", tags=["health", "portals"])

# Path to portal SKILL directories
SKILLS_DIR = get_project_root() / ".agents" / "skills"

# Frontmatter regex for YAML frontmatter extraction
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
ENABLED_RE = re.compile(r"^enabled:\s*(true|false)\b", re.MULTILINE | re.IGNORECASE)


def _read_json_safe(path: Path) -> Optional[Dict[str, Any]]:
    """Safely read and parse JSON file. Returns None if missing or malformed."""
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _read_skill_enabled(portal_skill_name: str) -> Optional[bool]:
    """Read the `enabled` key from a portal's SKILL.md frontmatter.

    Returns True/False if found and parseable, None if file missing,
    no frontmatter, or enabled key not present.
    """
    skill_path = SKILLS_DIR / portal_skill_name / "SKILL.md"
    if not skill_path.exists():
        return None

    try:
        content = skill_path.read_text(encoding="utf-8")
    except OSError:
        return None

    # Extract YAML frontmatter
    match = FRONTMATTER_RE.match(content)
    if not match:
        return None

    frontmatter = match.group(1)

    # Find enabled: true/false line
    enabled_match = ENABLED_RE.search(frontmatter)
    if not enabled_match:
        return None

    value = enabled_match.group(1).lower()
    return value == "true"


def _load_portal_health() -> Dict[str, Any]:
    """Load portal health data from portal_health.json."""
    data = _read_json_safe(PORTAL_HEALTH_FILE)
    if not data or not isinstance(data, dict):
        return {"schema_version": "1.0", "portals": {}}
    return data


def _build_portal_status(portal_data: Dict[str, Any], portal_skill_name: str) -> PortalHealthStatus:
    """Build PortalHealthStatus from health store data + SKILL.md enabled state."""
    skill_path = SKILLS_DIR / portal_skill_name / "SKILL.md"
    skill_present = skill_path.exists()
    # Get enabled state from SKILL.md (source of truth for current enabled state)
    skill_enabled = _read_skill_enabled(portal_skill_name)
    # DB administrative intent (best-effort; None when no DB/table/row).
    job_source_enabled = enabled_bridge.read_job_source_enabled(portal_skill_name)

    # Extract observations
    observations = []
    for obs in portal_data.get("observations", []):
        observations.append(PortalHealthObservation(
            evidence_id=obs.get("evidence_id", ""),
            observed_at=obs.get("observed_at", ""),
            result=obs.get("result", ""),
            source=obs.get("source", "seen_jobs"),
        ))

    # Extract counts
    counts_data = portal_data.get("counts", {})
    counts = PortalHealthCounts(
        success=counts_data.get("success", 0),
        explicit_403_blocked=counts_data.get("explicit_403_blocked", 0),
        inconclusive=counts_data.get("inconclusive", 0),
        total_observed=counts_data.get("total_observed", 0),
    )

    # Extract window
    window_data = portal_data.get("window", {})
    window = PortalHealthWindow(
        explicit_403_blocked=window_data.get("explicit_403_blocked", 0),
        success=window_data.get("success", 0),
        inconclusive=window_data.get("inconclusive", 0),
        total_observed=window_data.get("total_observed", 0),
        block_rate_percent=window_data.get("block_rate_percent"),
    )

    return PortalHealthStatus(
        name=portal_skill_name,
        display_name=get_portal_display_name(portal_skill_name),
        observations=observations,
        counts=counts,
        status=portal_data.get("status", "insufficient_evidence"),
        window=window,
        disabled=portal_data.get("disabled", False),
        disabled_at=portal_data.get("disabled_at"),
        disabled_reason=portal_data.get("disabled_reason"),
        skill_enabled=skill_enabled,
        skill_present=skill_present,
        job_source_enabled=job_source_enabled,
    )


@router.get("/portals", response_model=PortalHealthListResponse)
def list_portal_health(current_user: User = Depends(get_current_user)) -> PortalHealthListResponse:
    """List health status for all known portals (authenticated).

    Returns current health state from portal_health.json enriched with
    live SKILL.md enabled status. No computation — purely exposing
    the state produced by CP15.5.
    """
    health_data = _load_portal_health()
    portals_data = health_data.get("portals", {})

    portal_statuses = []
    summary = {"ok": 0, "blocked": 0, "insufficient_evidence": 0, "disabled": 0}

    for portal_skill_name in ALL_PORTAL_SKILL_NAMES:
        portal_data = portals_data.get(portal_skill_name, {})
        # Ensure minimal structure for unknown/missing portals
        if not portal_data:
            portal_data = {
                "name": portal_skill_name,
                "observations": [],
                "counts": {"success": 0, "explicit_403_blocked": 0, "inconclusive": 0, "total_observed": 0},
                "status": "insufficient_evidence",
                "window": {"explicit_403_blocked": 0, "success": 0, "inconclusive": 0, "total_observed": 0, "block_rate_percent": None},
                "disabled": False,
                "disabled_at": None,
                "disabled_reason": None,
            }

        status = _build_portal_status(portal_data, portal_skill_name)
        portal_statuses.append(status)

        # Update summary
        if status.disabled:
            summary["disabled"] += 1
        else:
            summary[status.status] = summary.get(status.status, 0) + 1

    return PortalHealthListResponse(
        portals=portal_statuses,
        summary=summary,
        rolling_window_days=health_data.get("rolling_window_days", 7),
        disable_threshold_percent=health_data.get("disable_threshold_percent", 50),
        updated_at=health_data.get("updated_at"),
    )


@router.get("/portals/{portal_name}", response_model=PortalHealthResponse)
def get_portal_health(
    portal_name: str,
    current_user: User = Depends(get_current_user)
) -> PortalHealthResponse:
    """Get detailed health status for a single portal (authenticated).

    Accepts either base name (e.g., "indeed") or skill name (e.g., "indeed-search").
    Returns 404 for unknown portal names.
    """
    portal_skill_name = normalize_portal_name(portal_name)

    if not is_known_skill_name(portal_skill_name):
        raise HTTPException(
            status_code=404,
            detail=f"Unknown portal: {portal_name}. Known portals: {', '.join(ALL_PORTAL_SKILL_NAMES)}"
        )

    health_data = _load_portal_health()
    portals_data = health_data.get("portals", {})
    portal_data = portals_data.get(portal_skill_name, {})

    if not portal_data:
        portal_data = {
            "name": portal_skill_name,
            "observations": [],
            "counts": {"success": 0, "explicit_403_blocked": 0, "inconclusive": 0, "total_observed": 0},
            "status": "insufficient_evidence",
            "window": {"explicit_403_blocked": 0, "success": 0, "inconclusive": 0, "total_observed": 0, "block_rate_percent": None},
            "disabled": False,
            "disabled_at": None,
            "disabled_reason": None,
        }

    status = _build_portal_status(portal_data, portal_skill_name)
    return PortalHealthResponse(portal=status)