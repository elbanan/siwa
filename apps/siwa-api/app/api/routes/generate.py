"""
Unified text generation endpoint.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.models.model_entry import ModelEntry
from app.schemas.generate import GenerateRequest, GenerateResponse
from app.services.ollama import generate_with_ollama
from app.services.local_torch_runner import run_local_model

router = APIRouter(prefix="/generate", tags=["generate"])


def _get_model(db: Session, model_id: str) -> ModelEntry:
    entry = db.get(ModelEntry, model_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not found")
    return entry


@router.post("", response_model=GenerateResponse)
def generate_text(
    payload: GenerateRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    entry = _get_model(db, payload.model_id)
    params = payload.params.dict()

    if entry.source_type == "ollama":
        model_name = (entry.source_config or {}).get("model_name")
        if not model_name:
            raise HTTPException(status_code=400, detail="Ollama config missing model_name")
        try:
            text, raw = generate_with_ollama(model_name, payload.prompt, params)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return GenerateResponse(
            model_id=entry.id,
            provider="ollama",
            output=text,
            raw_output=raw,
        )

    if entry.source_type == "torch_file":
        path = (entry.source_config or {}).get("path")
        if not path:
            raise HTTPException(status_code=400, detail="Torch model missing file path")
        try:
            text = run_local_model(
                path,
                payload.prompt,
                params,
                architecture_hint=(entry.source_config or {}).get("architecture"),
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return GenerateResponse(
            model_id=entry.id,
            provider="torch",
            output=text,
            raw_output={"note": "Local torch output", "text": text},
        )

    raise HTTPException(status_code=400, detail=f"Unsupported source type {entry.source_type}")
