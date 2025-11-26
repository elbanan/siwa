"""
Helpers for handling uploaded model artifacts.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
from typing import Tuple, Dict, Any


SAFE_CHAR_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(name: str) -> str:
    cleaned = SAFE_CHAR_PATTERN.sub("_", name.strip() or "model.bin")
    return cleaned[:255]


def persist_upload(upload, dest_dir: str) -> str:
    """
    Save an UploadFile-like object into dest_dir. Returns the absolute path.
    """
    os.makedirs(dest_dir, exist_ok=True)
    filename = _safe_filename(getattr(upload, "filename", "") or "model.bin")
    path = os.path.join(dest_dir, filename)
    upload.file.seek(0)
    with open(path, "wb") as out_f:
        shutil.copyfileobj(upload.file, out_f)
    upload.file.close()
    return path


def compute_checksum(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def analyze_torch_artifact(path: str) -> Tuple[str, Dict[str, Any]]:
    """
    Best-effort inspection of a PyTorch artifact.

    Returns (artifact_type, summary_dict). Summary always contains serializable values.
    """
    summary: Dict[str, Any] = {}
    try:
        import torch  # type: ignore
    except Exception as exc:  # pragma: no cover - torch may be missing locally
        summary["error"] = f"PyTorch unavailable: {exc}"
        return "unknown", summary

    try:
        obj = torch.load(path, map_location="cpu")
    except Exception as exc:
        summary["error"] = f"torch.load failed: {exc}"
        return "unreadable", summary

    artifact_type = "unknown"

    def tensor_shape(value) -> list[int] | None:
        if hasattr(value, "shape"):
            return list(value.shape)  # type: ignore[attr-defined]
        return None

    if hasattr(obj, "parameters") and hasattr(obj, "buffers"):
        artifact_type = "module"
        try:
            param_count = sum(p.numel() for p in obj.parameters())
            buffer_count = sum(1 for _ in obj.buffers())
        except Exception:
            param_count = None
            buffer_count = None
        summary.update(
            {
                "module_class": obj.__class__.__name__,
                "parameter_count": param_count,
                "buffer_count": buffer_count,
            }
        )
    elif isinstance(obj, dict):
        if "state_dict" in obj and isinstance(obj["state_dict"], dict):
            artifact_type = "state_bundle"
            state = obj["state_dict"]
            keys = list(state.keys())[:20]
            summary.update(
                {
                    "tensor_count": len(state),
                    "sample_keys": keys,
                    "sample_shapes": {
                        k: tensor_shape(state[k]) for k in keys if tensor_shape(state[k])
                    },
                }
            )
        elif all(hasattr(v, "shape") for v in obj.values()):
            artifact_type = "state_dict"
            keys = list(obj.keys())[:20]
            summary.update(
                {
                    "tensor_count": len(obj),
                    "sample_keys": keys,
                    "sample_shapes": {k: tensor_shape(obj[k]) for k in keys if tensor_shape(obj[k])},
                }
            )
        else:
            summary["keys"] = list(obj.keys())[:20]
    elif isinstance(obj, (list, tuple)):
        artifact_type = "sequence"
        summary["length"] = len(obj)
    else:
        artifact_type = obj.__class__.__name__

    return artifact_type, summary
