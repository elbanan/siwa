"""
Dataset access helpers.
"""

from typing import Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.access import UserDatasetAccess, group_datasets, group_memberships
from app.models.user import User

AccessLevel = Literal["view", "editor"]
ACCESS_LEVEL_WEIGHT = {"view": 0, "editor": 1}
OWNER_ROLES = {"owner", "admin"}


def user_accessible_dataset_ids(db: Session, user: User) -> set[str] | None:
    """
    Return dataset IDs the user can view/edit. Returns None for owner/admin.
    """
    if user.role in OWNER_ROLES:
        return None

    rows = (
        db.query(UserDatasetAccess.dataset_id)
        .filter(UserDatasetAccess.user_id == user.id)
        .all()
    )
    ids = {row[0] for row in rows}

    stmt = (
        select(group_datasets.c.dataset_id)
        .select_from(
            group_datasets.join(
                group_memberships,
                group_memberships.c.group_id == group_datasets.c.group_id,
            )
        )
        .where(group_memberships.c.user_id == user.id)
    )
    group_ids = set(db.execute(stmt).scalars().all())
    ids.update(group_ids)
    return ids


def _get_direct_access(db: Session, user: User, dataset_id: str) -> AccessLevel | None:
    row = (
        db.query(UserDatasetAccess)
        .filter(
            UserDatasetAccess.user_id == user.id,
            UserDatasetAccess.dataset_id == dataset_id,
        )
        .first()
    )
    if row:
        return row.access_level
    return None


def get_effective_dataset_access_level(
    db: Session, user: User, dataset_id: str
) -> AccessLevel | None:
    if user.role in OWNER_ROLES:
        return "editor"

    direct = _get_direct_access(db, user, dataset_id)
    if direct:
        return direct

    stmt = (
        select(group_datasets.c.dataset_id)
        .select_from(
            group_datasets.join(
                group_memberships,
                group_memberships.c.group_id == group_datasets.c.group_id,
            )
        )
        .where(
            group_memberships.c.user_id == user.id,
            group_datasets.c.dataset_id == dataset_id,
        )
    )
    has_group = db.execute(stmt).scalar_one_or_none()
    if has_group:
        return "view"
    return None


def ensure_dataset_access_level(
    db: Session, user: User, dataset_id: str, required_level: AccessLevel
) -> AccessLevel:
    level = get_effective_dataset_access_level(db, user, dataset_id)
    if not level:
        raise HTTPException(status_code=403, detail="Dataset access denied")

    if ACCESS_LEVEL_WEIGHT[level] < ACCESS_LEVEL_WEIGHT[required_level]:
        raise HTTPException(status_code=403, detail="Insufficient dataset access level")

    return level


def ensure_owner_or_admin(user: User) -> None:
    if user.role not in OWNER_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
