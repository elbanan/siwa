"""
Helpers for loading grounding text/caption defaults from CSV sources.
"""

from __future__ import annotations

import csv
import os
from typing import Dict, List


def _expand(path: str | None) -> str:
    return os.path.expandvars(os.path.expanduser(path or ""))


def _normalize_path(path: str) -> str:
    return os.path.normpath(path).lower()


def load_grounding_text_lookup(dataset) -> Dict[str, Dict[str, str]]:
    """
    Returns maps for normalized paths and basenames to grounding text.
    """
    ann = dataset.annotation_source or {}
    fmt = (ann.get("format") or "").lower()
    cfg = ann.get("config") or {}
    data_source_cfg = (dataset.data_source or {}).get("config", {}) or {}
    data_root = _expand(data_source_cfg.get("path", ""))

    if fmt == "csv":
        csv_path = _expand(cfg.get("path"))
        image_column = cfg.get("image_column")
        text_column = cfg.get("caption_column") or cfg.get("text_column")
        if not csv_path or not os.path.isfile(csv_path):
            return {"by_path": {}, "by_name": {}}
        if not image_column or not text_column:
            return {"by_path": {}, "by_name": {}}

        lookup: Dict[str, str] = {}
        name_lookup: Dict[str, str] = {}

        try:
            with open(csv_path, newline="") as fh:
                reader = csv.DictReader(fh)
                headers = reader.fieldnames or []
                if not headers:
                    return {"by_path": {}, "by_name": {}}
                if image_column not in headers or text_column not in headers:
                    return {"by_path": {}, "by_name": {}}
                for row in reader:
                    image_value = (row.get(image_column) or "").strip()
                    text_value = (row.get(text_column) or "").strip()
                    if not image_value or not text_value:
                        continue
                    candidate = os.path.expandvars(os.path.expanduser(image_value))
                    if not os.path.isabs(candidate) and data_root:
                        candidate = os.path.join(data_root, candidate)
                    normalized = _normalize_path(candidate)
                    lookup[normalized] = text_value
                    base = os.path.basename(normalized)
                    if base:
                        name_lookup[base] = text_value
        except OSError:
            return {"by_path": {}, "by_name": {}}

        return {"by_path": lookup, "by_name": name_lookup}

    if fmt == "folder":
        annotation_root = _expand(cfg.get("path"))
        if not annotation_root or not os.path.isdir(annotation_root):
            if data_root:
                candidate = os.path.join(data_root, annotation_root)
                if os.path.isdir(candidate):
                    annotation_root = candidate
                else:
                    return {"by_path": {}, "by_name": {}}
            else:
                return {"by_path": {}, "by_name": {}}
        extension = cfg.get("file_extension") or ".txt"
        lookup: Dict[str, str] = {}
        name_lookup: Dict[str, str] = {}

        for image_path in _collect_files_for_folder(dataset):
            annotation_file = _annotation_file_for(image_path, data_root, annotation_root, extension)
            if not os.path.isfile(annotation_file):
                continue
            try:
                with open(annotation_file, "r", encoding="utf-8") as handle:
                    text_value = handle.read().strip()
            except OSError:
                continue
            if not text_value:
                continue
            normalized = _normalize_path(image_path)
            lookup[normalized] = text_value
            base = os.path.basename(normalized)
            if base:
                name_lookup[base] = text_value
        return {"by_path": lookup, "by_name": name_lookup}

    return {"by_path": {}, "by_name": {}}


def _annotation_file_for(image_path: str, data_root: str, ann_root: str, extension: str) -> str:
    if not extension:
        extension = ".txt"
    if not extension.startswith("."):
        extension = f".{extension}"
    try:
        rel = os.path.relpath(image_path, data_root)
    except ValueError:
        rel = os.path.basename(image_path)
    base, _ = os.path.splitext(rel)
    return os.path.join(ann_root, base + extension)


def _collect_files_for_folder(dataset) -> List[str]:
    from app.services.local_scan import scan_local_folder

    source = dataset.data_source or {}
    if source.get("type") != "local_folder":
        return []
    cfg = source.get("config") or {}
    root = cfg.get("path", "")
    pattern = cfg.get("pattern", "*")
    recursive = cfg.get("recursive", False)
    return scan_local_folder(root, pattern, recursive=recursive)


def default_grounding_text_for_path(dataset, path: str, lookup=None) -> str | None:
    if lookup is None:
        lookup = load_grounding_text_lookup(dataset)
    normalized = _normalize_path(path)
    if normalized in lookup["by_path"]:
        return lookup["by_path"][normalized]
    base = os.path.basename(normalized)
    if base:
        return lookup["by_name"].get(base)
    return None
