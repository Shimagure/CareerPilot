"""Thin adapter over the existing job-search pipeline.

This module is the ONLY place in the backend that invokes portal CLIs
or touches job-scraper files. It does NOT reimplement any pipeline logic.

Design:
  - PortalDiscoveryExecutor: real CLI subprocess via argument arrays (no shell strings)
  - DryRunExecutor: controlled no-network path for tests and safe smoke tests
  - Both implement the same ExecutorProtocol
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Protocol, runtime_checkable

from app.config import get_project_root, get_data_dir
from app.validation import validate_search_term

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# CLI allowlist — the only executables and flags we will ever invoke.
# This prevents any user input from becoming an unrestricted shell command.
# ──────────────────────────────────────────────────────────────────────────────

PROJECT_ROOT = get_project_root()
DATA_DIR = get_data_dir()

# Map portal names → (skill dir relative to PROJECT_ROOT, cli.ts relative to skill dir)
PORTAL_CLIS: dict[str, str] = {
    "jobstreet": ".agents/skills/jobstreet-search/cli/src/cli.ts",
    "indeed": ".agents/skills/indeed-search/cli/src/cli.ts",
    "kalibrr": ".agents/skills/kalibrr-search/cli/src/cli.ts",
    "bossjob": ".agents/skills/bossjob-search/cli/src/cli.ts",
    "linkedin": ".agents/skills/linkedin-search/cli/src/cli.ts",
    "freehire": ".agents/skills/freehire-search/cli/src/cli.ts",
}

# Only these flag names are accepted in CLI invocation
ALLOWED_FLAGS = {"-q", "-l", "--jobage", "--limit", "--format"}


@dataclass
class ExecutorResult:
    """Outcome of a single CLI invocation."""
    success: bool
    portal: str
    query: str
    jobs_found: int = 0
    error: Optional[str] = None
    raw_output: Optional[str] = None


@dataclass
class PipelineResult:
    """Aggregate outcome of the discovery stage."""
    success: bool
    total_jobs_found: int = 0
    portal_results: list[ExecutorResult] = field(default_factory=list)
    error: Optional[str] = None
    stage_reached: str = "discovery"


@runtime_checkable
class ExecutorProtocol(Protocol):
    """Minimal interface the SearchManager depends on."""

    async def execute(
        self,
        keywords: str,
        location: str,
        job_age: int = 14,
        limit: int = 20,
        portals: Optional[list[str]] = None,
    ) -> PipelineResult: ...


def _build_cli_args(
    cli_path: str, keywords: str, location: str, job_age: int = 14, limit: int = 20
) -> list[str]:
    """Build the exact CLI argument array (no shell strings, no concatenation).

    Returns ["bun", "run", <cli_path>, "search", "-q", kw, "-l", loc, ...].
    """
    return [
        "bun", "run", cli_path, "search",
        "-q", keywords,
        "-l", location,
        "--jobage", str(job_age),
        "--limit", str(limit),
        "--format", "json",
    ]


def _validate_argument_list(args: list[str]) -> list[str]:
    """Validate CLI argument list: only allow flags from the allowlist and safe values.

    Raises ValueError if any argument is not an allowlisted flag or is not a
    safe search term (shared rule from app.validation).
    """
    validated: list[str] = []
    for arg in args:
        if arg.startswith("-"):
            if arg not in ALLOWED_FLAGS:
                raise ValueError(f"Disallowed flag: {arg}")
            validated.append(arg)
        else:
            validate_search_term(arg)
            validated.append(arg)
    return validated


class PortalDiscoveryExecutor:
    """Execute portal discovery CLIs via asyncio subprocess (argument arrays, no shell).

    This is the real, network-hitting path. Each portal CLI runs as:
      bun run <cli.ts> search -q "<keywords>" -l "<location>" --jobage 14 --limit 20 --format json

    Output is captured as JSON; shared pipeline files (canonical/seen/ranked)
    are NOT touched by this adapter — the CLI writes to its own raw output.
    """

    def __init__(self, data_dir: Optional[Path] = None):
        self._data_dir = data_dir or DATA_DIR

    async def execute(
        self,
        keywords: str,
        location: str,
        job_age: int = 14,
        limit: int = 20,
        portals: Optional[list[str]] = None,
    ) -> PipelineResult:
        """Run portal CLIs and aggregate raw results."""
        active_portals = portals or list(PORTAL_CLIS.keys())
        result = PipelineResult(success=True)

        # Filter to portals whose CLI files actually exist
        available: list[str] = []
        for p in active_portals:
            cli_rel = PORTAL_CLIS.get(p)
            if cli_rel and (PROJECT_ROOT / cli_rel).exists():
                available.append(p)
            else:
                logger.info("Skipping portal %s: CLI not found at %s", p, cli_rel)

        if not available:
            result.success = False
            result.error = "No portal CLIs available"
            return result

        # Run portals sequentially (they share filesystem state)
        for portal in available:
            cli_rel = PORTAL_CLIS[portal]
            cli_path = str(PROJECT_ROOT / cli_rel)

            # Build validated argument list
            args = _build_cli_args(cli_path, keywords, location, job_age, limit)

            try:
                _validate_argument_list(args[3:])  # skip bun/run/cli_path prefix
            except ValueError as e:
                result.portal_results.append(ExecutorResult(
                    success=False, portal=portal, query=keywords,
                    error=f"Argument validation failed: {e}",
                ))
                continue

            try:
                proc = await asyncio.create_subprocess_exec(
                    *args,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=str(PROJECT_ROOT),
                )
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=180.0
                )

                if proc.returncode == 0 and stdout:
                    output = stdout.decode("utf-8", errors="replace").strip()
                    # Count jobs from JSON output (array of job objects)
                    try:
                        jobs = json.loads(output)
                        job_count = len(jobs) if isinstance(jobs, list) else 0
                    except json.JSONDecodeError:
                        job_count = 0
                        output = None

                    result.portal_results.append(ExecutorResult(
                        success=True, portal=portal, query=keywords,
                        jobs_found=job_count, raw_output=output,
                    ))
                    result.total_jobs_found += job_count
                else:
                    err_msg = (stderr or b"").decode("utf-8", errors="replace").strip()
                    result.portal_results.append(ExecutorResult(
                        success=False, portal=portal, query=keywords,
                        error=err_msg or f"Exit code {proc.returncode}",
                    ))
            except asyncio.TimeoutError:
                result.portal_results.append(ExecutorResult(
                    success=False, portal=portal, query=keywords,
                    error="CLI timed out after 180s",
                ))
            except Exception as e:
                result.portal_results.append(ExecutorResult(
                    success=False, portal=portal, query=keywords,
                    error=f"Unexpected error: {type(e).__name__}",
                ))
                logger.exception("Portal %s failed", portal)

        # Overall success = at least one portal succeeded
        any_success = any(r.success for r in result.portal_results)
        result.success = any_success or len(result.portal_results) == 0
        if not any_success and result.portal_results:
            result.error = "All portal CLIs failed"
            result.success = False

        return result


class DryRunExecutor:
    """Controlled no-network path for tests and safe smoke tests.

    Returns synthetic honest results without touching any portal CLIs,
    network endpoints, or shared pipeline files.
    """

    async def execute(
        self,
        keywords: str,
        location: str,
        job_age: int = 14,
        limit: int = 20,
        portals: Optional[list[str]] = None,
    ) -> PipelineResult:
        """Return synthetic dry-run results."""
        # Small delay to simulate real execution time and allow concurrency tests to work
        import asyncio
        await asyncio.sleep(0.5)
        return PipelineResult(
            success=True,
            total_jobs_found=0,
            portal_results=[],  # No portals attempted in dry-run
            stage_reached="discovery",
        )
