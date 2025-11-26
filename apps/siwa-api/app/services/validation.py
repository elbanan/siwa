"""
Dataset validation jobs.

Important fix:
Background tasks must NOT reuse request-scoped DB sessions.
We open a fresh SessionLocal inside the task.

In v1:
- Validate local_folder exists and has files.
- Mark dataset status accordingly.
"""

from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.dataset import Dataset
from app.models.job import Job
from app.services.local_scan import scan_local_folder
from app.services.annotation_insights import infer_class_names


def validate_dataset_task(dataset_id: str, job_id: str):
    """
    Background task entrypoint.

    Opens its own DB session so it is safe after request completes.
    """
    db: Session = SessionLocal()
    try:
        job = db.get(Job, job_id)
        dataset = db.get(Dataset, dataset_id)

        if not job or not dataset:
            return

        job.status = "running"
        job.logs.append("Starting dataset validation.")
        db.commit()

        ds = dataset.data_source
        images_found = 0

        if ds["type"] == "local_folder":
            config = ds.get("config", {}) or {}
            path = config.get("path")
            pattern = config.get("pattern", "*")
            recursive = config.get("recursive", False)
            files = scan_local_folder(path, pattern, recursive=recursive)
            images_found = len(files)
            job.logs.append(f"Found {images_found} image files.")
        else:
            job.logs.append(f"Unsupported data source type: {ds['type']}")

        job.payload["images_found"] = images_found

        # Infer dataset statuses
        dataset.asset_count = images_found
        dataset.class_names = infer_class_names(dataset)

        if images_found == 0:
            dataset.status = "invalid_config"
        else:
            dataset.status = "ready" if dataset.annotation_source else "configured"

        dataset.annotation_status = "ready" if dataset.annotation_source else "needs_annotation"

        job.status = "succeeded"
        job.progress = 100
        job.finished_at = datetime.now(timezone.utc)
        job.logs.append("Validation succeeded.")
        db.commit()

    except Exception as e:
        # Best-effort failure recording
        job = db.get(Job, job_id)
        dataset = db.get(Dataset, dataset_id)
        if job:
            job.status = "failed"
            job.logs.append(f"Validation failed: {str(e)}")
            job.finished_at = datetime.now(timezone.utc)
        if dataset:
            dataset.status = "invalid_config"
            dataset.asset_count = 0
        db.commit()
    finally:
        db.close()
