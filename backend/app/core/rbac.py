from typing import List, Union
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.core.security import decode_token
from app.models.users import User, Role

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# Standard Role Constants
ROLE_ADMIN = "Admin"
ROLE_NETWORK_ENGINEER = "NetworkEngineer"
ROLE_VIEWER = "Viewer"

ROLE_HIERARCHY = {
    ROLE_ADMIN: [ROLE_ADMIN, ROLE_NETWORK_ENGINEER, ROLE_VIEWER],
    ROLE_NETWORK_ENGINEER: [ROLE_NETWORK_ENGINEER, ROLE_VIEWER],
    ROLE_VIEWER: [ROLE_VIEWER],
}


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """Validate bearer token and retrieve active user."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type (access token required)",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user_id_str = payload.get("sub")
        if not user_id_str:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing subject claim",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user_id = UUID(user_id_str)
    except (ValueError, Exception) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Could not validate credentials: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user account",
        )

    return user


class RequireRole:
    """
    Dependency callable that validates if the authenticated user possesses
    one of the allowed roles.
    """
    def __init__(self, allowed_roles: Union[str, List[str]]):
        if isinstance(allowed_roles, str):
            self.allowed_roles = [allowed_roles]
        else:
            self.allowed_roles = allowed_roles

    def __call__(self, current_user: User = Depends(get_current_user)) -> User:
        user_role_name = current_user.role.name if current_user.role else ""
        if user_role_name not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions: requires one of {self.allowed_roles}, got '{user_role_name}'",
            )
        return current_user


# Pre-built role dependencies per §9/§13
require_admin = RequireRole([ROLE_ADMIN])
require_neteng = RequireRole([ROLE_ADMIN, ROLE_NETWORK_ENGINEER])
require_viewer = RequireRole([ROLE_ADMIN, ROLE_NETWORK_ENGINEER, ROLE_VIEWER])
