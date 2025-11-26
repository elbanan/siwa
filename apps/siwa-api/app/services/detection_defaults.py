"""
Utilities for reading default detection annotations from folder structures.
"""

from __future__ import annotations

import json
import os
from typing import Dict, List, Set
from uuid import uuid4


def _expand(path: str | None) -> str:
    return os.path.expandvars(os.path.expanduser(path or ""))


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


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


def _label_for_index(
    label_index: str,
    label_map: Dict[str, str],
    dataset_class_names: List[str] | None,
) -> str:
    index_key = str(label_index).strip()
    if index_key in label_map and label_map[index_key]:
        return label_map[index_key]
    try:
        idx = int(index_key)
        if dataset_class_names and 0 <= idx < len(dataset_class_names):
            return dataset_class_names[idx]
    except (ValueError, TypeError):
        pass
    return index_key


def detection_defaults_for_files(dataset, files: List[str]) -> Dict[str, List[dict]]:
    """
    Load detection annotations from configured default sources.
    Supports folder-based YOLO txt files and JSON exports.
    """
    ann = dataset.annotation_source or {}
    cfg = ann.get("config") or {}
    fmt = (ann.get("format") or "").lower()
    if fmt == "folder":
        return _defaults_from_folder(dataset, files, cfg)
    if fmt == "json":
        return _defaults_from_json(dataset, files, cfg)
    return {}


def _defaults_from_folder(dataset, files: List[str], cfg: dict) -> Dict[str, List[dict]]:
    annotation_root = _expand(cfg.get("path"))
    if not annotation_root or not os.path.isdir(annotation_root):
        return {}

    data_root = _expand(dataset.data_source.get("config", {}).get("path"))
    label_map = {str(k): str(v) for k, v in (cfg.get("label_map") or {}).items()}
    extension = cfg.get("file_extension") or ".txt"

    defaults: Dict[str, List[dict]] = {}

    for image_path in files:
        annotation_file = _annotation_file_for(
            image_path, data_root, annotation_root, extension
        )
        if not os.path.isfile(annotation_file):
            continue
        try:
            with open(annotation_file, "r") as handle:
                lines = handle.readlines()
        except OSError:
            continue

        boxes: List[dict] = []
        for idx, raw in enumerate(lines):
            parts = raw.strip().split()
            if len(parts) < 5:
                continue
            label_index = parts[0]
            try:
                x_center = float(parts[1])
                y_center = float(parts[2])
                width = float(parts[3])
                height = float(parts[4])
            except (TypeError, ValueError):
                continue

            width = _clamp(width)
            height = _clamp(height)
            x = _clamp(x_center - width / 2)
            y = _clamp(y_center - height / 2)
            if x + width > 1.0:
                width = _clamp(1.0 - x)
            if y + height > 1.0:
                height = _clamp(1.0 - y)
            if width <= 0 or height <= 0:
                continue

            boxes.append(
                {
                    "id": f"default-{idx}-{uuid4()}",
                    "label": _label_for_index(
                        label_index, label_map, dataset.class_names
                    ),
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                    "label_index": label_index,
                }
            )

        if boxes:
            norm = os.path.normpath(image_path).lower()
            defaults[norm] = boxes

    return defaults


def _defaults_from_json(dataset, files: List[str], cfg: dict) -> Dict[str, List[dict]]:
    json_path = _expand(cfg.get("path"))
    if not json_path or not os.path.isfile(json_path):
        return {}

    try:
        with open(json_path, "r") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}

    entries: List[dict]
    if isinstance(payload, list):
        entries = payload
    else:
        entries = payload.get("annotations") or payload.get("data") or []
    if not isinstance(entries, list):
        return {}

    data_root = _expand(dataset.data_source.get("config", {}).get("path", ""))

    lookup_by_path: Dict[str, List[dict]] = {}
    lookup_by_name: Dict[str, List[dict]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        raw_path = entry.get("path")
        if not raw_path:
            continue
        candidate = raw_path
        if not os.path.isabs(candidate) and data_root:
            candidate = os.path.join(data_root, candidate)
        normalized = os.path.normpath(_expand(candidate)).lower()
        base_name = os.path.basename(normalized)
        boxes: List[dict] = []
        for box in entry.get("boxes", []):
            label = (box.get("label") or "").strip()
            if not label:
                continue
            try:
                x = float(box.get("x", 0))
                y = float(box.get("y", 0))
                width = float(box.get("width", 0))
                height = float(box.get("height", 0))
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
            boxes.append(
                {
                    "id": box.get("id") or f"default-json-{uuid4()}",
                    "label": label,
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                }
            )
        if boxes:
            lookup_by_path.setdefault(normalized, []).extend([dict(box) for box in boxes])
            if base_name:
                lookup_by_name.setdefault(base_name, []).extend([dict(box) for box in boxes])

    if not lookup_by_path and not lookup_by_name:
        return {}

    defaults: Dict[str, List[dict]] = {}
    for path in files:
        norm = os.path.normpath(path).lower()
        base = os.path.basename(norm)
        boxes = lookup_by_path.get(norm)
        if boxes:
            defaults[norm] = boxes
            continue
        alt = lookup_by_name.get(base)
        if alt:
            defaults[norm] = alt
    return defaults


def detection_label_names_from_source(dataset) -> List[str]:
    """Infer detection class names from annotation sources."""
    ann = dataset.annotation_source or {}
    cfg = ann.get("config") or {}
    fmt = (ann.get("format") or "").lower()

    if fmt == "folder":
        label_map = cfg.get("label_map") or {}
        if label_map:
            entries = sorted(
                ((k, v) for k, v in label_map.items() if v),
                key=lambda item: (float(item[0]) if str(item[0]).isdigit() else item[0]),
            )
            return [str(label) for _, label in entries]
        return []
    if fmt == "json":
        json_path = _expand(cfg.get("path"))
        if not json_path or not os.path.isfile(json_path):
            return []
        try:
            with open(json_path, "r") as handle:
                payload = json.load(handle)
        except (OSError, json.JSONDecodeError):
            return []
        entries: List[dict]
        if isinstance(payload, list):
            entries = payload
        else:
            entries = payload.get("annotations") or payload.get("data") or []
        if not isinstance(entries, list):
            return []
        labels: Set[str] = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            for box in entry.get("boxes", []):
                label = (box.get("label") or "").strip()
                if label:
                    labels.add(label)
        return sorted(labels)
    return []
