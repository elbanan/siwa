"""
Dataset routes:
- GET    /datasets
- POST   /datasets
- GET    /datasets/{id}
- PATCH  /datasets/{id}
- DELETE /datasets/{id}
- POST   /datasets/{id}/preview
- POST   /datasets/{id}/validate  (creates validation job)

Local-first, image-centered v1.
"""

from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from collections import Counter
import math

from app.api.deps import get_db, get_current_user, require_role
from app.models.dataset import Dataset
from app.models.job import Job
from app.models.annotation_captioning import ImageCaptionAnnotation
from app.models.annotation_classification import ImageClassificationAnnotation
from app.models.annotation_detection import ImageDetectionAnnotation
from app.models.annotation_grounding import ImageGroundingAnnotation
from app.models.annotation_text_classification import TextClassificationAnnotation
from app.models.access import UserDatasetAccess
from app.schemas.dataset import DatasetCreate, DatasetUpdate, DatasetOut
from app.schemas.job import JobOut
from app.services.annotation_insights import class_counts_for_files
from app.services.detection_defaults import (
    detection_defaults_for_files,
    detection_label_names_from_source,
)
from app.services.caption_defaults import caption_defaults_for_files
from app.services.local_scan import preview_local_folder
from app.services.validation import validate_dataset_task
from app.services.text_dataset import read_text_rows, infer_text_labels
from app.core.access import (
    OWNER_ROLES,
    ensure_dataset_access_level,
    get_effective_dataset_access_level,
    user_accessible_dataset_ids,
)


import os
import csv
from fastapi.responses import Response
from app.services.local_scan import scan_local_folder
from app.services.image_io import load_image_or_dicom, make_thumbnail, encode_full



router = APIRouter(prefix="/datasets", tags=["datasets"])

CLASSIFICATION_TASKS = {
    "classification",
    "multiclassification",
    "multi_label_classification",
}


def _collect_dataset_files(ds: Dataset) -> list[str]:
    source = ds.data_source or {}
    if source.get("type") != "local_folder":
        return []
    cfg = source.get("config") or {}
    root = cfg.get("path", "")
    pattern = cfg.get("pattern", "*")
    recursive = cfg.get("recursive", False)
    return scan_local_folder(root, pattern, recursive=recursive)
@router.get("", response_model=list[DatasetOut])
def list_datasets(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    List all datasets accessible to the user.
    
    Performance optimization: Uses cached counts instead of scanning filesystem.
    Use the /datasets/{id}/rescan endpoint to update cached counts.
    """
    allowed_ids = user_accessible_dataset_ids(db, user)
    if allowed_ids is None:
        datasets = db.query(Dataset).order_by(Dataset.updated_at.desc().nullslast()).all()
    elif not allowed_ids:
        datasets = []
    else:
        datasets = (
            db.query(Dataset)
            .filter(Dataset.id.in_(allowed_ids))
            .order_by(Dataset.updated_at.desc().nullslast())
            .all()
        )
    
    out = []
    for d in datasets:
        # Use cached counts for performance
        asset_count = d.cached_asset_count if d.cached_asset_count is not None else 0
        labeled_count = d.cached_labeled_count if d.cached_labeled_count is not None else 0
        
        # Calculate progress from cached counts
        progress = 0
        if asset_count > 0:
            ratio = labeled_count / asset_count
            progress = 100 if labeled_count >= asset_count else math.floor(ratio * 100)
        
        access_level = (
            "editor"
            if user.role in OWNER_ROLES
            else get_effective_dataset_access_level(db, user, d.id)
        )
        
        out.append(
            DatasetOut(
                id=d.id,
                name=d.name,
                project_name=d.project_name,
                description=d.description,
                tags=d.tags,
                modality=d.modality,
                task_type=d.task_type,
                data_source=d.data_source,
                annotation_source=d.annotation_source,
                class_names=d.class_names,
                ds_metadata=d.ds_metadata,
                split=d.split,
                annotation_status=d.annotation_status,
                status=d.status,
                annotation_progress=progress,
                asset_count=asset_count,
                access_level=access_level,
            )
        )
    return out


@router.post("", response_model=DatasetOut)
def create_dataset(
    payload: DatasetCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Create a dataset config (no data copying).

    Important:
    - ds is created unconditionally before returning to avoid scope bugs.
    - ds_metadata is stored on the model as ds.ds_metadata (NOT ds.metadata).
    - validation job is kicked off asynchronously.
    """
    # Build Dataset row
    ds = Dataset(
        id=str(uuid4()),
        name=payload.name,
        project_name=payload.project_name,
        description=payload.description,
        tags=payload.tags,
        modality=payload.modality,
        task_type=payload.task_type,
        data_source=payload.data_source.model_dump(),
        annotation_source=payload.annotation_source.model_dump()
        if payload.annotation_source
        else None,
        class_names=payload.class_names,
        ds_metadata=payload.ds_metadata,
        split=payload.split,
        annotation_status="ready" if payload.has_annotations else "needs_annotation",
        status="configured",
    )

    db.add(ds)
    db.commit()
    db.refresh(ds)

    if user.role not in OWNER_ROLES:
        access = UserDatasetAccess(
            user_id=user.id, dataset_id=ds.id, access_level="editor"
        )
        db.add(access)
        db.commit()

    access_level = (
        "editor"
        if user.role in OWNER_ROLES
        else get_effective_dataset_access_level(db, user, ds.id)
    )

    # Create validation job + run in background (do not block create)
    job = Job(
        id=str(uuid4()),
        type="dataset_validate",
        status="queued",
        progress=0,
        logs=[],
        payload={"dataset_id": ds.id},
    )
    db.add(job)
    db.commit()

    # Background tasks: validate + scan for cached counts
    background.add_task(validate_dataset_task, ds.id, job.id)
    
    # Scan dataset to populate cached counts
    def scan_and_cache():
        from app.db.session import SessionLocal
        from app.services.dataset_scanner import scan_dataset_counts, update_cached_counts
        db_local = SessionLocal()
        try:
            ds_local = db_local.get(Dataset, ds.id)
            if ds_local:
                asset_count, labeled_count, _ = scan_dataset_counts(ds_local, db_local)
                update_cached_counts(ds.id, asset_count, labeled_count, db_local)
        finally:
            db_local.close()
    
    background.add_task(scan_and_cache)

    return DatasetOut(
        id=ds.id,
        name=ds.name,
        project_name=ds.project_name,
        description=ds.description,
        tags=ds.tags,
        modality=ds.modality,
        task_type=ds.task_type,
        data_source=ds.data_source,
        annotation_source=ds.annotation_source,
        class_names=ds.class_names,
        ds_metadata=ds.ds_metadata,  # correct field
        split=ds.split,
        annotation_status=ds.annotation_status,
        status=ds.status,
        asset_count=ds.asset_count,
        access_level=access_level,
    )




@router.get("/{dataset_id}", response_model=DatasetOut)
def get_dataset(dataset_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    access_level = (
        "editor"
        if user.role in OWNER_ROLES
        else get_effective_dataset_access_level(db, user, dataset_id)
    )

    modality = (ds.modality or "image").lower()
    auto_labels: list[str] = []
    labeled = 0
    asset_count = 0
    if modality == "text" and (ds.data_source or {}).get("type") == "local_csv":
        rows = read_text_rows(ds)
        asset_count = len(rows)
        auto_labels = infer_text_labels(rows)
        annotations_by_record = {
            ann.record_id: ann
            for ann in db.query(TextClassificationAnnotation)
            .filter(TextClassificationAnnotation.dataset_id == dataset_id)
            .all()
        }
        for row in rows:
            ann = annotations_by_record.get(row["id"])
            if ann:
                if ann.status == "skipped":
                    continue
                if ann.label:
                    labeled += 1
                    continue
            if row.get("label"):
                labeled += 1
    else:
        files = _collect_dataset_files(ds)
        asset_count = len(files)
        task_type = (ds.task_type or "").lower()
        if task_type == "detection":
            auto_labels = detection_label_names_from_source(ds)
            detection_annotations = {
                ann.file_path: ann
                for ann in db.query(ImageDetectionAnnotation)
                .filter(ImageDetectionAnnotation.dataset_id == dataset_id)
                .all()
            }
            default_boxes = detection_defaults_for_files(ds, files)
            for path in files:
                norm = os.path.normpath(path).lower()
                ann = detection_annotations.get(norm)
                if ann:
                    if ann.status == "skipped":
                        continue
                    if ann.boxes:
                        labeled += 1
                        continue
                if default_boxes.get(norm):
                    labeled += 1
        elif task_type == "captioning":
            annotations_by_path = {
                ann.file_path: ann
                for ann in db.query(ImageCaptionAnnotation)
                .filter(ImageCaptionAnnotation.dataset_id == dataset_id)
                .all()
            }
            default_captions = caption_defaults_for_files(ds, files)
            for path in files:
                norm = os.path.normpath(path).lower()
                ann = annotations_by_path.get(norm)
                if ann and ann.status == "labeled" and (ann.caption or "").strip():
                    labeled += 1
                    continue
                if (default_captions.get(norm) or "").strip():
                    labeled += 1
        elif task_type == "grounding":
            grounding_annotations = {
                ann.file_path: ann
                for ann in db.query(ImageGroundingAnnotation)
                .filter(ImageGroundingAnnotation.dataset_id == dataset_id)
                .all()
            }
            for path in files:
                norm = os.path.normpath(path).lower()
                ann = grounding_annotations.get(norm)
                if not ann:
                    continue
                if ann.status == "skipped":
                    continue
                if ann.pairs:
                    labeled += 1
        else:
            default_label_map, _ = class_counts_for_files(ds, files)
            annotations_by_path = {
                ann.file_path: ann
                for ann in db.query(ImageClassificationAnnotation)
                .filter(ImageClassificationAnnotation.dataset_id == dataset_id)
                .all()
            }
            for path in files:
                norm = os.path.normpath(path).lower()
                ann = annotations_by_path.get(norm)
                if ann:
                    if ann.labels:
                        labeled += 1
                    continue
                if default_label_map.get(path) or default_label_map.get(norm):
                    labeled += 1
    progress = 0
    if asset_count:
        ratio = labeled / asset_count
        progress = 100 if labeled >= asset_count else math.floor(ratio * 100)
    return DatasetOut(
        id=ds.id,
        name=ds.name,
        project_name=ds.project_name,
        description=ds.description,
        tags=ds.tags,
        modality=ds.modality,
        task_type=ds.task_type,
        data_source=ds.data_source,
        annotation_source=ds.annotation_source,
        class_names=ds.class_names or auto_labels,
        ds_metadata=ds.ds_metadata,
        split=ds.split,
        annotation_status=ds.annotation_status,
        status=ds.status,
        annotation_progress=progress,
        asset_count=asset_count,
        access_level=access_level,
    )




from pydantic import BaseModel

@router.patch("/{dataset_id}", response_model=DatasetOut)
def update_dataset(
    dataset_id: str,
    payload: DatasetUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Update dataset config.

    Important:
    - Frontend sends plain dicts for data_source/annotation_source.
    - Pydantic models may appear if request came from python client.
    - We normalize to plain dicts safely.
    """
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "editor")

    updates = payload.model_dump(exclude_unset=True)

    for field, value in updates.items():
        if value is None:
            setattr(ds, field, None)
            continue

        # If it's a Pydantic model, convert to dict
        if isinstance(value, BaseModel):
            value = value.model_dump()

        # data_source / annotation_source must be stored as dicts
        if field in ("data_source", "annotation_source") and isinstance(value, dict):
            setattr(ds, field, value)
            continue

        setattr(ds, field, value)

    # keep annotation_status consistent if user toggles has_annotations
    if "has_annotations" in updates:
        if updates["has_annotations"]:
            ds.annotation_status = "ready"
        else:
            ds.annotation_status = "needs_annotation"

    ds.status = "configured"
    db.add(ds)
    db.commit()
    db.refresh(ds)
    access_level = (
        "editor"
        if user.role in OWNER_ROLES
        else get_effective_dataset_access_level(db, user, dataset_id)
    )

    return DatasetOut(
        id=ds.id,
        name=ds.name,
        project_name=ds.project_name,
        description=ds.description,
        tags=ds.tags,
        modality=ds.modality,
        task_type=ds.task_type,
        data_source=ds.data_source,
        annotation_source=ds.annotation_source,
        class_names=ds.class_names,
        ds_metadata=ds.ds_metadata,
        split=ds.split,
        annotation_status=ds.annotation_status,
        status=ds.status,
        asset_count=ds.asset_count,
        access_level=access_level,
    )




@router.delete("/{dataset_id}")
def delete_dataset(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(require_role("owner", "admin")),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    db.delete(ds)
    db.commit()
    return {"ok": True}


@router.post("/{dataset_id}/preview")
def preview_dataset_source(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    source = ds.data_source
    if source["type"] == "local_folder":
        path = source["config"].get("path")
        pattern = source["config"].get("pattern", "*")
        recursive = source["config"].get("recursive", False)
        return preview_local_folder(path, pattern, recursive=recursive)

    raise HTTPException(status_code=400, detail="Unsupported data source type")


class CsvInspectRequest(BaseModel):
    path: str


@router.post("/inspect/csv")
def inspect_csv_columns(
    payload: CsvInspectRequest,
    user=Depends(get_current_user),
):
    csv_path = os.path.expandvars(os.path.expanduser(payload.path))
    if not os.path.isfile(csv_path):
        raise HTTPException(status_code=404, detail=f"CSV file not found: {payload.path}")

    try:
        with open(csv_path, "r", newline="") as fh:
            sample = fh.read(4096)
            fh.seek(0)
            try:
                dialect = csv.Sniffer().sniff(sample)
            except csv.Error:
                dialect = csv.excel
            reader = csv.DictReader(fh, dialect=dialect)
            columns = reader.fieldnames or []
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read CSV: {exc}") from exc

    if not columns:
        raise HTTPException(status_code=400, detail="Unable to detect CSV header columns.")

    return {"columns": columns}


@router.post("/{dataset_id}/validate", response_model=JobOut)
def validate_dataset_endpoint(
    dataset_id: str,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "editor")

    job = Job(id=str(uuid4()), type="dataset_validation", status="queued", payload={"dataset_id": dataset_id})
    db.add(job)
    db.commit()
    db.refresh(job)

    # schedule background validation
    # background.add_task(validate_dataset, db, dataset_id, job.id)
    background.add_task(validate_dataset_task, dataset_id, job.id)


    return JobOut(
        id=job.id, type=job.type, status=job.status,
        progress=job.progress, logs=job.logs, payload=job.payload
    )


from app.services.dataset_scanner import (
    scan_dataset_counts,
    update_cached_counts,
    get_scan_comparison,
)


@router.post("/{dataset_id}/rescan")
def rescan_dataset(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Rescan a dataset to update cached counts.
    
    Compares new counts with previously cached values and returns a comparison message.
    This is useful to verify that cached counts are still accurate after adding/removing files.
    """
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")
    
    # Get previous cached counts
    previous_asset_count = ds.cached_asset_count
    previous_labeled_count = ds.cached_labeled_count
    
    # Perform new scan
    new_asset_count, new_labeled_count, auto_labels = scan_dataset_counts(ds, db)
    
    # Update cached counts in database
    update_cached_counts(dataset_id, new_asset_count, new_labeled_count, db)
    
    # Generate comparison message
    comparison = get_scan_comparison(
        previous_asset_count,
        new_asset_count,
        previous_labeled_count,
        new_labeled_count
    )
    
    return comparison
    
    
@router.get("/{dataset_id}/files")
def list_dataset_files(
    dataset_id: str,
    offset: int = 0,
    limit: int = 200,
    class_name: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    List local files for a dataset.

    Returns:
    - total count
    - original root path
    - paginated file list (absolute paths)
    """
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_dataset_access_level(db, user, dataset_id, "view")

    source = ds.data_source
    if source["type"] != "local_folder":
        raise HTTPException(status_code=400, detail="Explore supports local_folder only in v1")

    root = source["config"].get("path", "")
    pattern = source["config"].get("pattern", "*")

    recursive = source["config"].get("recursive", False)
    files = scan_local_folder(root, pattern, recursive=recursive)

    task_type = (ds.task_type or "").lower()
    is_classification = task_type in CLASSIFICATION_TASKS
    is_detection = task_type == "detection"
    is_captioning = task_type == "captioning"
    is_grounding = task_type == "grounding"

    file_labels: dict[str, list[str]] = {}
    classification_status_by_path: dict[str, str] = {}
    detection_status_by_path: dict[str, str] = {}
    class_counts = Counter()
    unlabeled_count = 0

    default_label_map: dict[str, str] = {}
    if is_classification:
        default_label_map, _ = class_counts_for_files(ds, files)
        annotations_by_path = {
            ann.file_path: ann
            for ann in db.query(ImageClassificationAnnotation)
            .filter(ImageClassificationAnnotation.dataset_id == dataset_id)
            .all()
        }
    else:
        annotations_by_path = {}

    caption_annotations_by_path: dict[str, ImageCaptionAnnotation] = {}
    caption_status_by_path: dict[str, str] = {}
    if is_captioning:
        caption_annotations_by_path = {
            ann.file_path: ann
            for ann in db.query(ImageCaptionAnnotation)
            .filter(ImageCaptionAnnotation.dataset_id == dataset_id)
            .all()
        }

    if is_detection:
        detection_annotations_by_path = {
            ann.file_path: ann
            for ann in db.query(ImageDetectionAnnotation)
            .filter(ImageDetectionAnnotation.dataset_id == dataset_id)
            .all()
        }
        default_detection_boxes = detection_defaults_for_files(ds, files)
    else:
        detection_annotations_by_path = {}
        default_detection_boxes = {}

    grounding_status_by_path: dict[str, str] = {}
    if is_grounding:
        grounding_annotations_by_path = {
            ann.file_path: ann
            for ann in db.query(ImageGroundingAnnotation)
            .filter(ImageGroundingAnnotation.dataset_id == dataset_id)
            .all()
        }
    else:
        grounding_annotations_by_path = {}

    for path in files:
        norm_path = os.path.normpath(path).lower()
        if is_detection:
            ann = detection_annotations_by_path.get(norm_path)
            status = "unlabeled"
            if ann:
                if ann.status == "skipped":
                    status = "skipped"
                elif ann.boxes:
                    status = "labeled"
                elif ann.status:
                    status = ann.status
            if status == "unlabeled" and default_detection_boxes.get(norm_path):
                status = "labeled"
            detection_status_by_path[path] = status
            continue

        if is_captioning:
            ann = caption_annotations_by_path.get(norm_path)
            status = "unlabeled"
            if ann:
                status = ann.status or "unlabeled"
                if status == "labeled" and not (ann.caption or "").strip():
                    status = "unlabeled"
            caption_status_by_path[path] = status
            continue

        if is_grounding:
            ann = grounding_annotations_by_path.get(norm_path)
            status = "unlabeled"
            if ann:
                status = ann.status or "unlabeled"
                if status == "labeled":
                    pairs = ann.pairs or []
                    if not pairs:
                        status = "unlabeled"
            grounding_status_by_path[path] = status
            continue

        labels: list[str] = []
        ann = annotations_by_path.get(norm_path)
        if ann:
            labels = ann.labels or []
            ann_status = ann.status or ("labeled" if labels else "unlabeled")
            classification_status_by_path[path] = ann_status
        elif default_label_map.get(path):
            labels = [default_label_map[path]]
            classification_status_by_path[path] = "labeled"
        elif default_label_map.get(norm_path):
            labels = [default_label_map[norm_path]]
            classification_status_by_path[path] = "labeled"
        else:
            classification_status_by_path[path] = "unlabeled"

        file_labels[path] = labels

        if labels:
            for label in labels:
                class_counts[label] += 1
        else:
            unlabeled_count += 1

    if is_classification:
        for cls in ds.class_names or []:
            class_counts.setdefault(cls, 0)
        class_counts["unlabeled"] = unlabeled_count if files else 0

    filtered_files = files
    if class_name and is_classification:
        if class_name == "unlabeled":
            filtered_files = [f for f in files if not file_labels.get(f)]
        else:
            filtered_files = [
                f for f in files if any(label == class_name for label in file_labels.get(f, []))
            ]
    elif class_name and is_detection:
        if class_name == "unlabeled":
            filtered_files = [
                f
                for f in files
                if detection_status_by_path.get(f, "unlabeled") == "unlabeled"
            ]
        elif class_name == "labeled":
            filtered_files = [
                f for f in files if detection_status_by_path.get(f) == "labeled"
            ]
        elif class_name == "skipped":
            filtered_files = [
                f for f in files if detection_status_by_path.get(f) == "skipped"
            ]
    elif class_name and is_captioning:
        if class_name in {"unlabeled", "labeled", "skipped"}:
            filtered_files = [
                f
                for f in files
                if caption_status_by_path.get(f, "unlabeled") == class_name
            ]

    total_filtered = len(filtered_files)
    page = filtered_files[offset : offset + limit]
    file_statuses: dict[str, str] = {}
    for path in page:
        if is_classification:
            file_statuses[path] = classification_status_by_path.get(path, "unlabeled")
        elif is_detection:
            file_statuses[path] = detection_status_by_path.get(path, "unlabeled")
        elif is_captioning:
            file_statuses[path] = caption_status_by_path.get(path, "unlabeled")
        elif is_grounding:
            file_statuses[path] = grounding_status_by_path.get(path, "unlabeled")

    return {
        "dataset_id": dataset_id,
        "root_path": os.path.expanduser(root),
        "pattern": pattern,
        "total": total_filtered,
        "overall_total": len(files),
        "offset": offset,
        "limit": limit,
        "files": page,
        "file_statuses": file_statuses,
        "class_counts": class_counts,
        "class_filter": class_name,
    }


@router.get("/{dataset_id}/text-rows")
def list_text_rows(
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

    source = ds.data_source or {}
    if source.get("type") != "local_csv":
        raise HTTPException(status_code=400, detail="Explore supports local_csv only for text datasets")

    rows = read_text_rows(ds)
    annotations_by_record = {
        ann.record_id: ann
        for ann in db.query(TextClassificationAnnotation)
        .filter(TextClassificationAnnotation.dataset_id == dataset_id)
        .all()
    }

    extra_cols = []
    try:
        meta = ds.ds_metadata or {}
        extra_cols = meta.get("extra_text_columns") or []
    except Exception:
        extra_cols = []

    enriched = []
    for row in rows:
        ann = annotations_by_record.get(row["id"])
        label = ann.label if ann else row.get("label", "")
        status = ann.status if ann else ("labeled" if row.get("label") else "unlabeled")
        raw_row = row.get("row") if isinstance(row.get("row"), dict) else {}
        extra_values = {}
        if extra_cols and isinstance(raw_row, dict):
            for col in extra_cols:
                val = raw_row.get(col)
                extra_values[col] = "" if val is None else str(val)
        enriched_row = {
            "id": row["id"],
            "text": row.get("text", ""),
            "label": label,
            "original_label": row.get("label", ""),
            "status": status,
            "extra_columns": extra_values,
            "original_row": raw_row,
        }
        enriched.append(enriched_row)

    if search:
        q = search.lower()
        enriched = [
            row
            for row in enriched
            if q in row["text"].lower() or q in (row["label"] or "").lower()
        ]

    total = len(enriched)
    page = enriched[offset : offset + limit]

    return {
        "dataset_id": dataset_id,
        "total": total,
        "offset": offset,
        "limit": limit,
        "rows": page,
    }


@router.get("/{dataset_id}/thumb")
def get_thumbnail(
    dataset_id: str,
    path: str,
    db: Session = Depends(get_db),
    # user=Depends(get_current_user),
):
    """
    Return a JPEG thumbnail for a file path in the dataset.

    Security:
    - ensure requested path is inside dataset root
    """
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    source = ds.data_source
    if source["type"] != "local_folder":
        raise HTTPException(status_code=400, detail="Unsupported data source")

    root = os.path.expandvars(os.path.expanduser(source["config"].get("path", "")))
    req = os.path.expandvars(os.path.expanduser(path))

    # prevent path traversal
    if not os.path.abspath(req).startswith(os.path.abspath(root)):
        raise HTTPException(status_code=403, detail="Path not in dataset root")

    img = load_image_or_dicom(req)
    jpg = make_thumbnail(img, (256, 256))
    return Response(content=jpg, media_type="image/jpeg")


@router.get("/{dataset_id}/view")
def get_full_view(
    dataset_id: str,
    path: str,
    db: Session = Depends(get_db),
    # user=Depends(get_current_user),
):
    """
    Return a full-size JPEG view for quick-view modal.
    """
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    source = ds.data_source
    if source["type"] != "local_folder":
        raise HTTPException(status_code=400, detail="Unsupported data source")

    root = os.path.expandvars(os.path.expanduser(source["config"].get("path", "")))
    req = os.path.expandvars(os.path.expanduser(path))

    if not os.path.abspath(req).startswith(os.path.abspath(root)):
        raise HTTPException(status_code=403, detail="Path not in dataset root")

    img = load_image_or_dicom(req)
    jpg = encode_full(img, "JPEG")
    return Response(content=jpg, media_type="image/jpeg")
    


@router.post("/{dataset_id}/validate/check")
def validate_dataset_now(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Validate dataset config synchronously.
    Returns a structured report used by UI before saving.

    Validation v1:
    - local folder exists
    - pattern matches >=1 file
    - task_type present
    - class_names present if task needs them
    - annotation_source consistency if provided
    """
    ds = db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    report = {
        "ok": True,
        "errors": [],
        "warnings": [],
        "stats": {},
    }

    # Only local_folder supported in v1
    source = ds.data_source or {}
    stype = source.get("type")
    cfg = source.get("config") or {}
    root = os.path.expandvars(os.path.expanduser(cfg.get("path", "")))
    pattern = cfg.get("pattern", "*")

    recursive = cfg.get("recursive", False)

    if stype != "local_folder":
        report["warnings"].append("Only local_folder sources are validated in v1.")
    else:
        if not root or not os.path.isdir(root):
            report["ok"] = False
            report["errors"].append(f"Local folder does not exist: {root}")
        else:
            files = scan_local_folder(root, pattern, recursive=recursive)
            report["stats"]["file_count"] = len(files)
            report["stats"]["root_path"] = root
            report["stats"]["pattern"] = pattern
            if len(files) == 0:
                report["ok"] = False
                report["errors"].append(
                    f"No files matched pattern '{pattern}' in {root}"
                )

    # Task checks
    if not ds.task_type:
        report["warnings"].append("Task type is not set.")

    # Class schema checks for tasks that need classes
    if ds.task_type in ("classification", "segmentation", "detection"):
        if not ds.class_names or len(ds.class_names) == 0:
            report["warnings"].append(
                "Class names are empty. Annotation/training will require classes."
            )

    # Annotation source sanity
    ann = ds.annotation_source or None
    if ann:
        fmt = ann.get("format")
        acfg = ann.get("config") or {}
        if not fmt:
            report["warnings"].append("Annotation source format missing.")
        if fmt == "csv" and not acfg.get("path"):
            report["warnings"].append("CSV annotation path missing.")
        if fmt == "folder" and not acfg.get("path"):
            report["warnings"].append("Annotation folder path missing.")

    return report
