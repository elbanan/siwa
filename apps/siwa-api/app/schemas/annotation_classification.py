"""
Pydantic schemas for image classification annotations.
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal


class ClassificationAnnOut(BaseModel):
    path: str
    status: Literal["labeled", "skipped", "unlabeled"]
    labels: list[str] = Field(default_factory=list)

    annotated_by: Optional[str] = None
    annotated_by_name: Optional[str] = None
    annotated_at: Optional[str] = None
    updated_at: Optional[str] = None


class ClassificationAnnUpsert(BaseModel):
    path: str
    labels: list[str] = Field(default_factory=list)
    status: Literal["labeled", "skipped"] = "labeled"
    notes: Optional[str] = None


class ClassificationSummaryOut(BaseModel):
    total: int
    labeled: int
    skipped: int
    unlabeled: int
    by_user: dict[str, int] = Field(default_factory=dict)


class ClassificationBatchIn(BaseModel):
    paths: list[str]
