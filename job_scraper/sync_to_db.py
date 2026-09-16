#!/usr/bin/env python3
"""Synchronize completed pipeline output into the SQL jobs mirror."""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import get_settings
from app.database import DatabaseManager
from app.services.job_sync import JobSyncService, SyncLockError


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync pipeline JSON into SQL jobs mirror")
    parser.add_argument("--dry-run", action="store_true", help="Validate and diff without database writes")
    parser.add_argument("--full-snapshot", action="store_true", help="Tombstone SQL jobs absent from this complete source")
    parser.add_argument("--run-id", required=True, help="Completed ranking_report checkpoint run ID")
    parser.add_argument("--seen-jobs", type=Path, default=PROJECT_ROOT / "job_scraper" / "seen_jobs.json")
    parser.add_argument("--canonical-jobs", type=Path, default=PROJECT_ROOT / "job_scraper" / "canonical_jobs.json")
    parser.add_argument("--checkpoints", type=Path, default=PROJECT_ROOT / "job_scraper" / "checkpoints.json")
    parser.add_argument("--lock-file", type=Path, default=PROJECT_ROOT / "job_scraper" / ".sync.lock")
    return parser.parse_args()


async def run(args: argparse.Namespace) -> int:
    settings = get_settings()
    manager = DatabaseManager()
    manager.initialize(settings.database_url, settings.database_echo)
    service = JobSyncService(manager, args.lock_file)
    try:
        summary = await service.sync(
            args.seen_jobs,
            args.canonical_jobs,
            args.checkpoints,
            run_id=args.run_id,
            full_snapshot=args.full_snapshot,
            dry_run=args.dry_run,
        )
        print(summary.format())
        return 0 if summary.reconciliation_passed else 1
    finally:
        await manager.close()


def main() -> int:
    args = parse_args()
    try:
        return asyncio.run(run(args))
    except SyncLockError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
