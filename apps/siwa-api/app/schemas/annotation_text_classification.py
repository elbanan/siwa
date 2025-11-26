"""
Pydantic schemas for text classification annotations.
"""

from typing import Optional, Literal
from pydantic import BaseModel, Field


class TextClassificationAnnOut(BaseModel):
    record_id: str
    text: str
    label: str
    status: Literal["labeled", "skipped", "unlabeled"]
    annotated_by: Optional[str] = None
    annotated_by_name: Optional[str] = None
    annotated_at: Optional[str] = None
    updated_at: Optional[str] = None


class TextClassificationAnnUpsert(BaseModel):
    record_id: str
    text: str
    label: str
    status: Literal["labeled", "skipped", "unlabeled"] = "labeled"
    notes: Optional[str] = None


class TextClassificationSummary(BaseModel):
    total: int
    labeled: int
    skipped: int
    unlabeled: int
    by_user: dict[str, int] = Field(default_factory=dict)
