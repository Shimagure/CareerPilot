"""CP16.6 enabled-state bridge between JobSource DB rows and the CP15.5 runtime.

Bridges three representations of a portal's enabled state:
  * job_sources.enabled/status  — administrative intent (SQLite, SQLAlchemy)
  * SKILL.md frontmatter enabled — runtime gate consumed by the /job-scraper skill
  * portal_health.json disabled fields — CP15.5 event bookkeeping

Two of the three writes here (SKILL.md, portal_health.json) replicate the
CP15.5 node-side edit semantics exactly: preserve comment suffixes
byte-for-byte, insert a missing `enabled` key as the first frontmatter key, and
refuse (raise) when a SKILL.md has no YAML frontmatter at all. Callers are
responsible for compensating a partial failure (filesystem + SQLite are not one
atomic transaction). All reads are defensive and return None instead of raising.
"""
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.config import PORTAL_HEALTH_FILE, get_project_root, get_settings
from app.portal_registry import skill_to_base

SKILLS_DIR = get_project_root() / ".agents" / "skills"

STANDARD_COMMENT = "  # set to false to keep this portal installed but have /scrape skip it"

# CP15.5 frontmatter regexes (byte-for-byte mirrors of the node implementation).
FM_RE = re.compile(r"^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)")
ENABLED_LINE_RE = re.compile(r"^(enabled:)(\s*)(true|false)([^\r\n]*)$", re.MULTILINE)


def _now_iso() -> str:
    """ISO-8601 UTC timestamp matching the node toISO() format (ms, Z suffix)."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_enabled_from_content(content: str) -> Optional[bool]:
    """Read the frontmatter `enabled` boolean; None when absent or no frontmatter."""
    fm = FM_RE.search(content)
    if not fm:
        return None
    lm = ENABLED_LINE_RE.search(fm.group(1))
    if not lm:
        return None
    return lm.group(3) == "true"


def set_enabled_in_content(content: str, enabled: bool) -> str:
    """Change ONLY the `enabled` boolean in SKILL.md content.

    Preserves the existing line's comment suffix byte-for-byte; inserts a
    missing `enabled` key as the first frontmatter key; raises (unsafe) when
    there is no YAML frontmatter at all.
    """
    fm = FM_RE.search(content)
    if not fm:
        raise ValueError("portal SKILL.md has no YAML frontmatter; refusing to edit (unsafe)")
    prefix_len = fm.group(0).index("\n") + 1  # length of the opening "---\n"
    body_start = fm.start() + prefix_len
    body = fm.group(1)
    lm = ENABLED_LINE_RE.search(body)
    bool_str = "true" if enabled else "false"
    if lm:
        abs_start = body_start + lm.start()
        abs_end = abs_start + len(lm.group(0))
        replacement = f"{lm.group(1)}{lm.group(2)}{bool_str}{lm.group(4)}"
        return content[:abs_start] + replacement + content[abs_end:]
    line = f"enabled: {bool_str}{STANDARD_COMMENT}"
    return content[:body_start] + line + "\n" + content[body_start:]


def read_skill_enabled(skill_name: str) -> Optional[bool]:
    """Defensive read of a portal's SKILL.md frontmatter `enabled`. None on any failure."""
    skill_path = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_path.exists():
        return None
    try:
        content = skill_path.read_text(encoding="utf-8")
    except OSError:
        return None
    return parse_enabled_from_content(content)


def set_skill_enabled(skill_name: str, enabled: bool) -> bool:
    """Atomically set a portal's SKILL.md `enabled` to the given value.

    Idempotent: returns without writing when the value is already equal (no
    file churn). Raises on any failure so a half-updated file never survives
    silently.
    """
    skill_path = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_path.exists():
        raise FileNotFoundError(f"portal SKILL.md not found: {skill_path}")
    try:
        content = skill_path.read_text(encoding="utf-8")
    except OSError as e:
        raise OSError(f"cannot read SKILL.md {skill_path}: {e}") from e
    if parse_enabled_from_content(content) == enabled:
        return enabled  # idempotent, no file churn

    next_content = set_enabled_in_content(content, enabled)
    tmp_path = skill_path.with_name(skill_path.name + ".tmp")
    try:
        tmp_path.write_text(next_content, encoding="utf-8")
        tmp_path.replace(skill_path)  # atomic rename on the same filesystem
    except OSError as e:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise OSError(f"failed to write SKILL.md {skill_path}: {e}") from e
    if read_skill_enabled(skill_name) != enabled:
        raise RuntimeError(f"SKILL.md enabled verification failed for {skill_name}")
    return enabled


def default_portal_state(skill_name: str) -> dict:
    """Minimal portal_health.json entry (mirrors the node defaultPortalState)."""
    return {
        "name": skill_name,
        "observations": [],
        "counts": {"success": 0, "explicit_403_blocked": 0, "inconclusive": 0, "total_observed": 0},
        "status": "insufficient_evidence",
        "window": {"explicit_403_blocked": 0, "success": 0, "inconclusive": 0, "total_observed": 0, "block_rate_percent": None},
        "disabled": False,
        "disabled_at": None,
        "disabled_reason": None,
    }


def _load_health_store() -> dict:
    """Load portal_health.json, preserving everything that is already in it.

    A missing file yields a fresh base store (CP15.5 loadHealth create:true).
    A malformed store raises — we refuse to clobber unreadable state silently.
    """
    if PORTAL_HEALTH_FILE.exists():
        try:
            data = json.loads(PORTAL_HEALTH_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            raise ValueError(f"refusing to edit invalid portal health file {PORTAL_HEALTH_FILE}: {e}") from e
        if not isinstance(data, dict):
            raise ValueError(f"refusing to edit invalid portal health file {PORTAL_HEALTH_FILE}: not an object")
        return data
    return {
        "schema_version": "1.0",
        "rolling_window_days": 7,
        "disable_threshold_percent": 50,
        "updated_at": None,
        "portals": {},
    }


def _save_health_store(data: dict) -> None:
    """Atomically persist portal_health.json (temp file + rename)."""
    tmp_path = PORTAL_HEALTH_FILE.with_name(PORTAL_HEALTH_FILE.name + ".tmp")
    tmp_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(PORTAL_HEALTH_FILE)


def update_health_store(skill_name: str, enabled: bool) -> None:
    """Mirror an enabled change into portal_health.json disabled fields.

    Idempotent: when the portal's `disabled` flag already equals (not enabled),
    nothing is written and all existing data (observations/window/counts/status)
    is preserved. Enable clears the disable fields; disable sets them with
    reason "admin disable".
    """
    data = _load_health_store()
    portals = data.setdefault("portals", {})
    portal_pre_existed = skill_name in portals
    entry = portals.setdefault(skill_name, default_portal_state(skill_name))
    new_disabled = not enabled
    if portal_pre_existed and entry.get("disabled") is new_disabled:
        return  # idempotent — preserve everything
    entry["disabled"] = new_disabled
    if enabled:
        entry["disabled_at"] = None
        entry["disabled_reason"] = None
    else:
        entry["disabled_at"] = _now_iso()
        entry["disabled_reason"] = "admin disable"
    data["updated_at"] = _now_iso()
    _save_health_store(data)


def _db_path() -> Optional[Path]:
    """Resolve the SQLite DB path from settings (defensive; None on any issue)."""
    try:
        url = get_settings().database_url
    except Exception:
        return None
    if not url or not url.startswith("sqlite"):
        return None
    if ":///" in url:
        rest = url.split(":///", 1)[1]
    elif "://" in url:
        rest = url.split("://", 1)[1]
    else:
        rest = url
    rest = rest.split("?", 1)[0]
    if not rest or rest == ":memory:":
        return None
    path = Path(rest)
    if not path.is_absolute():
        # The API engine resolves a relative sqlite URL against its cwd (backend/).
        path = get_project_root() / "backend" / path
    return path


def _fetch_enabled(conn: sqlite3.Connection, column: str, values) -> Optional[bool]:
    placeholders = ",".join("?" for _ in values)
    cur = conn.execute(f"SELECT enabled FROM job_sources WHERE {column} IN ({placeholders}) LIMIT 1", values)
    row = cur.fetchone()
    if row is None:
        return None
    val = row[0]
    if isinstance(val, bool):
        return val
    if isinstance(val, int):
        return bool(val)
    return None


def read_job_source_enabled(skill_name: str, db_path: Optional[Path] = None) -> Optional[bool]:
    """Read the DB `enabled` flag for a portal skill name. Defensive: None on any error.

    Matches by adapter_name first (what the admin bridge writes), then by the
    base `name` (via the portal registry) for legacy rows. Opens the DB
    read-only with a short timeout.
    """
    try:
        path = db_path or _db_path()
        if path is None or not path.exists() or not path.is_file():
            return None
        conn = sqlite3.connect(str(path), timeout=2.0)
        conn.execute("PRAGMA query_only = ON")
        try:
            adapters = [skill_name]
            base = skill_to_base(skill_name)
            if base:
                adapters.append(base)
            row = _fetch_enabled(conn, "adapter_name", adapters)
            if row is None:
                row = _fetch_enabled(conn, "name", [skill_name, base] if base else [skill_name])
            return row
        finally:
            conn.close()
    except Exception:
        return None