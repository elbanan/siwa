"""
Dataset model.

Note: `metadata` is a reserved attribute name in SQLAlchemy declarative models.
We use `ds_metadata` instead.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any, TYPE_CHECKING

from sqlalchemy import String, DateTime, func, JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.access import UserDatasetAccess, group_datasets

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.group import UserGroup


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String, primary_key=True)

    # User-facing identity
    name: Mapped[str] = mapped_column(String, index=True)
    project_name: Mapped[str] = mapped_column(String, default="default", index=True)
    description: Mapped[str] = mapped_column(String, default="")
    tags: Mapped[List[str]] = mapped_column(JSON, default=list)

    # ML intent
    modality: Mapped[str] = mapped_column(String)   # "image" or "text"
    task_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Source configs
    data_source: Mapped[Dict[str, Any]] = mapped_column(JSON)
    annotation_source: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Annotation/training schema
    class_names: Mapped[List[str]] = mapped_column(JSON, default=list)

    # Flexible config (renamed from metadata -> ds_metadata)
    ds_metadata: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)

    # Optional split config
    split: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    annotation_status: Mapped[str] = mapped_column(String, default="unknown")
    status: Mapped[str] = mapped_column(String, default="configured")
    asset_count: Mapped[int] = mapped_column(Integer, default=0)
    
    # Cached counts for performance (populated by scan)
    cached_asset_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cached_labeled_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_scanned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


    user_access: Mapped[List["UserDatasetAccess"]] = relationship(
        "UserDatasetAccess",
        back_populates="dataset",
        cascade="all, delete-orphan",
    )
    groups: Mapped[List["UserGroup"]] = relationship(
        "UserGroup", secondary=group_datasets, back_populates="datasets"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
