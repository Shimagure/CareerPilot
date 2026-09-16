"""Authentication router: register, login, logout, current user."""
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Response, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..audit import log_auth_event
from ..database import get_db_session
from ..rate_limit import (
    RateLimitExceeded,
    check_rate_limit,
    get_client_ip,
    rate_limit_http_429,
)
from ..models.database_models import User, UserStatus, UserRole
from ..models.auth_schemas import (
    UserRegister, UserLogin, Token, CurrentUserResponse, MessageResponse
)
from ..auth import (
    hash_password, verify_password, create_access_token, decode_token,
    get_token_expiry_minutes, create_user_token
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def get_current_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_db_session)
) -> User:
    """Dependency to get current authenticated user from JWT token."""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication scheme",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is not active",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Server-side session version: a token issued before the account's last
    # logout (or other security-sensitive state change) carries a stale
    # claim and is rejected even though it is still cryptographically valid.
    # A token missing the claim entirely is also rejected (fail closed).
    if payload.get("token_version") != user.token_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked, please sign in again",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def get_current_admin_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """Dependency to get current authenticated admin user."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    return current_user


async def limit_login_by_ip(request: Request) -> None:
    """Rate-limit login attempts per client identity (IP)."""
    try:
        check_rate_limit("auth.login", get_client_ip(request))
    except RateLimitExceeded as exc:
        raise rate_limit_http_429(exc)


async def limit_register_by_ip(request: Request) -> None:
    """Rate-limit registration attempts per client identity (IP)."""
    try:
        check_rate_limit("auth.register", get_client_ip(request))
    except RateLimitExceeded as exc:
        raise rate_limit_http_429(exc)


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserRegister,
    request: Request,
    _rate_limit: None = Depends(limit_register_by_ip),
    session: AsyncSession = Depends(get_db_session),
):
    """Register a new user."""
    # Check if email already exists
    result = await session.execute(select(User).where(User.email == user_data.email))
    existing_user = result.scalar_one_or_none()

    if existing_user:
        log_auth_event(
            "register_failure",
            email=user_data.email,
            ip=get_client_ip(request),
            detail="Email already registered",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Create new user
    hashed_password = hash_password(user_data.password)
    user = User(
        name=user_data.name,
        email=user_data.email,
        password_hash=hashed_password,
        status=UserStatus.ACTIVE,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    # Create access token with role and session-version claims
    access_token = create_user_token(
        user_id=user.id,
        role=user.role.value,
        expires_delta=timedelta(minutes=get_token_expiry_minutes()),
        token_version=user.token_version,
    )

    log_auth_event(
        "register_success",
        user_id=str(user.id),
        email=user_data.email,
        ip=get_client_ip(request),
    )
    return Token(
        access_token=access_token,
        expires_in=get_token_expiry_minutes() * 60
    )


@router.post("/login", response_model=Token)
async def login(
    credentials: UserLogin,
    request: Request,
    _rate_limit: None = Depends(limit_login_by_ip),
    session: AsyncSession = Depends(get_db_session),
):
    """Login with email and password."""
    # Per-account throttle: bounds brute-force attempts against a known account.
    # Keyed by the supplied (normalized) email, so behavior is identical whether
    # the account exists — the attacker learns nothing from the 429 itself.
    try:
        check_rate_limit("auth.login.account", credentials.email.strip().lower())
    except RateLimitExceeded as exc:
        raise rate_limit_http_429(exc)

    result = await session.execute(select(User).where(User.email == credentials.email))
    user = result.scalar_one_or_none()

    client_ip = get_client_ip(request)

    if not user or not verify_password(credentials.password, user.password_hash):
        log_auth_event(
            "login_failure",
            email=credentials.email,
            ip=client_ip,
            detail="Incorrect credentials",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status != UserStatus.ACTIVE:
        log_auth_event(
            "login_failure",
            user_id=str(user.id),
            email=credentials.email,
            ip=client_ip,
            detail="Account not active",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is not active",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Create access token with role and session-version claims
    access_token = create_user_token(
        user_id=user.id,
        role=user.role.value,
        expires_delta=timedelta(minutes=get_token_expiry_minutes()),
        token_version=user.token_version,
    )

    log_auth_event(
        "login_success",
        user_id=str(user.id),
        email=user.email,
        ip=client_ip,
    )
    return Token(
        access_token=access_token,
        expires_in=get_token_expiry_minutes() * 60
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Logout: revoke all outstanding tokens for the current user.

    Increments the account's session token_version so every previously
    issued JWT is rejected by get_current_user.  The client also removes
    its local token copy after calling this endpoint.
    """
    current_user.token_version += 1
    await session.commit()
    return MessageResponse(message="Successfully logged out")


@router.get("/me", response_model=CurrentUserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """Get current authenticated user info."""
    from ..models.auth_schemas import UserResponse
    return CurrentUserResponse(
        user=UserResponse.model_validate(current_user)
    )


# Re-export for other routers to use
__all__ = ["router", "get_current_user", "get_current_admin_user"]