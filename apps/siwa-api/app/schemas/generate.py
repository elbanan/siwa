"""
Schemas for text generation endpoint.
"""

from typing import Optional, Dict, Any
from pydantic import BaseModel, ConfigDict, Field


class GenerateParams(BaseModel):
    temperature: Optional[float] = Field(default=0.7, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=0.9, ge=0.0, le=1.0)
    top_k: Optional[int] = Field(default=None, ge=0)
    max_tokens: Optional[int] = Field(default=256, ge=1, le=4096)
    presence_penalty: Optional[float] = Field(default=0.0, ge=-2.0, le=2.0)
    frequency_penalty: Optional[float] = Field(default=0.0, ge=-2.0, le=2.0)

class ModelFieldBase(BaseModel):
    model_config = ConfigDict(protected_namespaces=())


class GenerateRequest(ModelFieldBase):
    model_id: str
    prompt: str
    params: GenerateParams = Field(default_factory=GenerateParams)


class GenerateResponse(ModelFieldBase):
    model_id: str
    provider: str
    output: str
    raw_output: Dict[str, Any] | None = None
