"""
User model.

Fix for SQLAlchemy 2.0 typing:
All mapped columns must use Mapped[T] annotations.
"""

from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import Boolean, String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.access import UserDatasetAccess, group_memberships

if TYPE_CHECKING:
    from app.models.dataset import Dataset
    from app.models.group import UserGroup


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String, default="")
    password_hash: Mapped[str] = mapped_column(String)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    role: Mapped[str] = mapped_column(String, default="owner")  # owner/admin/editor/viewer
    can_access_eval: Mapped[bool] = mapped_column(Boolean, default=False)

    dataset_access: Mapped[List["UserDatasetAccess"]] = relationship(
        "UserDatasetAccess",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    groups: Mapped[List["UserGroup"]] = relationship(
        "UserGroup", secondary=group_memberships, back_populates="users"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
