"""
Pydantic schemas for model registry endpoints.
"""

from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, ConfigDict, Field


class ModelOut(BaseModel):
    id: str
    name: str
    source_type: str
    source_config: dict = Field(default_factory=dict)
    status: str
    error_message: Optional[str] = None
    checksum: Optional[str] = None
    details: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class OllamaModelInfo(BaseModel):
    name: str
    digest: Optional[str] = None
    size: Optional[int] = None
    modified_at: Optional[str] = None


class OllamaModelsResponse(BaseModel):
    models: list[OllamaModelInfo]
    error: Optional[str] = None

class ProtectedModelBase(BaseModel):
    model_config = ConfigDict(protected_namespaces=())


class ModelOllamaCreate(ProtectedModelBase):
    name: str
    model_name: str
    pull_now: bool = True
    server_host: str = "http://127.0.0.1:11434"


class ModelLocalCreate(BaseModel):
    name: str
    artifact_format: Literal["auto", "module", "state_dict", "state_bundle"] = "auto"
    architecture: Optional[str] = None


class ModelUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    architecture: Optional[str] = None
    details: Optional[dict] = None


class HuggingFaceModelInfo(BaseModel):
    name: str
    repo_id: str
    path: str
    modified_at: Optional[float] = None
    base_path: str


class HuggingFaceModelsResponse(BaseModel):
    models: list[HuggingFaceModelInfo]
    error: Optional[str] = None


class ModelHuggingFaceCreate(BaseModel):
    name: str
    path: str
    repo_id: Optional[str] = None
