"""Security audit logging for authentication and admin events.

Provides a structured, bounded audit log for security-relevant events:
  - Authentication: login success/failure, registration
  - Admin actions: source updates, source deletion, source analysis

Events are written as JSON lines via stdlib logging with a
RotatingFileHandler (5 MB, 3 backups) at <project_root>/logs/audit.log.
Passwords, JWTs, secrets, and full credentials are NEVER logged.

Testability: `reset()` reinstates the logger on first use, and
`set_audit_log_path()` redirects the log file (used by tests).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

from app.config import get_project_root

_LOGGER_NAME = "audit"
_LOG_PATH: Optional[Path] = None
_initialized = False


def audit_log_path() -> Path:
    """Return the resolved audit log file path (overrideable for tests)."""
    global _LOG_PATH
    if _LOG_PATH is None:
        _LOG_PATH = get_project_root() / "logs" / "audit.log"
    return _LOG_PATH


def set_audit_log_path(path: Path) -> None:
    """Point the audit log elsewhere (test hook). Must precede first use."""
    global _LOG_PATH, _initialized
    _LOG_PATH = Path(path)
    _initialized = False


def reset() -> None:
    """Test hook: drop cached state so the logger re-initializes on use."""
    global _LOG_PATH, _initialized
    _LOG_PATH = None
    _initialized = False


def _get_audit_logger() -> logging.Logger:
    """Return the audit logger, initializing the handler on first call."""
    global _initialized
    audit_logger = logging.getLogger(_LOGGER_NAME)

    if not _initialized:
        audit_logger.setLevel(logging.INFO)
        audit_logger.propagate = False

        log_path = audit_log_path()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            str(log_path),
            maxBytes=5 * 1024 * 1024,  # 5 MB
            backupCount=3,
            encoding="utf-8",
        )
        handler.setFormatter(logging.Formatter("%(message)s"))
        audit_logger.addHandler(handler)
        _initialized = True

    return audit_logger


def _mask_email(email: str) -> str:
    """Partially mask an email for privacy: local part prefix + domain."""
    parts = email.split("@", 1)
    if len(parts) == 2:
        prefix = parts[0]
        masked_local = prefix[:2] + "***" if len(prefix) > 2 else prefix
        return f"{masked_local}@{parts[1]}"
    return "***"


def log_auth_event(
    event: str,
    *,
    user_id: Optional[str] = None,
    email: Optional[str] = None,
    ip: Optional[str] = None,
    detail: Optional[str] = None,
) -> None:
    """Record an authentication-related audit event.

    Args:
        event: One of login_success, login_failure, register_success,
               register_failure, token_refresh, logout.
        user_id: The authenticated user's ID (if known).
        email: The email address involved (masked before logging).
        ip: Client IP address.
        detail: Short, safe detail string (no secrets, no exception text).

    Never logs passwords, JWTs, tokens, secret keys, or exception text.
    """
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "cat": "auth",
        "event": event,
    }
    if user_id:
        record["uid"] = user_id
    if email:
        record["email"] = _mask_email(email)
    if ip:
        record["ip"] = ip
    if detail:
        record["detail"] = detail

    _get_audit_logger().info(json.dumps(record, separators=(",", ":")))


def log_admin_action(
    action: str,
    *,
    user_id: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    detail: Optional[str] = None,
    ip: Optional[str] = None,
) -> None:
    """Record an admin action audit event.

    Args:
        action: Short action identifier (source_update, source_delete,
                source_analyze, etc.).
        user_id: The admin user's ID.
        target_type: Type of entity acted upon (source, user, etc.).
        target_id: ID of the entity acted upon.
        detail: Short, safe description (no secrets or exception text).
        ip: Client IP address.
    """
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "cat": "admin",
        "action": action,
    }
    if user_id:
        record["uid"] = user_id
    if target_type:
        record["target_type"] = target_type
    if target_id:
        record["target_id"] = target_id
    if detail:
        record["detail"] = detail
    if ip:
        record["ip"] = ip

    _get_audit_logger().info(json.dumps(record, separators=(",", ":")))