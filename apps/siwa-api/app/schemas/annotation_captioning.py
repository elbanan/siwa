"""
Pydantic schemas for image captioning annotations.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class CaptionAnnotationOut(BaseModel):
    path: str
    caption: str = ""
    status: Literal["labeled", "skipped", "unlabeled"] = "unlabeled"

    annotated_by: Optional[str] = None
    annotated_by_name: Optional[str] = None
    annotated_at: Optional[str] = None
    updated_at: Optional[str] = None


class CaptionAnnotationUpsert(BaseModel):
    path: str
    caption: str = ""
    status: Literal["labeled", "skipped"] = "labeled"
    notes: Optional[str] = None


class CaptionSummaryOut(BaseModel):
    total: int
    labeled: int
    skipped: int
    unlabeled: int
    by_user: dict[str, int] = Field(default_factory=dict)


class CaptionRecord(BaseModel):
    path: str
    caption: str = ""
    status: Literal["labeled", "skipped", "unlabeled"] = "unlabeled"


class CaptionRecordList(BaseModel):
    dataset_id: str
    root_path: str
    total: int
    offset: int
    limit: int
    records: list[CaptionRecord] = Field(default_factory=list)
