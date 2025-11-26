"""
Model registry entry.

Keeps track of model artifacts regardless of their source (Ollama, local files, etc.).
"""

from datetime import datetime
from typing import Optional, Dict, Any

from sqlalchemy import String, JSON, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ModelEntry(Base):
    __tablename__ = "models"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, index=True)

    source_type: Mapped[str] = mapped_column(String)  # ollama | torch_file | future connectors
    source_config: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)

    status: Mapped[str] = mapped_column(String, default="pending")  # pending | ready | error
    error_message: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    details: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
