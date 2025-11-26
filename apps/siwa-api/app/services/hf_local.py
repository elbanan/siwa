"""
Utilities for scanning local HuggingFace model cache.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple

from app.core.config import settings


@dataclass
class HFModelInfo:
    name: str
    path: str
    repo_id: str
    modified_at: float | None


def _default_cache_dir() -> Path:
    return Path(settings.HUGGINGFACE_CACHE_DIR).expanduser()


def _infer_repo_id(folder_name: str) -> str:
    if folder_name.startswith("models--"):
        parts = folder_name.split("--")
        if len(parts) >= 3:
            owner = parts[1]
            model = "--".join(parts[2:])
            return f"{owner}/{model}"
    return folder_name


def list_local_hf_models(base_path: str | None = None) -> Tuple[List[dict], str | None]:
    root = Path(base_path).expanduser() if base_path else _default_cache_dir()
    if not root.exists():
        return [], f"HuggingFace directory not found: {root}"

    models: list[dict] = []
    try:
        for entry in sorted(root.iterdir()):
            if not entry.is_dir():
                continue
            repo_id = _infer_repo_id(entry.name)
            stat = entry.stat()
            models.append(
                {
                    "name": repo_id,
                    "repo_id": repo_id,
                    "path": str(entry.resolve()),
                    "modified_at": stat.st_mtime,
                    "base_path": str(root),
                }
            )
    except PermissionError as exc:
        return [], f"Permission denied reading {root}: {exc}"
    return models, None
