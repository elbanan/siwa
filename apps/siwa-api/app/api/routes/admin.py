"""
Admin-only routes for user / dataset access management.
"""

from uuid import uuid4
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, require_role
from app.core.security import hash_password
from app.models.dataset import Dataset
from app.models.group import UserGroup
from app.models.user import User
from app.models.access import UserDatasetAccess
from app.schemas.admin import (
    AdminUserOut,
    AdminUserCreate,
    AdminUserUpdate,
    AdminUserDatasetsUpdate,
    AdminUserPasswordUpdate,
    AdminGroupOut,
    AdminGroupCreate,
    AdminGroupUpdate,
    DatasetRef,
    DatasetAccessOut,
)
from app.schemas.user import UserOut

router = APIRouter(prefix="/admin", tags=["admin"])


def _serialize_user(user: User) -> AdminUserOut:
    dataset_access = [
        DatasetAccessOut(
            id=access.dataset.id,
            name=access.dataset.name,
            access_level=access.access_level,
        )
        for access in user.dataset_access
        if access.dataset
    ]
    return AdminUserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        active=user.active,
        dataset_access=dataset_access,
        dataset_ids=[access.dataset.id for access in user.dataset_access if access.dataset],
        group_ids=[g.id for g in user.groups],
        group_names=[g.name for g in user.groups],
        can_access_eval=user.can_access_eval,
    )


def _serialize_group(group: UserGroup) -> AdminGroupOut:
    dataset_refs = [DatasetRef(id=d.id, name=d.name) for d in group.datasets]
    members = [
        UserOut(
            id=u.id,
            email=u.email,
            name=u.name,
            role=u.role,
            active=u.active,
        )
        for u in group.users
    ]
    return AdminGroupOut(
        id=group.id,
        name=group.name,
        description=group.description,
        datasets=dataset_refs,
        members=members,
    )


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role("owner", "admin")),
):
    users = (
        db.query(User)
        .options(
            selectinload(User.dataset_access).selectinload(UserDatasetAccess.dataset),
            selectinload(User.groups),
        )
        .order_by(User.email)
        .all()
    )
    return [_serialize_user(u) for u in users]


@router.post("/users", response_model=AdminUserOut)
def create_user(
    payload: AdminUserCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role("owner", "admin")),
):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        id=str(uuid4()),
        email=payload.email,
        name=payload.name,
        role=payload.role,
        active=payload.active,
        password_hash=hash_password(payload.password),
        can_access_eval=payload.can_access_eval,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@router.get("/users/{user_id}", response_model=AdminUserOut)
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role("owner", "admin")),
):
    user = (
        db.query(User)
        .options(
            selectinload(User.dataset_access).selectinload(UserDatasetAccess.dataset),
            selectinload(User.groups),
        )
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize_user(user)


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(
    user_id: str,
    payload: AdminUserUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role("owner", "admin")),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.email is not None:
        existing = db.query(User).filter(User.email == payload.email).first()
        if existing and existing.id != user_id:
            raise HTTPException(status_code=400, detail="Email already registered")
        user.email = payload.email
    if payload.name is not None:
        user.name = payload.name
    if payload.role is not None:
        user.role = payload.role
    if payload.active is not None:
        user.active = payload.active
    if payload.can_access_eval is not None:
        user.can_access_eval = payload.can_access_eval
    db.add(user)
    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@router.patch("/users/{user_id}/password")
def set_user_password(
    user_id: str,
    payload: AdminUserPasswordUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role("owner", "admin")),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(payload.password)
    db.add(user)
    db.commit()
    return {"ok": True}


@router.patch("/users/{user_id}/datasets", response_model=AdminUserOut)
def set_user_datasets(
    user_id: str,
    payload: AdminUserDatasetsUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role("owner", "admin")),
):
    user = (
        db.query(User)
        .options(
            selectinload(User.dataset_access).selectinload(UserDatasetAccess.dataset),
            selectinload(User.groups),
        )
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    assignments = {
        item.dataset_id: item.access_level for item in payload.assignments
    }
    if not assignments:
        user.dataset_access = []
    else:
        datasets = (
            db.query(Dataset)
            .filter(Dataset.id.in_(assignments.keys()))
            .all()
        )
        if len(datasets) != len(assignments):
            raise HTTPException(status_code=400, detail="One or more datasets not found")
        dataset_map = {d.id: d for d in datasets}

        new_access = []
        for dataset_id, level in assignments.items():
            dataset = dataset_map[dataset_id]
            new_access.append(
                UserDatasetAccess(
                    user=user,
                    dataset=dataset,
                    access_level=level,
                )
            )
        user.dataset_access = new_access
    db.add(user)
    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@router.get("/groups", response_model=list[AdminGroupOut])
def list_groups(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role("owner", "admin")),
):
    groups = (
        db.query(UserGroup)
        .options(
            selectinload(UserGroup.datasets),
            selectinload(UserGroup.users),
        )
        .order_by(UserGroup.name)
        .all()
    )
    return [_serialize_group(g) for g in groups]


def _validate_dataset_selection(db: Session, dataset_ids: List[str]) -> list[Dataset]:
    if not dataset_ids:
        return []
    datasets = db.query(Dataset).filter(Dataset.id.in_(dataset_ids)).all()
    if len(datasets) != len(set(dataset_ids)):
        raise HTTPException(status_code=400, detail="One or more datasets not found")
    return datasets


def _validate_user_selection(db: Session, user_ids: List[str]) -> list[User]:
    if not user_ids:
        return []
    users = db.query(User).filter(User.id.in_(user_ids)).all()
    if len(users) != len(set(user_ids)):
        raise HTTPException(status_code=400, detail="One or more users not found")
    return users


@router.post("/groups", response_model=AdminGroupOut)
def create_group(
    payload: AdminGroupCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role("owner", "admin")),
):
    if db.query(UserGroup).filter(UserGroup.name == payload.name).first():
        raise HTTPException(status_code=400, detail="Group with this name already exists")
    datasets = _validate_dataset_selection(db, payload.dataset_ids)
    members = _validate_user_selection(db, payload.member_ids)
    group = UserGroup(
        id=str(uuid4()),
        name=payload.name,
        description=payload.description or "",
    )
    group.datasets = datasets
    group.users = members
    db.add(group)
    db.commit()
    db.refresh(group)
    return _serialize_group(group)


@router.patch("/groups/{group_id}", response_model=AdminGroupOut)
def update_group(
    group_id: str,
    payload: AdminGroupUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role("owner", "admin")),
):
    group = (
        db.query(UserGroup)
        .options(
            selectinload(UserGroup.datasets),
            selectinload(UserGroup.users),
        )
        .filter(UserGroup.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if payload.name is not None:
        group.name = payload.name
    if payload.description is not None:
        group.description = payload.description
    if payload.dataset_ids is not None:
        group.datasets = _validate_dataset_selection(db, payload.dataset_ids)
    if payload.member_ids is not None:
        group.users = _validate_user_selection(db, payload.member_ids)
    db.add(group)
    db.commit()
    db.refresh(group)
    return _serialize_group(group)
