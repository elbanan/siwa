"""
Image classification annotation model.

Local-first.
One annotation per (dataset_id, file_path).
Stores user + timestamp audit trail.
"""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import String, DateTime, func, JSON, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ImageClassificationAnnotation(Base):
    __tablename__ = "image_classification_annotations"
    __table_args__ = (
        UniqueConstraint("dataset_id", "file_path", name="uq_dataset_file"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    dataset_id: Mapped[str] = mapped_column(String, index=True)
    file_path: Mapped[str] = mapped_column(String, index=True)

    labels: Mapped[List[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="unlabeled")  # labeled|skipped|unlabeled
    is_multi_label: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    annotated_by: Mapped[str] = mapped_column(String, index=True)
    annotated_by_name: Mapped[str] = mapped_column(String, index=True)

    annotated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
"""
Annotation model for image classification workflows.
"""

from datetime import datetime

from sqlalchemy import String, DateTime, JSON, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    dataset_id: Mapped[str] = mapped_column(String, index=True)
    file_path: Mapped[str] = mapped_column(String, index=True)

    labels: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="annotated")  # annotated/skipped

    annotator_id: Mapped[str] = mapped_column(String, nullable=True)
    annotator_name: Mapped[str] = mapped_column(String, default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
