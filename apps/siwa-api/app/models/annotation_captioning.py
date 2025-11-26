"""
Image captioning annotation model.

One caption per (dataset_id, file_path).
"""

from datetime import datetime

from sqlalchemy import String, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ImageCaptionAnnotation(Base):
    __tablename__ = "image_caption_annotations"
    __table_args__ = (
        UniqueConstraint("dataset_id", "file_path", name="uq_caption_dataset_file"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    dataset_id: Mapped[str] = mapped_column(String, index=True)
    file_path: Mapped[str] = mapped_column(String, index=True)

    caption: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(
        String, default="unlabeled"
    )  # labeled|skipped|unlabeled
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

    annotated_by: Mapped[str | None] = mapped_column(String, nullable=True)
    annotated_by_name: Mapped[str | None] = mapped_column(String, nullable=True)

    annotated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
