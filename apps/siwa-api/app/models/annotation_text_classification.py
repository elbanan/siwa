"""
Text classification annotation model.
"""

from datetime import datetime

from sqlalchemy import String, DateTime, JSON, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TextClassificationAnnotation(Base):
    __tablename__ = "text_classification_annotations"
    __table_args__ = (
        UniqueConstraint("dataset_id", "record_id", name="uq_text_dataset_record"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    dataset_id: Mapped[str] = mapped_column(String, index=True)
    record_id: Mapped[str] = mapped_column(String, index=True)

    text_value: Mapped[str] = mapped_column(String, default="")
    label: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="unlabeled")
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)

    annotated_by: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
    annotated_by_name: Mapped[str | None] = mapped_column(String, index=True, nullable=True)

    annotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
