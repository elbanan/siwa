"""Helpers for deriving annotation insights such as class lists/counts."""

from __future__ import annotations

import csv
import os
from collections import Counter
from typing import Dict, Iterable, Tuple


def _expand(path: str | None) -> str:
    return os.path.expandvars(os.path.expanduser(path or ""))


def _read_csv_column(csv_path: str, column: str) -> Iterable[str]:
    values: set[str] = set()
    if not os.path.isfile(csv_path):
        return values
    with open(csv_path, "r", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or column not in reader.fieldnames:
            return values
        for row in reader:
            value = (row.get(column) or "").strip()
            if value:
                values.add(value)
    return values


def _build_csv_lookup(csv_path: str, image_column: str, label_column: str) -> Dict[str, str]:
    lookup: Dict[str, str] = {}
    if not os.path.isfile(csv_path):
        return lookup
    with open(csv_path, "r", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            return lookup
        for row in reader:
            image_id = (row.get(image_column) or "").strip()
            label = (row.get(label_column) or "").strip()
            if not image_id or not label:
                continue
            norm = image_id.replace("\\", "/")
            base = os.path.basename(norm)
            stem = os.path.splitext(base)[0]
            for key in {norm, base, stem}:
                lookup[key] = label
    return lookup


def infer_class_names(dataset) -> list[str]:
    """Best-effort inference of class names from annotation config."""
    existing = set(dataset.class_names or [])
    if dataset.task_type != "classification":
        return sorted(existing)

    ann = dataset.annotation_source or {}
    cfg = ann.get("config") or {}
    fmt = ann.get("format")

    if fmt == "folder":
        root = _expand(cfg.get("path"))
        if os.path.isdir(root):
            for entry in os.scandir(root):
                if entry.is_dir():
                    existing.add(entry.name)
    elif fmt == "csv":
        label_col = cfg.get("label_column")
        csv_path = _expand(cfg.get("path"))
        if label_col:
            existing.update(_read_csv_column(csv_path, label_col))

    return sorted([c for c in existing if c])


def class_counts_for_files(dataset, files: list[str]) -> Tuple[Dict[str, str], Dict[str, int]]:
    """Return per-file labels and aggregate counts for classification datasets."""
    if dataset.task_type != "classification" or not files:
        return {}, {}

    ann = dataset.annotation_source or {}
    if not ann:
        return {}, {}

    labels_by_file: Dict[str, str] = {}
    counts: Counter[str] = Counter()

    cfg = ann.get("config") or {}
    fmt = ann.get("format")
    lookup: Dict[str, str] = {}

    if fmt == "csv":
        csv_path = _expand(cfg.get("path"))
        image_col = cfg.get("image_column")
        label_col = cfg.get("label_column")
        if csv_path and image_col and label_col:
            lookup = _build_csv_lookup(csv_path, image_col, label_col)

    data_root = _expand(dataset.data_source.get("config", {}).get("path", ""))

    for file_path in files:
        label = None
        if lookup:
            base = os.path.basename(file_path)
            stem = os.path.splitext(base)[0]
            label = lookup.get(base) or lookup.get(stem)
            if not label:
                normalized_full = file_path.replace("\\", "/")
                label = lookup.get(normalized_full)
        if not label and data_root and fmt == "folder":
            try:
                rel = os.path.relpath(file_path, data_root)
            except ValueError:
                rel = file_path
            parts = rel.split(os.sep)
            if parts:
                candidate = parts[0]
                if candidate and candidate != ".":
                    label = candidate
            if not label:
                rel_norm = rel.replace("\\", "/")
                label = lookup.get(rel_norm)
        if label:
            labels_by_file[file_path] = label
            counts[label] += 1

    class_counts = dict(counts)
    for cls in dataset.class_names or []:
        class_counts.setdefault(cls, 0)

    return labels_by_file, class_counts
