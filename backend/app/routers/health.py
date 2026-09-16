"""Health check router - PRIVATE: requires authentication."""
from fastapi import APIRouter, Depends
from typing import Dict, Any

from ..store import get_store, DataStore
from ..models.schemas import HealthResponse
from .auth import get_current_user
from ..models.database_models import User

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health_check(
    current_user: User = Depends(get_current_user),
    store: DataStore = Depends(get_store)
):
    """Health check endpoint - returns pipeline and data file status (authenticated)."""
    info = store.get_health_info()
    return HealthResponse(**info)