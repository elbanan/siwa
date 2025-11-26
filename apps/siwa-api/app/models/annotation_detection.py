"""
Image detection annotations.

Stores multiple bounding boxes per file along with annotator metadata.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any

from sqlalchemy import String, DateTime, JSON, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ImageDetectionAnnotation(Base):
    __tablename__ = "image_detection_annotations"
    __table_args__ = (
        UniqueConstraint("dataset_id", "file_path", name="uq_detection_dataset_file"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    dataset_id: Mapped[str] = mapped_column(String, index=True)
    file_path: Mapped[str] = mapped_column(String, index=True)

    boxes: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="unlabeled")
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    annotated_by: Mapped[str] = mapped_column(String, index=True)
    annotated_by_name: Mapped[str] = mapped_column(String, index=True)

    annotated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
