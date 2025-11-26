"""
Dataset scanner service.

Provides reusable functions for scanning datasets and updating cached counts.
This logic is extracted from the list_datasets endpoint to avoid duplication.
"""

import os
import math
from datetime import datetime
from sqlalchemy.orm import Session

from app.models.dataset import Dataset
from app.models.annotation_classification import ImageClassificationAnnotation
from app.models.annotation_detection import ImageDetectionAnnotation
from app.models.annotation_captioning import ImageCaptionAnnotation
from app.models.annotation_grounding import ImageGroundingAnnotation
from app.models.annotation_text_classification import TextClassificationAnnotation
from app.services.local_scan import scan_local_folder
from app.services.text_dataset import read_text_rows
from app.services.annotation_insights import class_counts_for_files
from app.services.detection_defaults import (
    detection_defaults_for_files,
    detection_label_names_from_source,
)
from app.services.caption_defaults import caption_defaults_for_files


def _collect_dataset_files(ds: Dataset) -> list[str]:
    """Collect all files for a dataset based on its data source configuration."""
    source = ds.data_source or {}
    if source.get("type") != "local_folder":
        return []
    cfg = source.get("config") or {}
    root = cfg.get("path", "")
    pattern = cfg.get("pattern", "*")
    recursive = cfg.get("recursive", False)
    return scan_local_folder(root, pattern, recursive=recursive)


def scan_dataset_counts(ds: Dataset, db: Session) -> tuple[int, int, list[str]]:
    """
    Scan a dataset and return (asset_count, labeled_count, auto_labels).
    
    This performs the same expensive operations as the original list_datasets,
    but is now isolated for reuse in rescan operations.
    
    Returns:
        tuple: (total_assets, labeled_count, auto_detected_labels)
    """
    modality = (ds.modality or "image").lower()
    auto_labels: list[str] = []
    labeled = 0
    asset_count = 0
    
    if modality == "text" and (ds.data_source or {}).get("type") == "local_csv":
        rows = read_text_rows(ds)
        asset_count = len(rows)
        
        annotations_by_record = {
            ann.record_id: ann
            for ann in db.query(TextClassificationAnnotation)
            .filter(TextClassificationAnnotation.dataset_id == ds.id)
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
                .filter(ImageDetectionAnnotation.dataset_id == ds.id)
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
                .filter(ImageCaptionAnnotation.dataset_id == ds.id)
                .all()
            }
            default_captions = caption_defaults_for_files(ds, files)
            for path in files:
                norm = os.path.normpath(path).lower()
                ann = annotations_by_path.get(norm)
                if ann and ann.status == "labeled" and (ann.caption or "").strip():
                    labeled += 1
                    continue
                if default_captions.get(norm):
                    labeled += 1
                    
        elif task_type == "grounding":
            grounding_annotations = {
                ann.file_path: ann
                for ann in db.query(ImageGroundingAnnotation)
                .filter(ImageGroundingAnnotation.dataset_id == ds.id)
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
            # Classification tasks
            default_label_map, _ = class_counts_for_files(ds, files)
            annotations_by_path = {
                ann.file_path: ann
                for ann in db.query(ImageClassificationAnnotation)
                .filter(ImageClassificationAnnotation.dataset_id == ds.id)
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
    
    return asset_count, labeled, auto_labels


def update_cached_counts(
    dataset_id: str,
    asset_count: int,
    labeled_count: int,
    db: Session
) -> None:
    """
    Update the cached counts for a dataset in the database.
    
    Args:
        dataset_id: ID of the dataset to update
        asset_count: Total number of assets
        labeled_count: Number of labeled assets
        db: Database session
    """
    ds = db.get(Dataset, dataset_id)
    if not ds:
        return
    
    ds.cached_asset_count = asset_count
    ds.cached_labeled_count = labeled_count
    ds.last_scanned_at = datetime.utcnow()
    
    db.add(ds)
    db.commit()


def get_scan_comparison(
    previous_asset_count: int | None,
    new_asset_count: int,
    previous_labeled_count: int | None,
    new_labeled_count: int
) -> dict:
    """
    Compare previous and new scan results and generate a user-friendly message.
    
    Returns:
        dict with keys: changed, message, details
    """
    if previous_asset_count is None or previous_labeled_count is None:
        return {
            "changed": True,
            "message": f"Initial scan complete: {new_asset_count} files, {new_labeled_count} labeled",
            "previous_asset_count": None,
            "new_asset_count": new_asset_count,
            "previous_labeled_count": None,
            "new_labeled_count": new_labeled_count,
        }
    
    asset_diff = new_asset_count - previous_asset_count
    labeled_diff = new_labeled_count - previous_labeled_count
    
    if asset_diff == 0 and labeled_diff == 0:
        return {
            "changed": False,
            "message": f"No changes detected ({new_asset_count} files, {new_labeled_count} labeled)",
            "previous_asset_count": previous_asset_count,
            "new_asset_count": new_asset_count,
            "previous_labeled_count": previous_labeled_count,
            "new_labeled_count": new_labeled_count,
        }
    
    messages = []
    if asset_diff > 0:
        messages.append(f"{asset_diff} new files")
    elif asset_diff < 0:
        messages.append(f"{abs(asset_diff)} files removed")
    
    if labeled_diff > 0:
        messages.append(f"{labeled_diff} new annotations")
    elif labeled_diff < 0:
        messages.append(f"{abs(labeled_diff)} annotations removed")
    
    message = f"Changes detected: {', '.join(messages)} ({previous_asset_count}→{new_asset_count} files, {previous_labeled_count}→{new_labeled_count} labeled)"
    
    return {
        "changed": True,
        "message": message,
        "previous_asset_count": previous_asset_count,
        "new_asset_count": new_asset_count,
        "previous_labeled_count": previous_labeled_count,
        "new_labeled_count": new_labeled_count,
    }
