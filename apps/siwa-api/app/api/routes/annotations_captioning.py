"""
Routes for image captioning annotations.
"""

from datetime import datetime
from typing import Dict
from uuid import uuid4
import os

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.access import ensure_dataset_access_level, ensure_owner_or_admin
from app.models.annotation_captioning import ImageCaptionAnnotation
from app.models.dataset import Dataset
from app.schemas.annotation_captioning import (
    CaptionAnnotationOut,
    CaptionAnnotationUpsert,
    CaptionSummaryOut,
    CaptionRecordList,
)
from app.services.caption_defaults import caption_defaults_for_files
from app.services.dataset_scanner import refresh_dataset_cached_counts
from app.services.local_scan import scan_local_folder

router = APIRouter(prefix="/datasets", tags=["annotations-captioning"])


def _collect_dataset_files(ds: Dataset) -> list[str]:
    source = ds.data_source or {}
    if source.get("type") != "local_folder":
        return []
    cfg = source.get("config") or {}
    root = cfg.get("path", "")
    pattern = cfg.get("pattern", "*")
    recursive = cfg.get("recursive", False)
    return scan_local_folder(root, pattern, recursive=recursive)


def _dataset_root(ds: Dataset) -> str:
    source = ds.data_source or {}
    cfg = source.get("config") or {}
    return os.path.expanduser(cfg.get("path", ""))


def _normalize_key(value: str) -> str:
    return os.path.normpath(value).lower()


@router.get("/{dataset_id}/annotations/captioning", response_model=CaptionAnnotationOut)
def get_caption_annotation(
    dataset_id: str,
    path: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    norm_path = _normalize_key(path)
    ann = (
        db.query(ImageCaptionAnnotation)
        .filter(
            ImageCaptionAnnotation.dataset_id == dataset_id,
            ImageCaptionAnnotation.file_path == norm_path,
        )
        .first()
    )
    if not ann:
        defaults = caption_defaults_for_files(ds, [path])
        default_caption = defaults.get(norm_path)
        return CaptionAnnotationOut(
            path=path,
            caption=default_caption or "",
            status="labeled" if default_caption else "unlabeled",
        )

    return CaptionAnnotationOut(
        path=path,
        caption=ann.caption or "",
        status=ann.status,
        annotated_by=ann.annotated_by,
        annotated_by_name=ann.annotated_by_name,
        annotated_at=ann.annotated_at.isoformat() if ann.annotated_at else None,
        updated_at=ann.updated_at.isoformat() if ann.updated_at else None,
    )


@router.post("/{dataset_id}/annotations/captioning", response_model=CaptionAnnotationOut)
def upsert_caption_annotation(
    dataset_id: str,
    payload: CaptionAnnotationUpsert,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "editor")

    norm_path = _normalize_key(payload.path)
    ann = (
        db.query(ImageCaptionAnnotation)
        .filter(
            ImageCaptionAnnotation.dataset_id == dataset_id,
            ImageCaptionAnnotation.file_path == norm_path,
        )
        .first()
    )

    if ann is None:
        ann = ImageCaptionAnnotation(
            id=str(uuid4()),
            dataset_id=dataset_id,
            file_path=norm_path,
            caption=payload.caption,
            status=payload.status,
            notes=payload.notes,
            annotated_by=user.id,
            annotated_by_name=user.email,
            annotated_at=datetime.utcnow(),
        )
        db.add(ann)
    else:
        ann.caption = payload.caption
        ann.status = payload.status
        ann.notes = payload.notes
        ann.annotated_by = user.id
        ann.annotated_by_name = user.email
        ann.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(ann)

    # Update dataset readiness flag
    files = _collect_dataset_files(ds)
    annotations_by_path = {
        a.file_path: a
        for a in db.query(ImageCaptionAnnotation)
        .filter(ImageCaptionAnnotation.dataset_id == dataset_id)
        .all()
    }
    labeled = 0
    default_captions = caption_defaults_for_files(ds, files)
    for path in files:
        norm = _normalize_key(path)
        ref = annotations_by_path.get(norm)
        if ref and ref.status == "labeled" and (ref.caption or "").strip():
            labeled += 1
            continue
        if default_captions.get(norm):
            labeled += 1
    if labeled >= len(files) and len(files) > 0:
        ds.status = "ready"
    else:
        ds.status = "configured"
    db.add(ds)
    db.commit()
    background.add_task(refresh_dataset_cached_counts, dataset_id)

    return CaptionAnnotationOut(
        path=payload.path,
        caption=ann.caption or "",
        status=ann.status,
        annotated_by=ann.annotated_by,
        annotated_by_name=ann.annotated_by_name,
        annotated_at=ann.annotated_at.isoformat() if ann.annotated_at else None,
        updated_at=ann.updated_at.isoformat() if ann.updated_at else None,
    )


@router.get("/{dataset_id}/annotations/captioning/summary", response_model=CaptionSummaryOut)
def captioning_summary(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    files = _collect_dataset_files(ds)
    total = len(files)
    annotations_by_path = {
        ann.file_path: ann
        for ann in db.query(ImageCaptionAnnotation)
        .filter(ImageCaptionAnnotation.dataset_id == dataset_id)
        .all()
    }
    default_captions = caption_defaults_for_files(ds, files)

    labeled = 0
    skipped = 0

    for path in files:
        norm = _normalize_key(path)
        ann = annotations_by_path.get(norm)
        if not ann:
            if default_captions.get(norm):
                labeled += 1
            continue
        if ann.status == "skipped":
            skipped += 1
        elif ann.status == "labeled" and (ann.caption or "").strip():
            labeled += 1

    unlabeled = max(int(total) - labeled - skipped, 0)

    by_user_rows = (
        db.query(
            ImageCaptionAnnotation.annotated_by_name,
            func.count(ImageCaptionAnnotation.id),
        )
        .filter(
            ImageCaptionAnnotation.dataset_id == dataset_id,
            ImageCaptionAnnotation.status == "labeled",
        )
        .group_by(ImageCaptionAnnotation.annotated_by_name)
        .all()
    )
    by_user: Dict[str, int] = {
        name: int(count or 0) for name, count in by_user_rows if name
    }

    if unlabeled == 0 and total > 0:
        ds.status = "ready"
        ds.annotation_status = "ready"
    else:
        ds.status = "configured"
        ds.annotation_status = "needs_annotation"
    db.add(ds)
    db.commit()

    return CaptionSummaryOut(
        total=int(total),
        labeled=labeled,
        skipped=skipped,
        unlabeled=unlabeled,
        by_user=by_user,
    )


@router.get("/{dataset_id}/annotations/captioning/records", response_model=CaptionRecordList)
def list_caption_records(
    dataset_id: str,
    offset: int = 0,
    limit: int = 200,
    search: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    files = _collect_dataset_files(ds)
    annotations_by_path = {
        ann.file_path: ann
        for ann in db.query(ImageCaptionAnnotation)
        .filter(ImageCaptionAnnotation.dataset_id == dataset_id)
        .all()
    }

    default_captions = caption_defaults_for_files(ds, files)
    records = []
    for path in files:
        norm = _normalize_key(path)
        ann = annotations_by_path.get(norm)
        records.append(
            {
                "path": path,
                "caption": ann.caption
                if ann and ann.caption
                else default_captions.get(norm, ""),
                "status": ann.status if ann else "unlabeled",
            }
        )

    if search:
        query = search.lower()
        records = [
            r
            for r in records
            if query in (r["caption"] or "").lower()
            or query in os.path.basename(r["path"]).lower()
        ]

    total = len(records)
    page = records[offset : offset + limit]

    return CaptionRecordList(
        dataset_id=dataset_id,
        root_path=_dataset_root(ds),
        total=total,
        offset=offset,
        limit=limit,
        records=page,
    )


@router.get("/{dataset_id}/annotations/captioning/export")
def export_caption_annotations(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    ensure_owner_or_admin(user)

    annotations = (
        db.query(ImageCaptionAnnotation)
        .filter(ImageCaptionAnnotation.dataset_id == dataset_id)
        .all()
    )
    data = [
        {
            "path": ann.file_path,
            "caption": ann.caption,
            "status": ann.status,
            "annotated_by": ann.annotated_by_name or ann.annotated_by,
        }
        for ann in annotations
    ]
    return {"dataset_id": dataset_id, "annotations": data}
