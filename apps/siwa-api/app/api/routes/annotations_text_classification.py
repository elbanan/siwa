"""
Routes for text classification annotations.
"""

from uuid import uuid4
from datetime import datetime
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
import csv
import io

from app.api.deps import get_db, get_current_user
from app.core.access import ensure_dataset_access_level, ensure_owner_or_admin
from app.models.dataset import Dataset
from app.models.annotation_text_classification import TextClassificationAnnotation
from app.schemas.annotation_text_classification import (
    TextClassificationAnnOut,
    TextClassificationAnnUpsert,
    TextClassificationSummary,
)
from app.services.text_dataset import read_text_rows


router = APIRouter(prefix="/datasets", tags=["annotations-text-classification"])


def _find_row(dataset: Dataset, record_id: str) -> dict | None:
    rows = read_text_rows(dataset)
    for row in rows:
        if row["id"] == record_id:
            return row
    return None


@router.get("/{dataset_id}/annotations/text-classification", response_model=TextClassificationAnnOut)
def get_text_classification_annotation(
    dataset_id: str,
    record_id: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    row = _find_row(ds, record_id)
    if not row:
        raise HTTPException(status_code=404, detail="Record not found in CSV")

    ann = (
        db.query(TextClassificationAnnotation)
        .filter(
            TextClassificationAnnotation.dataset_id == dataset_id,
            TextClassificationAnnotation.record_id == record_id,
        )
        .first()
    )

    if not ann:
        label = row.get("label", "")
        status = "labeled" if label else "unlabeled"
        return TextClassificationAnnOut(
            record_id=record_id,
            text=row.get("text", ""),
            label=label,
            status=status,
        )

    return TextClassificationAnnOut(
        record_id=record_id,
        text=ann.text_value,
        label=ann.label,
        status=ann.status,
        annotated_by=ann.annotated_by,
        annotated_by_name=ann.annotated_by_name,
        annotated_at=ann.annotated_at.isoformat() if ann.annotated_at else None,
        updated_at=ann.updated_at.isoformat() if ann.updated_at else None,
    )


@router.post("/{dataset_id}/annotations/text-classification", response_model=TextClassificationAnnOut)
def upsert_text_classification_annotation(
    dataset_id: str,
    payload: TextClassificationAnnUpsert,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "editor")

    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    ann = (
        db.query(TextClassificationAnnotation)
        .filter(
            TextClassificationAnnotation.dataset_id == dataset_id,
            TextClassificationAnnotation.record_id == payload.record_id,
        )
        .first()
    )

    if ann is None:
        ann = TextClassificationAnnotation(
            id=str(uuid4()),
            dataset_id=dataset_id,
            record_id=payload.record_id,
            text_value=payload.text,
            label=payload.label,
            status=payload.status,
            notes=payload.notes,
            annotated_by=user.id,
            annotated_by_name=user.email,
            annotated_at=datetime.utcnow(),
        )
        db.add(ann)
    else:
        ann.text_value = payload.text
        ann.label = payload.label
        ann.status = payload.status
        ann.notes = payload.notes
        ann.annotated_by = user.id
        ann.annotated_by_name = user.email
        ann.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(ann)

    return TextClassificationAnnOut(
        record_id=payload.record_id,
        text=ann.text_value,
        label=ann.label,
        status=ann.status,
        annotated_by=ann.annotated_by,
        annotated_by_name=ann.annotated_by_name,
        annotated_at=ann.annotated_at.isoformat() if ann.annotated_at else None,
        updated_at=ann.updated_at.isoformat() if ann.updated_at else None,
    )


@router.get("/{dataset_id}/annotations/text-classification/summary", response_model=TextClassificationSummary)
def text_classification_summary(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    rows = read_text_rows(ds)
    total = len(rows)
    annotations_by_record = {
        ann.record_id: ann
        for ann in db.query(TextClassificationAnnotation)
        .filter(TextClassificationAnnotation.dataset_id == dataset_id)
        .all()
    }

    labeled = 0
    skipped = 0
    for row in rows:
        ann = annotations_by_record.get(row["id"])
        if ann:
            if ann.status == "skipped":
                skipped += 1
            elif ann.label:
                labeled += 1
            continue
        if row.get("label"):
            labeled += 1
    unlabeled = max(total - labeled - skipped, 0)

    by_user_rows = (
        db.query(
            TextClassificationAnnotation.annotated_by_name,
            func.count(TextClassificationAnnotation.id),
        )
        .filter(
            TextClassificationAnnotation.dataset_id == dataset_id,
            TextClassificationAnnotation.status == "labeled",
        )
        .group_by(TextClassificationAnnotation.annotated_by_name)
        .all()
    )
    by_user: Dict[str, int] = {name or "unknown": int(count) for name, count in by_user_rows}

    if total > 0:
        if unlabeled == 0:
            ds.status = "ready"
            ds.annotation_status = "ready"
        else:
            ds.status = "configured"
            ds.annotation_status = "needs_annotation"
        db.add(ds)
        db.commit()

    return TextClassificationSummary(
        total=total,
        labeled=labeled,
        skipped=skipped,
        unlabeled=unlabeled,
        by_user=by_user,
    )


@router.get("/{dataset_id}/annotations/text-classification/export")
def export_text_classification_annotations(
    dataset_id: str,
    format: str = "json",
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    ensure_owner_or_admin(user)

    rows = read_text_rows(ds)
    annotations_by_record = {
        ann.record_id: ann
        for ann in db.query(TextClassificationAnnotation)
        .filter(TextClassificationAnnotation.dataset_id == dataset_id)
        .all()
    }

    export_rows = []
    for row in rows:
        ann = annotations_by_record.get(row["id"])
        if ann:
            export_rows.append(
                {
                    "record_id": row["id"],
                    "text": ann.text_value,
                    "label": ann.label,
                    "status": ann.status,
                    "annotated_by": ann.annotated_by_name,
                }
            )
        else:
            label = row.get("label", "")
            export_rows.append(
                {
                    "record_id": row["id"],
                    "text": row.get("text", ""),
                    "label": label,
                    "status": "labeled" if label else "unlabeled",
                    "annotated_by": None,
                }
            )

    if format == "csv":
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=["record_id", "text", "label", "status", "annotated_by"])
        writer.writeheader()
        writer.writerows(export_rows)
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue().encode("utf-8")]),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="text_annotations.csv"'},
        )

    return JSONResponse(content=export_rows)
