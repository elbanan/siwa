"""
Model registry routes.
"""

from __future__ import annotations

import os
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    UploadFile,
    File,
    Form,
    Query,
)
from sqlalchemy.orm import Session
import shutil

from app.api.deps import get_db, get_current_user
from app.core.config import settings
from app.models.model_entry import ModelEntry
from app.schemas.model import (
    ModelOut,
    OllamaModelsResponse,
    ModelOllamaCreate,
    ModelUpdate,
    HuggingFaceModelsResponse,
    ModelHuggingFaceCreate,
)
from app.services.ollama import list_local_models, find_model
from app.services.model_store import persist_upload, compute_checksum, analyze_torch_artifact
from app.services.hf_local import list_local_hf_models


router = APIRouter(prefix="/models", tags=["models"])


def _get_model_or_404(db: Session, model_id: str) -> ModelEntry:
    entry = db.get(ModelEntry, model_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not found")
    return entry


def _cleanup_torch_artifact(entry: ModelEntry):
    if entry.source_type != "torch_file":
        return
    path = (entry.source_config or {}).get("path")
    if not path:
        return
    base_dir = os.path.dirname(path)
    try:
        if os.path.exists(base_dir):
            shutil.rmtree(base_dir)
    except Exception:
        pass


@router.get("", response_model=list[ModelOut])
def list_models(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    entries = db.query(ModelEntry).order_by(ModelEntry.created_at.desc()).all()
    return entries


@router.get("/sources/ollama", response_model=OllamaModelsResponse)
def list_ollama_sources(
    user=Depends(get_current_user),
):
    models, error = list_local_models()
    return OllamaModelsResponse(models=models, error=error)


@router.get("/sources/huggingface", response_model=HuggingFaceModelsResponse)
def list_huggingface_sources(
    base_path: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    models, error = list_local_hf_models(base_path)
    return HuggingFaceModelsResponse(models=models, error=error)


@router.post("/ollama", response_model=ModelOut)
def register_ollama_model(
    payload: ModelOllamaCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    match, error = find_model(payload.model_name)
    if error:
        raise HTTPException(status_code=400, detail=error)
    if not match:
        raise HTTPException(
            status_code=404,
            detail=f"Ollama model '{payload.model_name}' not found locally.",
        )

    status = "ready" if payload.pull_now else "pending"
    entry = ModelEntry(
        id=str(uuid4()),
        name=payload.name,
        source_type="ollama",
        source_config={
            "model_name": payload.model_name,
            "server": payload.server_host,
        },
        status=status,
        details={
            "ollama": match,
            "pull_requested": payload.pull_now,
            "server_host": payload.server_host,
            "ready_state": status,
        },
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/local", response_model=ModelOut)
def register_local_torch_model(
    name: str = Form(...),
    artifact_format: str = Form("auto"),
    architecture: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file is missing a filename.")

    model_id = str(uuid4())
    dest_dir = os.path.join(settings.SIWA_HOME, "models", model_id)
    os.makedirs(dest_dir, exist_ok=True)

    saved_path = persist_upload(file, dest_dir)
    file_size = os.path.getsize(saved_path)
    checksum = compute_checksum(saved_path)
    artifact_type, analysis = analyze_torch_artifact(saved_path)

    effective_format = artifact_format if artifact_format != "auto" else artifact_type
    status = "ready" if "error" not in analysis else "error"
    error_message = analysis.get("error")

    entry = ModelEntry(
        id=model_id,
        name=name,
        source_type="torch_file",
        source_config={
            "path": saved_path,
            "original_filename": file.filename,
            "artifact_format": effective_format,
            "architecture": architecture,
        },
        status=status,
        error_message=error_message,
        checksum=checksum,
        details={
            "file_size_bytes": file_size,
            "artifact_type": artifact_type,
            "analysis": analysis,
        },
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/huggingface", response_model=ModelOut)
def register_huggingface_model(
    payload: ModelHuggingFaceCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    path = os.path.expanduser(payload.path)
    if not os.path.exists(path):
        raise HTTPException(status_code=400, detail=f"Path not found: {path}")

    entry = ModelEntry(
        id=str(uuid4()),
        name=payload.name,
        source_type="huggingface",
        source_config={
            "path": path,
            "repo_id": payload.repo_id or os.path.basename(path),
        },
        status="ready",
        details={
            "huggingface": {
                "repo_id": payload.repo_id or "",
                "path": path,
            }
        },
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{model_id}", response_model=ModelOut)
def get_model(
    model_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    entry = _get_model_or_404(db, model_id)
    return entry


@router.patch("/{model_id}", response_model=ModelOut)
def update_model(
    model_id: str,
    payload: ModelUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    entry = _get_model_or_404(db, model_id)

    if payload.name is not None:
        entry.name = payload.name
    if payload.status is not None:
        entry.status = payload.status
        if payload.status == "ready":
            entry.error_message = None
    if payload.architecture is not None:
        cfg = dict(entry.source_config or {})
        if payload.architecture:
            cfg["architecture"] = payload.architecture
        else:
            cfg.pop("architecture", None)
        entry.source_config = cfg
    if payload.details is not None:
        entry.details = payload.details

    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{model_id}")
def delete_model(
    model_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    entry = _get_model_or_404(db, model_id)
    _cleanup_torch_artifact(entry)
    db.delete(entry)
    db.commit()
    return {"ok": True}
