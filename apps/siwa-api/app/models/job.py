"""
Job model for local background tasks.

Fix for SQLAlchemy 2.0 typing:
All mapped columns must use Mapped[T].
"""

from datetime import datetime
from typing import Optional, Dict, Any, List

from sqlalchemy import String, DateTime, func, JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    type: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued")  # queued/running/succeeded/failed
    progress: Mapped[int] = mapped_column(Integer, default=0)
    logs: Mapped[List[str]] = mapped_column(JSON, default=list)
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
