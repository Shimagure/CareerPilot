"""Input validation helpers shared by the API boundary and the pipeline adapter.

Single source of truth for "what user text is safe to pass as one CLI argument".
The adapter also enforces this before spawning any subprocess, so invalid input
can never reach an executable even if a caller skips the API checks.
"""
from __future__ import annotations

# Characters that are active in POSIX/Win32 command interpreters or otherwise
# unsafe to ever reconstruct into a shell string. Also includes = because
# var=value is a shell assignment.
SHELL_UNSAFE_CHARS = set(";&|`$<>(){}[]'\"\\#~!*?=")


def validate_search_term(term: str) -> None:
    """Raise ValueError if ``term`` is not safe to pass as a single argv element.

    Rules:
      - Must be non-empty after trimming.
      - Must not start with ``-`` (would parse as a flag).
      - Every character must be printable and not shell-active.
    """
    if not term.strip():
        raise ValueError("must not be empty")
    if term.startswith("-"):
        raise ValueError("must not start with '-'")
    bad = sorted({c for c in term if not c.isprintable() or c in SHELL_UNSAFE_CHARS})
    if bad:
        joined = "".join(bad)
        raise ValueError(f"contains disallowed character(s): {joined}")