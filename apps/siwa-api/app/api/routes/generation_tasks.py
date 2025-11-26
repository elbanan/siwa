"""
Generation task CRUD.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.models.generation_task import GenerationTask
from app.models.model_entry import ModelEntry
from app.schemas.generation_task import GenerationTaskCreate, GenerationTaskOut

router = APIRouter(prefix="/generation-tasks", tags=["generation_tasks"])


def _ensure_model(db: Session, model_id: str):
    entry = db.get(ModelEntry, model_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not found")
    return entry


@router.get("", response_model=list[GenerationTaskOut])
def list_tasks(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    tasks = db.query(GenerationTask).order_by(GenerationTask.created_at.desc()).all()
    return tasks


@router.post("", response_model=GenerationTaskOut)
def create_task(
    payload: GenerationTaskCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _ensure_model(db, payload.model_id)
    task = GenerationTask(
        id=str(uuid4()),
        name=payload.name,
        description=payload.description,
        model_id=payload.model_id,
        system_prompt=payload.system_prompt,
        params=payload.params.model_dump(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}")
def delete_task(
    task_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    task = db.get(GenerationTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return {"ok": True}
