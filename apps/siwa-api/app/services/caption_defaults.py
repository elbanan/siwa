"""
Utilities for reading default caption annotations from folder structures.
"""

from __future__ import annotations

import os
from typing import Dict, List


def _expand(path: str | None) -> str:
    return os.path.expandvars(os.path.expanduser(path or ""))


def _annotation_file_for(
    image_path: str, data_root: str, ann_root: str, extension: str
) -> str:
    if not extension:
        extension = ".txt"
    if not extension.startswith("."):
        extension = f".{extension}"
    try:
        rel = os.path.relpath(image_path, data_root)
    except ValueError:
        rel = os.path.basename(image_path)
    base, _ = os.path.splitext(rel)
    candidate = os.path.join(ann_root, base + extension)
    return candidate


def caption_defaults_for_files(dataset, files: List[str]) -> Dict[str, str]:
    ann = dataset.annotation_source or {}
    cfg = ann.get("config") or {}
    fmt = (ann.get("format") or "").lower()
    if fmt == "folder":
        return _defaults_from_folder(dataset, files, cfg)
    return {}


def _defaults_from_folder(dataset, files: List[str], cfg: dict) -> Dict[str, str]:
    annotation_root = _expand(cfg.get("path"))
    if not annotation_root or not os.path.isdir(annotation_root):
        data_root = _expand(dataset.data_source.get("config", {}).get("path"))
        if data_root:
            candidate_root = os.path.join(data_root, annotation_root)
            if os.path.isdir(candidate_root):
                annotation_root = candidate_root
            else:
                return {}
        else:
            return {}

    data_root = _expand(dataset.data_source.get("config", {}).get("path"))
    extension = cfg.get("file_extension") or ".txt"

    defaults: Dict[str, str] = {}
    for image_path in files:
        annotation_file = _annotation_file_for(
            image_path, data_root, annotation_root, extension
        )
        if not os.path.isfile(annotation_file):
            continue
        try:
            with open(annotation_file, "r", encoding="utf-8") as handle:
                caption = handle.read().strip()
        except OSError:
            continue
        if caption:
            norm = os.path.normpath(image_path).lower()
            defaults[norm] = caption
    return defaults
