"""
Routes for visual grounding annotations.
"""

from datetime import datetime
from typing import Dict, List
from uuid import uuid4
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.access import ensure_dataset_access_level, ensure_owner_or_admin
from app.models.dataset import Dataset
from app.models.annotation_grounding import ImageGroundingAnnotation
from app.schemas.annotation_grounding import (
    GroundingAnnOut,
    GroundingAnnUpsert,
    GroundingSummaryOut,
    GroundingRecordList,
    GroundingPair,
)
from app.services.local_scan import scan_local_folder
from app.services.grounding_defaults import (
    load_grounding_text_lookup,
    default_grounding_text_for_path,
)

router = APIRouter(prefix="/datasets", tags=["annotations-grounding"])


def _collect_dataset_files(ds: Dataset) -> list[str]:
    source = ds.data_source or {}
    if source.get("type") != "local_folder":
        return []
    cfg = source.get("config") or {}
    root = cfg.get("path", "")
    pattern = cfg.get("pattern", "*")
    recursive = cfg.get("recursive", False)
    return scan_local_folder(root, pattern, recursive=recursive)


def _normalize_key(value: str) -> str:
    return os.path.normpath(value).lower()


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _sanitize_pairs(pairs: List[GroundingPair | dict]) -> List[Dict]:
    sanitized: List[Dict] = []
    for raw in pairs:
        data = raw.model_dump() if isinstance(raw, GroundingPair) else raw
        text = (data.get("text") or "").strip()
        if not text:
            continue

        try:
            span_start = int(data.get("span_start", 0))
            span_end = int(data.get("span_end", 0))
        except (TypeError, ValueError):
            continue
        if span_end <= span_start:
            continue

        try:
            x = float(data.get("x", 0))
            y = float(data.get("y", 0))
            width = float(data.get("width", 0))
            height = float(data.get("height", 0))
        except (TypeError, ValueError):
            continue

        x = _clamp(x)
        y = _clamp(y)
        width = _clamp(width)
        height = _clamp(height)
        if x + width > 1.0:
            width = _clamp(1.0 - x)
        if y + height > 1.0:
            height = _clamp(1.0 - y)
        if width <= 0 or height <= 0:
            continue

        span_start = max(0, span_start)
        span_end = max(span_end, span_start + 1)
        color = (data.get("color") or "").strip() or None
        sanitized.append(
            {
                "id": str(data.get("id") or uuid4()),
                "text": text,
                "span_start": span_start,
                "span_end": span_end,
                "color": color,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
            }
        )
    return sanitized


def _dataset_root(ds: Dataset) -> str:
    source = ds.data_source or {}
    cfg = source.get("config") or {}
    return os.path.expanduser(cfg.get("path", ""))


@router.get("/{dataset_id}/annotations/grounding", response_model=GroundingAnnOut)
def get_grounding_annotation(
    dataset_id: str,
    path: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    ensure_dataset_access_level(db, user, dataset_id, "editor")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    norm_path = _normalize_key(path)
    ann = (
        db.query(ImageGroundingAnnotation)
        .filter(
            ImageGroundingAnnotation.dataset_id == dataset_id,
            ImageGroundingAnnotation.file_path == norm_path,
        )
        .first()
    )

    lookup = load_grounding_text_lookup(ds)
    default_caption = default_grounding_text_for_path(ds, path, lookup)
    caption_text = (ann.caption if ann and ann.caption else default_caption) or ""

    if not ann:
        return GroundingAnnOut(
            path=path,
            caption=caption_text,
            status="unlabeled",
            pairs=[],
        )

    return GroundingAnnOut(
        path=path,
        caption=caption_text,
        status=ann.status,
        pairs=ann.pairs or [],
        annotated_by=ann.annotated_by,
        annotated_by_name=ann.annotated_by_name,
        annotated_at=ann.annotated_at.isoformat() if ann.annotated_at else None,
        updated_at=ann.updated_at.isoformat() if ann.updated_at else None,
    )


@router.post("/{dataset_id}/annotations/grounding", response_model=GroundingAnnOut)
def upsert_grounding_annotation(
    dataset_id: str,
    payload: GroundingAnnUpsert,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "editor")

    pairs = _sanitize_pairs(payload.pairs)
    status = payload.status
    if status == "labeled" and not pairs:
        status = "unlabeled"

    caption_text = (payload.caption or "").strip()

    norm_path = _normalize_key(payload.path)
    ann = (
        db.query(ImageGroundingAnnotation)
        .filter(
            ImageGroundingAnnotation.dataset_id == dataset_id,
            ImageGroundingAnnotation.file_path == norm_path,
        )
        .first()
    )

    if ann is None:
        ann = ImageGroundingAnnotation(
            id=str(uuid4()),
            dataset_id=dataset_id,
            file_path=norm_path,
            caption=caption_text,
            pairs=pairs,
            status=status,
            notes=payload.notes,
            annotated_by=user.id,
            annotated_by_name=user.email,
            annotated_at=datetime.utcnow(),
        )
        db.add(ann)
    else:
        ann.caption = caption_text
        ann.pairs = pairs
        ann.status = status
        ann.notes = payload.notes
        ann.annotated_by = user.id
        ann.annotated_by_name = user.email
        ann.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(ann)

    files = _collect_dataset_files(ds)
    annotations_by_path = {
        a.file_path: a
        for a in db.query(ImageGroundingAnnotation)
        .filter(ImageGroundingAnnotation.dataset_id == dataset_id)
        .all()
    }
    labeled = 0
    skipped = 0
    for path in files:
        norm = _normalize_key(path)
        existing = annotations_by_path.get(norm)
        if existing:
            if existing.status == "skipped":
                skipped += 1
                continue
            if existing.pairs:
                labeled += 1
                continue
    unlabeled = max(len(files) - labeled - skipped, 0)
    if unlabeled == 0 and len(files) > 0:
        ds.status = "ready"
        ds.annotation_status = "ready"
    else:
        ds.status = "configured"
        ds.annotation_status = "needs_annotation"
    db.add(ds)
    db.commit()

    return GroundingAnnOut(
        path=payload.path,
        caption=caption_text,
        status=ann.status,
        pairs=ann.pairs or [],
        annotated_by=ann.annotated_by,
        annotated_by_name=ann.annotated_by_name,
        annotated_at=ann.annotated_at.isoformat() if ann.annotated_at else None,
        updated_at=ann.updated_at.isoformat() if ann.updated_at else None,
    )


@router.get(
    "/{dataset_id}/annotations/grounding/summary",
    response_model=GroundingSummaryOut,
)
def grounding_summary(
    dataset_id: str,
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
        for ann in db.query(ImageGroundingAnnotation)
        .filter(ImageGroundingAnnotation.dataset_id == dataset_id)
        .all()
    }

    labeled = 0
    skipped = 0
    for path in files:
        norm = _normalize_key(path)
        ann = annotations_by_path.get(norm)
        if not ann:
            continue
        if ann.status == "skipped":
            skipped += 1
        elif ann.pairs:
            labeled += 1

    unlabeled = max(len(files) - labeled - skipped, 0)

    by_user_rows = (
        db.query(
            ImageGroundingAnnotation.annotated_by_name,
            func.count(ImageGroundingAnnotation.id),
        )
        .filter(
            ImageGroundingAnnotation.dataset_id == dataset_id,
            ImageGroundingAnnotation.status == "labeled",
        )
        .group_by(ImageGroundingAnnotation.annotated_by_name)
        .all()
    )
    by_user: Dict[str, int] = {
        name: int(count or 0) for name, count in by_user_rows if name
    }

    if unlabeled == 0 and len(files) > 0:
        ds.status = "ready"
        ds.annotation_status = "ready"
    else:
        ds.status = "configured"
        ds.annotation_status = "needs_annotation"
    db.add(ds)
    db.commit()

    return GroundingSummaryOut(
        total=len(files),
        labeled=labeled,
        skipped=skipped,
        unlabeled=unlabeled,
        by_user=by_user,
    )


@router.get(
    "/{dataset_id}/annotations/grounding/records",
    response_model=GroundingRecordList,
)
def list_grounding_records(
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
        for ann in db.query(ImageGroundingAnnotation)
        .filter(ImageGroundingAnnotation.dataset_id == dataset_id)
        .all()
    }

    lookup = load_grounding_text_lookup(ds)
    records = []
    for path in files:
        norm = _normalize_key(path)
        ann = annotations_by_path.get(norm)
        caption = ""
        if ann and ann.caption:
            caption = ann.caption
        else:
            caption = default_grounding_text_for_path(ds, path, lookup) or ""
        status = ann.status if ann else "unlabeled"
        records.append({"path": path, "caption": caption, "status": status})

    if search:
        query = search.lower()
        records = [
            record
            for record in records
            if query in (record["caption"] or "").lower()
            or query in os.path.basename(record["path"]).lower()
        ]

    total = len(records)
    page = records[offset : offset + limit]

    return GroundingRecordList(
        dataset_id=dataset_id,
        root_path=_dataset_root(ds),
        total=total,
        offset=offset,
        limit=limit,
        records=page,
    )


@router.get(
    "/{dataset_id}/annotations/grounding/export",
)
def export_grounding_annotations(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    ensure_owner_or_admin(user)

    files = _collect_dataset_files(ds)
    annotations_by_path = {
        ann.file_path: ann
        for ann in db.query(ImageGroundingAnnotation)
        .filter(ImageGroundingAnnotation.dataset_id == dataset_id)
        .all()
    }
    lookup = load_grounding_text_lookup(ds)

    payload = []
    for path in files:
        norm = _normalize_key(path)
        ann = annotations_by_path.get(norm)
        caption = (
            (ann.caption if ann and ann.caption else "")
            or default_grounding_text_for_path(ds, path, lookup)
            or ""
        )
        payload.append(
            {
                "path": path,
                "caption": caption,
                "pairs": ann.pairs if ann else [],
                "status": ann.status if ann else ("labeled" if caption else "unlabeled"),
                "annotated_by": ann.annotated_by_name if ann else None,
            }
        )

    return {"dataset_id": dataset_id, "annotations": payload}
