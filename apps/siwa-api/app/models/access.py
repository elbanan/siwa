from sqlalchemy import Table, Column, ForeignKey, String
from sqlalchemy.orm import Mapped, relationship, mapped_column

from app.db.base import Base


class UserDatasetAccess(Base):
    __tablename__ = "user_dataset_access"

    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(
        String, ForeignKey("datasets.id"), primary_key=True
    )
    access_level: Mapped[str] = mapped_column(String, default="view")

    user: Mapped["User"] = relationship("User", back_populates="dataset_access")
    dataset: Mapped["Dataset"] = relationship("Dataset", back_populates="user_access")


group_memberships = Table(
    "group_memberships",
    Base.metadata,
    Column("group_id", String, ForeignKey("user_groups.id"), primary_key=True),
    Column("user_id", String, ForeignKey("users.id"), primary_key=True),
)

group_datasets = Table(
    "group_datasets",
    Base.metadata,
    Column("group_id", String, ForeignKey("user_groups.id"), primary_key=True),
    Column("dataset_id", String, ForeignKey("datasets.id"), primary_key=True),
)
