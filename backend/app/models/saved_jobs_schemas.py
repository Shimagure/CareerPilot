"""Pydantic schemas for the Saved Jobs API (Checkpoint 11).

A saved job is a user-owned bookmark row (UserJob.status == SAVED) combined
with the current global job record for the same stable_id. The global record
is read-only reference data; it is never copied into the user's saved row.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.schemas import JobRecord


class SavedJobItem(BaseModel):
    """One saved job for the authenticated user.

    ``available`` is ``False`` when the job no longer exists in the current
    global job dataset. In that case ``job`` is ``None`` and no field is
    fabricated.
    """
    stable_id: str
    saved_at: datetime
    available: bool
    job: Optional[JobRecord] = None