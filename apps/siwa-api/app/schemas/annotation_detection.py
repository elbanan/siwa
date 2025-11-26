"""
Pydantic schemas for object detection annotations.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field


class DetectionBox(BaseModel):
    id: str
    label: str
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(ge=0.0, le=1.0)
    height: float = Field(ge=0.0, le=1.0)


class DetectionAnnOut(BaseModel):
    path: str
    status: Literal["labeled", "skipped", "unlabeled"]
    boxes: list[DetectionBox] = Field(default_factory=list)

    annotated_by: Optional[str] = None
    annotated_by_name: Optional[str] = None
    annotated_at: Optional[str] = None
    updated_at: Optional[str] = None


class DetectionAnnUpsert(BaseModel):
    path: str
    status: Literal["labeled", "skipped", "unlabeled"] = "labeled"
    boxes: list[DetectionBox] = Field(default_factory=list)
    notes: Optional[str] = None


class DetectionSummaryOut(BaseModel):
    total: int
    labeled: int
    skipped: int
    unlabeled: int
    by_user: dict[str, int] = Field(default_factory=dict)
