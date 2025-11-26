"""
Routes for image classification annotation.
All paths are absolute file paths from scan, but we treat them as identifiers
and never write to disk.

Endpoints:
- GET  /datasets/{id}/annotations/classification?path=...
- POST /datasets/{id}/annotations/classification
- GET  /datasets/{id}/annotations/classification/summary
- POST /datasets/{id}/annotations/classification/batch
"""

from uuid import uuid4
from datetime import datetime
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
import os
from fastapi.responses import JSONResponse

from app.api.deps import get_db, get_current_user
from app.models.dataset import Dataset
from app.core.access import ensure_dataset_access_level, ensure_owner_or_admin
from app.models.annotation_classification import ImageClassificationAnnotation
from app.schemas.annotation_classification import (
    ClassificationAnnOut,
    ClassificationAnnUpsert,
    ClassificationSummaryOut,
    ClassificationBatchIn,
)
from app.services.annotation_insights import class_counts_for_files
from app.services.local_scan import scan_local_folder

router = APIRouter(prefix="/datasets", tags=["annotations-classification"])


def _collect_dataset_files(ds: Dataset) -> list[str]:
    source = ds.data_source
    if source["type"] != "local_folder":
        return []
    cfg = source.get("config") or {}
    root = cfg.get("path", "")
    pattern = cfg.get("pattern", "*")
    recursive = cfg.get("recursive", False)
    return scan_local_folder(root, pattern, recursive=recursive)


def _normalize_key(value: str) -> str:
    return os.path.normpath(value).lower()


def _default_label_lookup(ds: Dataset, files: list[str]) -> Dict[str, str]:
    """
    Build a normalized lookup of default labels (from csv/folder config)
    for the provided file paths.
    """
    defaults, _ = class_counts_for_files(ds, files)
    normalized: Dict[str, str] = {}
    for raw_path, label in defaults.items():
        norm_path = _normalize_key(raw_path)
        normalized[norm_path] = label
        base = os.path.basename(raw_path)
        if base:
            normalized[_normalize_key(base)] = label
    return normalized


@router.get("/{dataset_id}/annotations/classification", response_model=ClassificationAnnOut)
def get_classification_annotation(
    dataset_id: str,
    path: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    norm_path = _normalize_key(path)

    ann = (
        db.query(ImageClassificationAnnotation)
        .filter(
            ImageClassificationAnnotation.dataset_id == dataset_id,
            ImageClassificationAnnotation.file_path == norm_path,
        )
        .first()
    )

    defaults = _default_label_lookup(ds, [path])
    def _default_for(p: str) -> str | None:
        key = _normalize_key(p)
        if key in defaults:
            return defaults[key]
        base = os.path.basename(p)
        return defaults.get(_normalize_key(base))

    if not ann:
        default_label = _default_for(path)
        return ClassificationAnnOut(
            path=path,
            status="labeled" if default_label else "unlabeled",
            labels=[default_label] if default_label else [],
        )

    return ClassificationAnnOut(
        path=path,
        status=ann.status,
        labels=ann.labels or [],
        annotated_by=ann.annotated_by,
        annotated_by_name=ann.annotated_by_name,
        annotated_at=ann.annotated_at.isoformat() if ann.annotated_at else None,
        updated_at=ann.updated_at.isoformat() if ann.updated_at else None,
    )


@router.post("/{dataset_id}/annotations/classification", response_model=ClassificationAnnOut)
def upsert_classification_annotation(
    dataset_id: str,
    payload: ClassificationAnnUpsert,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "editor")

    ann = (
        db.query(ImageClassificationAnnotation)
        .filter(
            ImageClassificationAnnotation.dataset_id == dataset_id,
            ImageClassificationAnnotation.file_path == _normalize_key(payload.path),
        )
        .first()
    )

    if ann is None:
        ann = ImageClassificationAnnotation(
            id=str(uuid4()),
            dataset_id=dataset_id,
            file_path=_normalize_key(payload.path),
            labels=payload.labels,
            status=payload.status,
            is_multi_label=(ds.ds_metadata or {}).get("multi_label", False),
            notes=payload.notes,
            annotated_by=user.id,
            annotated_by_name=user.email,
            annotated_at=datetime.utcnow(),
        )
        db.add(ann)
    else:
        ann.labels = payload.labels
        ann.status = payload.status
        ann.notes = payload.notes
        ann.annotated_by = user.id
        ann.annotated_by_name = user.email
        ann.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(ann)

    # update dataset status based on completion (annotated + defaults)
    files = _collect_dataset_files(ds)
    defaults = _default_label_lookup(ds, files)
    annotations_by_path = {
        a.file_path: a
        for a in db.query(ImageClassificationAnnotation)
        .filter(ImageClassificationAnnotation.dataset_id == dataset_id)
        .all()
    }
    labeled = 0
    for f in files:
        norm = _normalize_key(f)
        ann_for = annotations_by_path.get(norm)
        if ann_for:
            if ann_for.labels:
                labeled += 1
            continue
        base_key = _normalize_key(os.path.basename(f))
        if norm in defaults or base_key in defaults:
            labeled += 1
    if labeled >= len(files) and len(files) > 0:
        ds.status = "ready"
    else:
        ds.status = "configured"
    db.add(ds)
    db.commit()

    return ClassificationAnnOut(
        path=ann.file_path,
        status=ann.status,
        labels=ann.labels or [],
        annotated_by=ann.annotated_by,
        annotated_by_name=ann.annotated_by_name,
        annotated_at=ann.annotated_at.isoformat() if ann.annotated_at else None,
        updated_at=ann.updated_at.isoformat() if ann.updated_at else None,
    )


@router.get("/{dataset_id}/annotations/classification/summary", response_model=ClassificationSummaryOut)
def classification_summary(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    files = _collect_dataset_files(ds)
    total = len(files)
    default_label_map = _default_label_lookup(ds, files)

    annotations_by_path = {
        ann.file_path: ann
        for ann in db.query(ImageClassificationAnnotation)
        .filter(ImageClassificationAnnotation.dataset_id == dataset_id)
        .all()
    }

    labeled = 0
    skipped = 0

    for path in files:
        norm_path = _normalize_key(path)
        ann = annotations_by_path.get(norm_path)
        if ann:
            if ann.status == "skipped":
                skipped += 1
            elif ann.labels:
                labeled += 1
            # when an explicit annotation exists (even unlabeled) skip defaults
            continue

        # fallback to defaults inferred from dataset config only if no annotation exists
        default_label = default_label_map.get(norm_path) or default_label_map.get(
            _normalize_key(os.path.basename(path))
        )
        if default_label:
            labeled += 1

    unlabeled = max(int(total) - labeled - skipped, 0)

    by_user_rows = (
        db.query(
            ImageClassificationAnnotation.annotated_by_name,
            func.count(ImageClassificationAnnotation.id),
        )
        .filter(
            ImageClassificationAnnotation.dataset_id == dataset_id,
            ImageClassificationAnnotation.status == "labeled",
        )
        .group_by(ImageClassificationAnnotation.annotated_by_name)
        .all()
    )
    by_user: Dict[str, int] = {name: int(c) for name, c in by_user_rows}

    # Update dataset status to reflect completeness
    if unlabeled == 0:
        ds.status = "ready"
        ds.annotation_status = "ready"
    else:
        ds.status = "configured"
        ds.annotation_status = "needs_annotation"
    db.add(ds)
    db.commit()

    return ClassificationSummaryOut(
        total=int(total),
        labeled=labeled,
        skipped=skipped,
        unlabeled=unlabeled,
        by_user=by_user,
    )


@router.post("/{dataset_id}/annotations/classification/batch")
def classification_batch(
    dataset_id: str,
    payload: ClassificationBatchIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    normalized_paths = [_normalize_key(p) for p in payload.paths]
    anns = (
        db.query(ImageClassificationAnnotation)
        .filter(
            ImageClassificationAnnotation.dataset_id == dataset_id,
            ImageClassificationAnnotation.file_path.in_(normalized_paths),
        )
        .all()
    )
    annotations_by_norm = {a.file_path: a for a in anns}
    out: Dict[str, Dict[str, list[str] | str]] = {}
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    default_labels: Dict[str, str] = _default_label_lookup(ds, payload.paths)

    def normalized_path(path: str) -> str:
        return os.path.normpath(path).lower()

    for path in payload.paths:
        norm = normalized_path(path)
        if path in out:
            continue

        ann = annotations_by_norm.get(norm)
        if ann:
            out[path] = {"status": ann.status, "labels": ann.labels or []}
            continue

        label = default_labels.get(norm) or default_labels.get(
            normalized_path(os.path.basename(path))
        )
        if label:
            out[path] = {"status": "labeled", "labels": [label]}
        else:
            out[path] = {"status": "unlabeled", "labels": []}

    return out


@router.get("/{dataset_id}/annotations/classification/export")
def export_classification_annotations(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    ensure_owner_or_admin(user)

    files = _collect_dataset_files(ds)
    defaults = _default_label_lookup(ds, files)
    annotations_by_path = {
        ann.file_path: ann
        for ann in db.query(ImageClassificationAnnotation)
        .filter(ImageClassificationAnnotation.dataset_id == dataset_id)
        .all()
    }

    export_payload = []
    for path in files:
        norm = _normalize_key(path)
        ann = annotations_by_path.get(norm)
        if ann:
            export_payload.append(
                {
                    "path": path,
                    "labels": ann.labels or [],
                    "status": ann.status,
                    "annotated_by": ann.annotated_by_name,
                }
            )
            continue
        default_label = defaults.get(norm) or defaults.get(_normalize_key(os.path.basename(path)))
        export_payload.append(
            {
                "path": path,
                "labels": [default_label] if default_label else [],
                "status": "labeled" if default_label else "unlabeled",
                "annotated_by": None,
            }
        )

    return JSONResponse(content=export_payload)
