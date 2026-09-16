"""Pydantic schemas for authentication."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator
from pydantic.config import ConfigDict


class UserRegister(BaseModel):
    """User registration request."""
    name: str = Field(..., min_length=1, max_length=255, description="Full name of the user")
    email: EmailStr
    password: str

    @field_validator('password')
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters')
        return v

    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('Name cannot be empty')
        return v.strip()


class UserLogin(BaseModel):
    """User login request."""
    email: EmailStr
    password: str


class Token(BaseModel):
    """Token response."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserResponse(BaseModel):
    """User response (public info)."""
    id: str
    email: str
    name: str
    role: str
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CurrentUserResponse(BaseModel):
    """Current user response."""
    user: UserResponse


class MessageResponse(BaseModel):
    """Generic message response."""
    message: str