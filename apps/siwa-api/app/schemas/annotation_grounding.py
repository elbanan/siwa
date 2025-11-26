from typing import Literal, Optional

from pydantic import BaseModel, Field


class GroundingPair(BaseModel):
    id: str
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(ge=0.0, le=1.0)
    height: float = Field(ge=0.0, le=1.0)
    span_start: int = Field(ge=0)
    span_end: int = Field(ge=0)
    text: str
    color: Optional[str] = None


class GroundingAnnOut(BaseModel):
    path: str
    status: Literal["labeled", "skipped", "unlabeled"]
    caption: str = ""
    pairs: list[GroundingPair] = Field(default_factory=list)

    annotated_by: Optional[str] = None
    annotated_by_name: Optional[str] = None
    annotated_at: Optional[str] = None
    updated_at: Optional[str] = None


class GroundingAnnUpsert(BaseModel):
    path: str
    status: Literal["labeled", "skipped", "unlabeled"] = "labeled"
    caption: Optional[str] = None
    pairs: list[GroundingPair] = Field(default_factory=list)
    notes: Optional[str] = None


class GroundingSummaryOut(BaseModel):
    total: int
    labeled: int
    skipped: int
    unlabeled: int
    by_user: dict[str, int] = Field(default_factory=dict)


class GroundingRecord(BaseModel):
    path: str
    caption: str
    status: Literal["labeled", "skipped", "unlabeled"]


class GroundingRecordList(BaseModel):
    dataset_id: str
    root_path: str
    total: int
    offset: int
    limit: int
    records: list[GroundingRecord] = Field(default_factory=list)
