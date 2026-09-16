"""Portal identity registry — canonical mapping between base names and SKILL directory names.

This module is the single source of truth for portal name normalization.
CP15.5 health store and SKILL directories use `-search` suffix.
Seen_jobs and portal CLIs use base names.
This registry makes the mapping explicit and deterministic.
"""

from typing import Dict, List, Optional

# Canonical mapping: base name (seen_jobs, CLI) -> SKILL directory / health store key
PORTAL_BASE_TO_SKILL: Dict[str, str] = {
    "indeed": "indeed-search",
    "jobstreet": "jobstreet-search",
    "kalibrr": "kalibrr-search",
    "bossjob": "bossjob-search",
    "linkedin": "linkedin-search",
    "freehire": "freehire-search",
    "jobbank": "jobbank-search",
    "jobdanmark": "jobdanmark-search",
    "jobindex": "jobindex-search",
    "jobnet": "jobnet-search",
}

# Reverse mapping for convenience
PORTAL_SKILL_TO_BASE: Dict[str, str] = {v: k for k, v in PORTAL_BASE_TO_SKILL.items()}

# All known portal skill names (health store keys)
ALL_PORTAL_SKILL_NAMES: List[str] = list(PORTAL_BASE_TO_SKILL.values())

# All known portal base names (seen_jobs/CLI keys)
ALL_PORTAL_BASE_NAMES: List[str] = list(PORTAL_BASE_TO_SKILL.keys())


def base_to_skill(base_name: str) -> Optional[str]:
    """Convert a base portal name to its SKILL directory / health store key.

    Returns None if the base name is not recognized.
    """
    return PORTAL_BASE_TO_SKILL.get(base_name)


def skill_to_base(skill_name: str) -> Optional[str]:
    """Convert a SKILL directory / health store key to its base portal name.

    Returns None if the skill name is not recognized.
    """
    return PORTAL_SKILL_TO_BASE.get(skill_name)


def is_known_skill_name(name: str) -> bool:
    """Check if a name is a known portal skill name (health store key)."""
    return name in PORTAL_BASE_TO_SKILL.values()


def is_known_base_name(name: str) -> bool:
    """Check if a name is a known portal base name (seen_jobs/CLI key)."""
    return name in PORTAL_BASE_TO_SKILL.keys()


def normalize_portal_name(name: str) -> str:
    """Normalize a portal name to its SKILL/health store form.

    If the name is a known base name, returns the skill name.
    If the name is already a known skill name, returns it unchanged.
    Otherwise returns the input as-is (allows future portals without registry updates).
    """
    if name in PORTAL_BASE_TO_SKILL:
        return PORTAL_BASE_TO_SKILL[name]
    if name in PORTAL_BASE_TO_SKILL.values():
        return name
    # Unknown portal — pass through (e.g., future portals not yet in registry)
    return name


def get_portal_display_name(skill_name: str) -> str:
    """Get a human-readable display name for a portal skill name."""
    base = skill_to_base(skill_name) or skill_name
    return base.replace("-", " ").title()