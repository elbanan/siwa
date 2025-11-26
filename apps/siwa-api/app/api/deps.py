"""
Shared FastAPI dependencies:
- DB session
- Current user from JWT
"""

from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session
from jose import JWTError
from uuid import uuid4

from app.db.session import SessionLocal
from app.core.security import decode_token
from app.models.user import User


def get_db():
    """Yield a SQLAlchemy session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> User:
    """
    Read bearer token, validate JWT, and fetch user.
    Raises 401 if missing/invalid.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1]
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.active:
        raise HTTPException(status_code=403, detail="Account inactive")
    return user


def require_role(*roles: str):
    """
    Simple RBAC checker. Usage:
      Depends(require_role("owner", "admin"))
    """
    def _checker(user: User = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return _checker


def require_eval_access(user: User = Depends(get_current_user)) -> User:
    if user.role in {"owner", "admin"} or user.can_access_eval:
        return user
    raise HTTPException(status_code=403, detail="Eval access required")
