"""
Schemas for generation task configs.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.generate import GenerateParams


class ModelFieldBase(BaseModel):
    model_config = ConfigDict(protected_namespaces=())


class GenerationTaskBase(ModelFieldBase):
    name: str
    description: Optional[str] = None
    model_id: str
    system_prompt: str = ""
    params: GenerateParams = Field(default_factory=GenerateParams)


class GenerationTaskCreate(GenerationTaskBase):
    pass


class GenerationTaskOut(GenerationTaskBase):
    id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
