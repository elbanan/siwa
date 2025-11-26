"""
Dataset schemas for CRUD.

Adds:
- project_name
- class_names
- ds_metadata
- split
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal, Any


class DataSource(BaseModel):
    type: Literal["local_folder", "local_file_list", "local_csv", "minio", "s3", "http"]
    config: dict


class AnnotationSource(BaseModel):
    format: str
    config: dict


class DatasetCreate(BaseModel):
    name: str
    project_name: str = "default"
    description: str = ""
    tags: list[str] = Field(default_factory=list)

    modality: Literal["image", "text"]
    task_type: str

    data_source: DataSource
    annotation_source: Optional[AnnotationSource] = None

    has_annotations: bool = False

    # new
    class_names: list[str] = Field(default_factory=list)
    ds_metadata: dict = Field(default_factory=dict)
    split: Optional[dict] = None


class DatasetUpdate(BaseModel):
    name: Optional[str] = None
    project_name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None

    modality: Optional[str] = None
    task_type: Optional[str] = None

    data_source: Optional[DataSource] = None
    annotation_source: Optional[AnnotationSource] = None
    has_annotations: Optional[bool] = None

    # new
    class_names: Optional[list[str]] = None
    ds_metadata: Optional[dict] = None
    split: Optional[dict] = None


class DatasetOut(BaseModel):
    id: str
    name: str
    project_name: str = "default"
    description: str = ""
    tags: list[str] = Field(default_factory=list)

    modality: str
    task_type: Optional[str] = None

    data_source: dict
    annotation_source: Optional[dict] = None

    class_names: list[str] = Field(default_factory=list)
    ds_metadata: dict = Field(default_factory=dict)
    split: Optional[dict] = None

    annotation_status: str = "unknown"
    status: str = "configured"
    asset_count: int = 0
    access_level: Optional[str] = None
    annotation_progress: int = 0
    annotation_progress: int = 0
    annotation_progress: int = 0
    annotation_progress: float = 0.0
    annotation_total: int = 0
    annotation_done: int = 0
    annotation_progress: int | None = None
    annotated_count: int | None = None
    annotation_progress: float = 0.0
    annotation_progress: int | None = None
