"""
Routes for object detection annotations.
"""

from uuid import uuid4
from datetime import datetime
from typing import List, Dict
import os

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.api.deps import get_db, get_current_user
from app.core.access import ensure_dataset_access_level, ensure_owner_or_admin
from app.models.dataset import Dataset
from app.models.annotation_detection import ImageDetectionAnnotation
from app.schemas.annotation_detection import (
    DetectionAnnOut,
    DetectionAnnUpsert,
    DetectionSummaryOut,
    DetectionBox,
)
from app.services.local_scan import scan_local_folder
from app.services.detection_csv import has_negative_default, strip_negative_defaults
from app.services.detection_defaults import detection_defaults_for_files
from app.services.dataset_scanner import refresh_dataset_cached_counts
from app.services.image_io import load_image_or_dicom

router = APIRouter(prefix="/datasets", tags=["annotations-detection"])


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


def _sanitize_boxes(boxes: List[DetectionBox | dict]) -> List[Dict]:
    sanitized: List[Dict] = []
    for raw in boxes:
        data = raw.model_dump() if isinstance(raw, DetectionBox) else raw
        label = (data.get("label") or "").strip()
        if not label:
            continue
        box_id = data.get("id") or str(uuid4())
        try:
            x = float(data.get("x", 0))
            y = float(data.get("y", 0))
            width = float(data.get("width", 0))
            height = float(data.get("height", 0))
        except (TypeError, ValueError):
            continue
        x = max(0.0, min(1.0, x))
        y = max(0.0, min(1.0, y))
        width = max(0.0, min(1.0, width))
        height = max(0.0, min(1.0, height))
        if x + width > 1.0:
            width = max(0.0, 1.0 - x)
        if y + height > 1.0:
            height = max(0.0, 1.0 - y)
        if width <= 0 or height <= 0:
            continue
        sanitized.append(
            {
                "id": str(box_id),
                "label": label,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
            }
        )
    return sanitized


@router.get("/{dataset_id}/annotations/detection", response_model=DetectionAnnOut)
def get_detection_annotation(
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
        db.query(ImageDetectionAnnotation)
        .filter(
            ImageDetectionAnnotation.dataset_id == dataset_id,
            ImageDetectionAnnotation.file_path == norm_path,
        )
        .first()
    )

    if not ann:
        defaults = detection_defaults_for_files(ds, [path])
        default_boxes_raw = defaults.get(norm_path) or []
        default_boxes = strip_negative_defaults(default_boxes_raw)
        if default_boxes:
            return DetectionAnnOut(path=path, status="labeled", boxes=default_boxes)
        if default_boxes_raw and has_negative_default(default_boxes_raw):
            return DetectionAnnOut(path=path, status="labeled", boxes=[])
        return DetectionAnnOut(path=path, status="unlabeled", boxes=[])

    return DetectionAnnOut(
        path=path,
        status=ann.status,
        boxes=ann.boxes or [],
        annotated_by=ann.annotated_by,
        annotated_by_name=ann.annotated_by_name,
        annotated_at=ann.annotated_at.isoformat() if ann.annotated_at else None,
        updated_at=ann.updated_at.isoformat() if ann.updated_at else None,
    )


@router.post("/{dataset_id}/annotations/detection", response_model=DetectionAnnOut)
def upsert_detection_annotation(
    dataset_id: str,
    payload: DetectionAnnUpsert,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "editor")

    boxes = _sanitize_boxes(payload.boxes)
    status = payload.status
    if status == "labeled" and not boxes:
        status = "unlabeled"

    norm_path = _normalize_key(payload.path)
    ann = (
        db.query(ImageDetectionAnnotation)
        .filter(
            ImageDetectionAnnotation.dataset_id == dataset_id,
            ImageDetectionAnnotation.file_path == norm_path,
        )
        .first()
    )

    if ann is None:
        ann = ImageDetectionAnnotation(
            id=str(uuid4()),
            dataset_id=dataset_id,
            file_path=norm_path,
            boxes=boxes,
            status=status,
            notes=payload.notes,
            annotated_by=user.id,
            annotated_by_name=user.email,
            annotated_at=datetime.utcnow(),
        )
        db.add(ann)
    else:
        ann.boxes = boxes
        ann.status = status
        ann.notes = payload.notes
        ann.annotated_by = user.id
        ann.annotated_by_name = user.email
        ann.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(ann)

    # Update dataset annotation state
    files = _collect_dataset_files(ds)
    annotations_by_path = {
        a.file_path: a
        for a in db.query(ImageDetectionAnnotation)
        .filter(ImageDetectionAnnotation.dataset_id == dataset_id)
        .all()
    }
    default_boxes = detection_defaults_for_files(ds, files)
    labeled = 0
    skipped = 0
    for f in files:
        norm = _normalize_key(f)
        existing = annotations_by_path.get(norm)
        if existing:
            if existing.status == "skipped":
                skipped += 1
                continue
            if existing.boxes:
                labeled += 1
                continue
        if default_boxes.get(norm):
            labeled += 1
    unlabeled = max(len(files) - labeled - skipped, 0)
    if unlabeled == 0 and len(files) > 0:
        ds.status = "ready"
        ds.annotation_status = "ready"
    else:
        ds.status = "configured"
        ds.annotation_status = "needs_annotation"
    db.add(ds)
    db.commit()
    background.add_task(refresh_dataset_cached_counts, dataset_id)

    return DetectionAnnOut(
        path=payload.path,
        status=ann.status,
        boxes=ann.boxes or [],
        annotated_by=ann.annotated_by,
        annotated_by_name=ann.annotated_by_name,
        annotated_at=ann.annotated_at.isoformat() if ann.annotated_at else None,
        updated_at=ann.updated_at.isoformat() if ann.updated_at else None,
    )


@router.get("/{dataset_id}/annotations/detection/summary", response_model=DetectionSummaryOut)
def detection_summary(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    files = _collect_dataset_files(ds)
    annotations_by_path = {
        ann.file_path: ann
        for ann in db.query(ImageDetectionAnnotation)
        .filter(ImageDetectionAnnotation.dataset_id == dataset_id)
        .all()
    }
    default_boxes = detection_defaults_for_files(ds, files)
    default_boxes = detection_defaults_for_files(ds, files)

    labeled = 0
    skipped = 0
    for path in files:
        norm = _normalize_key(path)
        ann = annotations_by_path.get(norm)
        if ann:
            if ann.status == "skipped":
                skipped += 1
                continue
            if ann.boxes:
                labeled += 1
                continue
        if default_boxes.get(norm):
            labeled += 1
    unlabeled = max(len(files) - labeled - skipped, 0)

    by_user_rows = (
        db.query(
            ImageDetectionAnnotation.annotated_by_name,
            func.count(ImageDetectionAnnotation.id),
        )
        .filter(
            ImageDetectionAnnotation.dataset_id == dataset_id,
            ImageDetectionAnnotation.status == "labeled",
        )
        .group_by(ImageDetectionAnnotation.annotated_by_name)
        .all()
    )
    by_user: Dict[str, int] = {name: int(count) for name, count in by_user_rows if name}

    if unlabeled == 0 and len(files) > 0:
        ds.status = "ready"
        ds.annotation_status = "ready"
    else:
        ds.status = "configured"
        ds.annotation_status = "needs_annotation"
    db.add(ds)
    db.commit()

    return DetectionSummaryOut(
        total=len(files),
        labeled=labeled,
        skipped=skipped,
        unlabeled=unlabeled,
        by_user=by_user,
    )


@router.get("/{dataset_id}/annotations/detection/export")
def export_detection_annotations(
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
    annotations_by_path = {
        ann.file_path: ann
        for ann in db.query(ImageDetectionAnnotation)
        .filter(ImageDetectionAnnotation.dataset_id == dataset_id)
        .all()
    }
    
    # Load default boxes for files without annotations
    default_boxes = detection_defaults_for_files(ds, files)


    def to_export_box(box: Dict, width: int | None, height: int | None) -> Dict:
        x_norm = float(box.get("x", 0))
        y_norm = float(box.get("y", 0))
        w_norm = float(box.get("width", 0))
        h_norm = float(box.get("height", 0))
        x_px = box.get("x_px")
        y_px = box.get("y_px")
        w_px = box.get("width_px")
        h_px = box.get("height_px")
        if width and x_px is None:
            x_px = x_norm * width
        if height and y_px is None:
            y_px = y_norm * height
        if width and w_px is None:
            w_px = w_norm * width
        if height and h_px is None:
            h_px = h_norm * height
        return {
            "id": box.get("id"),
            "label": box.get("label"),
            "x": x_norm,
            "y": y_norm,
            "width": w_norm,
            "height": h_norm,
            "x_px": x_px,
            "y_px": y_px,
            "width_px": w_px,
            "height_px": h_px,
            "image_width": width,
            "image_height": height,
        }

    export_payload = []
    for path in files:
        width: int | None = None
        height: int | None = None
        try:
            img = load_image_or_dicom(path)
            if hasattr(img, "size"):
                width, height = img.size
        except Exception:
            width = height = None
        norm = _normalize_key(path)
        ann = annotations_by_path.get(norm)
        if ann:
            export_payload.append(
                {
                    "path": path,
                    "status": ann.status,
                    "boxes": [
                        to_export_box(box, width, height) for box in (ann.boxes or [])
                    ],
                    "annotated_by": ann.annotated_by_name,
                    "image_width": width,
                    "image_height": height,
                }
            )
        else:
            raw_defaults = default_boxes.get(norm, [])
            filtered_defaults = strip_negative_defaults(raw_defaults)
            default_list = [
                to_export_box(box, width, height) for box in filtered_defaults
            ]
            status = (
                "labeled"
                if filtered_defaults or has_negative_default(raw_defaults)
                else "unlabeled"
            )
            export_payload.append(
                {
                    "path": path,
                    "status": status,
                    "boxes": default_list,
                    "annotated_by": None,
                    "image_width": width,
                    "image_height": height,
                }
            )

    return JSONResponse(content=export_payload)
