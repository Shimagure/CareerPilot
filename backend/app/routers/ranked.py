"""Ranked jobs router - top N endpoints."""
from fastapi import APIRouter, Depends
from typing import List, Optional

from ..store import get_store, DataStore
from ..models.schemas import JobSummary
from .auth import get_current_user
from ..models.database_models import User

router = APIRouter(prefix="/api/ranked", tags=["ranked"])


@router.get("/top5", response_model=List[JobSummary])
def get_top5(
    current_user: User = Depends(get_current_user),
    store: DataStore = Depends(get_store)
):
    """Get top 5 ranked jobs from final ranking (authenticated)."""
    active_jobs = store.get_active_jobs()
    return active_jobs[:5]


@router.get("/top10", response_model=List[JobSummary])
def get_top10(
    current_user: User = Depends(get_current_user),
    store: DataStore = Depends(get_store)
):
    """Get top 10 ranked jobs from final ranking (authenticated)."""
    active_jobs = store.get_active_jobs()
    return active_jobs[:10]


@router.get("/all", response_model=List[JobSummary])
def get_all_ranked(
    current_user: User = Depends(get_current_user),
    store: DataStore = Depends(get_store)
):
    """Get all ranked jobs (complete active set) (authenticated)."""
    return store.get_active_jobs()