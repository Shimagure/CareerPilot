"""Authentication utilities: password hashing and JWT token handling."""
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from jose import jwt, JWTError

from .config import get_settings


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    # bcrypt.hashpw expects bytes, returns bytes
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hashed password."""
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    settings = get_settings()
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return encoded_jwt


def decode_token(token: str) -> Optional[dict]:
    """Decode and validate a JWT token."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        return payload
    except JWTError:
        return None


def get_token_expiry_minutes() -> int:
    """Get token expiry in minutes from settings."""
    return get_settings().access_token_expire_minutes


def create_user_token(
    user_id: str,
    role: str,
    expires_delta: Optional[timedelta] = None,
    token_version: Optional[int] = None,
) -> str:
    """Create a JWT access token with user role and session-version claims.

    When ``token_version`` is provided it is embedded as a claim so
    ``get_current_user`` can reject tokens issued before a logout or other
    server-side session invalidation.
    """
    data = {"sub": user_id, "role": role}
    if token_version is not None:
        data["token_version"] = token_version
    return create_access_token(data=data, expires_delta=expires_delta)