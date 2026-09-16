"""Admin users router."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from pydantic import BaseModel, Field
from datetime import datetime

from ..database import get_db_session
from ..models.database_models import User, UserRole, UserStatus
from ..routers.auth import get_current_admin_user

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])


class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    users: List[UserResponse]
    total: int
    page: int
    page_size: int


@router.get("", response_model=UserListResponse)
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, description="Search by name or email"),
    role: Optional[UserRole] = None,
    status: Optional[UserStatus] = None,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_admin_user)
):
    """List all users with optional filters."""
    query = select(User)
    count_query = select(func.count()).select_from(User)

    if search:
        search_term = f"%{search.lower()}%"
        query = query.where(
            or_(
                User.name.ilike(search_term),
                User.email.ilike(search_term)
            )
        )
        count_query = count_query.where(
            or_(
                User.name.ilike(search_term),
                User.email.ilike(search_term)
            )
        )

    if role:
        query = query.where(User.role == role)
        count_query = count_query.where(User.role == role)

    if status:
        query = query.where(User.status == status)
        count_query = count_query.where(User.status == status)

    query = query.order_by(User.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await session.execute(query)
    users = result.scalars().all()

    total_result = await session.execute(count_query)
    total = total_result.scalar()

    return UserListResponse(
        users=[UserResponse.model_validate(u) for u in users],
        total=total,
        page=page,
        page_size=page_size
    )