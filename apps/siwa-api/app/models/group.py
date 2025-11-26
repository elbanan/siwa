from datetime import datetime
from typing import List, TYPE_CHECKING

from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.access import group_datasets, group_memberships

if TYPE_CHECKING:
    from app.models.dataset import Dataset
    from app.models.user import User


class UserGroup(Base):
    __tablename__ = "user_groups"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    description: Mapped[str] = mapped_column(String, default="")

    datasets: Mapped[List["Dataset"]] = relationship(
        "Dataset", secondary=group_datasets, back_populates="groups"
    )
    users: Mapped[List["User"]] = relationship(
        "User", secondary=group_memberships, back_populates="groups"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
