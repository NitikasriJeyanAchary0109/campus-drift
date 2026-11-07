from datetime import timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.core.config import settings
from app.core.throttle import LoginThrottle
from app.core.audit import record_audit
from app.models.audit import AuditLog
from app.core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.rbac import get_current_user
from app.models.users import User
from app.schemas.auth import LoginRequest, RefreshRequest, TokenResponse, UserOut

router = APIRouter(prefix="/auth", tags=["Auth"])
throttle = LoginThrottle(settings.REDIS_URL, settings.LOGIN_MAX_FAILURES, settings.LOGIN_FAILURE_WINDOW_SECONDS)


@router.post("/login", response_model=TokenResponse)
def login(
    login_data: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    Issue JWT access token and set httpOnly refresh cookie.
    Public endpoint. After too many wrong passwords for one username from one address the call returns 429 for a while.
    """
    key = throttle.key(login_data.username, request.client.host if request.client else "unknown")
    wait = throttle.retry_after(key)
    if wait:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed sign-in attempts. Try again in {max(1, wait // 60)} minute(s).",
            headers={"Retry-After": str(wait)},
        )
    # PostgreSQL cannot store or compare a NUL character: such a name cannot belong to any user, so it fails like an unknown one
    has_nul = "\x00" in login_data.username
    user = None if has_nul else db.query(User).filter(User.username == login_data.username).first()
    if not user or not verify_password(login_data.password, user.password_hash):
        throttle.record_failure(key)
        # a failed sign-in is a security event: it goes to the audit trail (the password is never recorded)
        db.add(AuditLog(user_id=user.id if user else None, action="LOGIN_FAILED", target_type="user",
                        target_id=user.id if user else None, after_state={"username": login_data.username.replace("\x00", "\ufffd")[:64]}))
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        record_audit(db, "LOGIN_REFUSED_INACTIVE", "user", user.id, user.id, after={"username": user.username})
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user account",
        )

    throttle.reset(key)
    role_name = user.role.name if user.role else "Viewer"
    token_data = {"sub": str(user.id), "username": user.username, "role": role_name}

    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    record_audit(db, "LOGIN_SUCCEEDED", "user", user.id, user.id, after={"username": user.username, "role": role_name})
    db.commit()

    # Set httpOnly refresh cookie per §13
    max_age = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        max_age=max_age,
        samesite="lax",
        secure=not settings.DEBUG,
    )

    user_out = UserOut(
        id=user.id,
        username=user.username,
        role=role_name,
        is_active=user.is_active,
        created_at=user.created_at,
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=user_out,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    request: Request,
    response: Response,
    body: Optional[RefreshRequest] = None,
    db: Session = Depends(get_db)
):
    """
    Refresh access token using httpOnly cookie or request body refresh_token.
    """
    token_str = request.cookies.get("refresh_token")
    if not token_str and body and body.refresh_token:
        token_str = body.refresh_token

    if not token_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token required",
        )

    try:
        payload = decode_token(token_str)
        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type (refresh token required)",
            )
        user_id_str = payload.get("sub")
        user_id = UUID(user_id_str)
    except Exception as e:
        record_audit(db, "TOKEN_REFRESH_REFUSED", "user", after={"reason": "invalid or expired refresh token"})
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired refresh token: {str(e)}",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        record_audit(db, "TOKEN_REFRESH_REFUSED", "user", user.id if user else None, user.id if user else None,
                     after={"reason": "user not found or inactive"})
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    role_name = user.role.name if user.role else "Viewer"
    token_data = {"sub": str(user.id), "username": user.username, "role": role_name}

    new_access_token = create_access_token(token_data)
    new_refresh_token = create_refresh_token(token_data)
    record_audit(db, "TOKEN_REFRESHED", "user", user.id, user.id, after={"username": user.username})
    db.commit()

    max_age = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        max_age=max_age,
        samesite="lax",
        secure=not settings.DEBUG,
    )

    user_out = UserOut(
        id=user.id,
        username=user.username,
        role=role_name,
        is_active=user.is_active,
        created_at=user.created_at,
    )

    return TokenResponse(
        access_token=new_access_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=user_out,
    )


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    """Retrieve profile of the currently authenticated user."""
    return UserOut(
        id=current_user.id,
        username=current_user.username,
        role=current_user.role.name if current_user.role else "Viewer",
        is_active=current_user.is_active,
        created_at=current_user.created_at,
    )


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Sign out user by deleting the httpOnly refresh_token cookie.
    Public endpoint. When the cookie still identifies a user, the sign-out is recorded in the audit trail.
    """
    cookie = request.cookies.get("refresh_token")
    if cookie:
        try:
            uid = UUID(decode_token(cookie).get("sub"))
            record_audit(db, "LOGOUT", "user", uid, uid)
            db.commit()
        except Exception:
            db.rollback()  # an unreadable cookie is simply cleared; there is nobody to attribute it to
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        samesite="lax",
        secure=not settings.DEBUG,
    )
    return {"message": "Logged out successfully"}

