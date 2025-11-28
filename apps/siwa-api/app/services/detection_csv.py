"""
CSV helpers for detection annotation sources.
"""

from __future__ import annotations

import csv
import json
import os
import re
from typing import Dict, List, Tuple, Optional
from uuid import uuid4

from app.services.image_io import load_image_or_dicom


def _expand(path: str | None) -> str:
    return os.path.expandvars(os.path.expanduser(path or ""))


def _resolve_csv_path(path: str | None, data_root: str | None) -> str:
    candidate = _expand(path)
    if not candidate:
        return ""
    if os.path.isabs(candidate):
        return os.path.normpath(candidate)
    if data_root:
        data_root_norm = os.path.normpath(data_root)
        combined = os.path.normpath(os.path.join(data_root_norm, candidate))
        if os.path.exists(combined):
            return combined
    if os.path.exists(candidate):
        return os.path.normpath(candidate)
    if data_root:
        return os.path.normpath(os.path.join(os.path.normpath(data_root), candidate))
    return os.path.normpath(candidate)


def _normalize_image_path(value: str, data_root: str | None) -> str:
    candidate = _expand(value)
    if not candidate:
        return ""
    if not os.path.isabs(candidate) and data_root:
        candidate = os.path.join(data_root, candidate)
    return os.path.normpath(candidate)


def _extract_numbers(text: str) -> List[float]:
    if not text:
        return []
    return [float(num) for num in re.findall(r"-?\d+\.?\d*", text) if num.strip()]


def _ensure_image_dims(path: str, cache: dict[str, Tuple[int, int]]) -> Tuple[int, int] | None:
    dims = cache.get(path)
    if dims:
        return dims
    try:
        img = load_image_or_dicom(path)
    except Exception:
        return None
    dims = (img.width, img.height)
    cache[path] = dims
    return dims


def _normalize_bbox(
    x: float,
    y: float,
    width: float,
    height: float,
    dims: Tuple[int, int] | None,
) -> Tuple[float, float, float, float] | None:
    if dims:
        img_width, img_height = dims
        if img_width > 0 and img_height > 0:
            if width > 1 or height > 1 or x > 1 or y > 1:
                x = x / img_width
                y = y / img_height
                width = width / img_width
                height = height / img_height
    width = max(0.0, min(width, 1.0))
    height = max(0.0, min(height, 1.0))
    x = max(0.0, min(x, 1.0))
    y = max(0.0, min(y, 1.0))
    if width <= 0 or height <= 0:
        return None
    if x + width > 1.0:
        width = max(0.0, 1.0 - x)
    if y + height > 1.0:
        height = max(0.0, 1.0 - y)
    if width <= 0 or height <= 0:
        return None
    return x, y, width, height


def _from_corners(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    dims: Tuple[int, int] | None,
) -> Tuple[float, float, float, float] | None:
    x_min = min(x1, x2)
    y_min = min(y1, y2)
    width = abs(x2 - x1)
    height = abs(y2 - y1)
    return _normalize_bbox(x_min, y_min, width, height, dims)


def _bbox_from_polygon(points: List[Tuple[float, float]], dims: Tuple[int, int] | None):
    if len(points) < 2:
        return None
    xs = [pt[0] for pt in points]
    ys = [pt[1] for pt in points]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    return _normalize_bbox(x_min, y_min, x_max - x_min, y_max - y_min, dims)


def _parse_json_bbox(data, dims: Tuple[int, int] | None):
    if isinstance(data, dict):
        if "x" in data and "y" in data and "width" in data and "height" in data:
            return _normalize_bbox(
                float(data["x"]),
                float(data["y"]),
                float(data["width"]),
                float(data["height"]),
                dims,
            )
        if "x1" in data and "y1" in data and "x2" in data and "y2" in data:
            return _from_corners(
                float(data["x1"]),
                float(data["y1"]),
                float(data["x2"]),
                float(data["y2"]),
                dims,
            )
        bbox = data.get("bbox")
        if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
            return _normalize_bbox(
                float(bbox[0]),
                float(bbox[1]),
                float(bbox[2]),
                float(bbox[3]),
                dims,
            )
    elif isinstance(data, (list, tuple)) and len(data) >= 4:
        coords = [float(v) for v in data[:4]]
        return _normalize_bbox(coords[0], coords[1], coords[2], coords[3], dims)
    return None


NEGATIVE_PLACEHOLDER_KEY = "negative"


def negative_placeholder(label: str | None) -> dict:
    return {
        "id": f"default-negative-{uuid4()}",
        "label": str(label or "negative"),
        "x": 0.0,
        "y": 0.0,
        "width": 0.0,
        "height": 0.0,
        NEGATIVE_PLACEHOLDER_KEY: True,
    }


def strip_negative_defaults(boxes: List[dict]) -> List[dict]:
    return [box for box in boxes if not box.get(NEGATIVE_PLACEHOLDER_KEY)]


def has_negative_default(boxes: List[dict]) -> bool:
    return any(box.get(NEGATIVE_PLACEHOLDER_KEY) for box in boxes)


def detection_defaults_from_csv(
    dataset,
    files: List[str],
    cfg: dict,
) -> Dict[str, List[dict]]:
    data_root = _expand(dataset.data_source.get("config", {}).get("path", ""))
    csv_path = _resolve_csv_path(cfg.get("path"), data_root)
    if not csv_path or not os.path.isfile(csv_path):
        return {}
    image_column = cfg.get("image_column")
    annotation_column = cfg.get("annotation_column")
    if not image_column or not annotation_column:
        return {}
    annotation_representation = (cfg.get("annotation_representation") or "yolo").lower()
    negative_value = (cfg.get("negative_value") or "").strip()
    label_column = (cfg.get("label_column") or "").strip()

    files_set = {os.path.normpath(f).lower(): f for f in files}
    defaults: Dict[str, List[dict]] = {}
    dims_cache: dict[str, Tuple[int, int]] = {}
    try:
        with open(csv_path, "r", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                raw_path = row.get(image_column, "") or row.get("path", "")
                if not raw_path:
                    continue
                resolved = _normalize_image_path(raw_path, data_root)
                norm_path = os.path.normpath(resolved).lower()
                if norm_path not in files_set:
                    continue
                boxes = defaults.setdefault(norm_path, [])
                label = (row.get(label_column, "") or row.get("label", "")).strip()
                label = label or (dataset.class_names or ["object"])[0]
                if negative_value and label.lower() == negative_value.lower():
                    if not has_negative_default(boxes):
                        boxes.append(negative_placeholder(label))
                    continue
                geom_value = row.get(annotation_column, "")
                if not geom_value:
                    continue
                dims = _ensure_image_dims(files_set[norm_path], dims_cache)
                bbox = parse_detection_bbox(geom_value, dims, annotation_representation)
                if not bbox:
                    continue
                x, y, width, height = bbox
                boxes.append(
                    {
                        "id": f"default-csv-{uuid4()}",
                        "label": label,
                        "x": x,
                        "y": y,
                        "width": width,
                        "height": height,
                    }
                )
    except Exception:
        return {}

    return defaults


def _parse_bbox_from_value(value: str, dims: Tuple[int, int] | None):
    parsed: Optional[object] = None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        pass

    if parsed is not None:
        bbox = _parse_json_bbox(parsed, dims)
        if bbox:
            return bbox

    numbers = _extract_numbers(value)
    if len(numbers) >= 4:
        return _normalize_bbox(numbers[0], numbers[1], numbers[2], numbers[3], dims)
    return None


def _bbox_from_yolo_numbers(numbers: List[float]) -> Tuple[float, float, float, float] | None:
    if len(numbers) < 4:
        return None
    x_center, y_center, width, height = map(float, numbers[:4])
    x = x_center - width / 2.0
    y = y_center - height / 2.0
    return _normalize_bbox(x, y, width, height, None)


def _bbox_from_pascal_numbers(numbers: List[float], dims: Tuple[int, int] | None):
    if not dims or len(numbers) < 4:
        return None
    img_width, img_height = dims
    if img_width <= 0 or img_height <= 0:
        return None
    x_min, y_min, x_max, y_max = map(float, numbers[:4])
    width = max(x_max - x_min, 0.0)
    height = max(y_max - y_min, 0.0)
    if width <= 0 or height <= 0:
        return None
    return _normalize_bbox(
        x_min / img_width,
        y_min / img_height,
        width / img_width,
        height / img_height,
        None,
    )


def _bbox_from_coco_numbers(numbers: List[float], dims: Tuple[int, int] | None):
    if not dims or len(numbers) < 4:
        return None
    img_width, img_height = dims
    if img_width <= 0 or img_height <= 0:
        return None
    x, y, width, height = map(float, numbers[:4])
    return _normalize_bbox(
        x / img_width,
        y / img_height,
        width / img_width,
        height / img_height,
        None,
    )


def parse_detection_bbox(
    value: str,
    dims: Tuple[int, int] | None,
    representation: str | None,
) -> Tuple[float, float, float, float] | None:
    rep = (representation or "yolo").lower()
    numbers = _extract_numbers(value)
    if rep == "yolo":
        return _bbox_from_yolo_numbers(numbers)
    if rep == "pascal_voc":
        return _bbox_from_pascal_numbers(numbers, dims)
    if rep == "coco_bbox":
        return _bbox_from_coco_numbers(numbers, dims)
    return _parse_bbox_from_value(value, dims)


def detection_label_names_from_csv(dataset, cfg: dict) -> List[str]:
    data_root = _expand(dataset.data_source.get("config", {}).get("path", ""))
    csv_path = _resolve_csv_path(cfg.get("path"), data_root)
    if not csv_path or not os.path.isfile(csv_path):
        return []
    image_column = cfg.get("image_column")
    if not image_column:
        return []
    negative_value = (cfg.get("negative_value") or "").strip()
    labels: set[str] = set()
    try:
        with open(csv_path, "r", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                label = (row.get(cfg.get("label_column") or "", "") or "").strip()
                if not label or (negative_value and label.lower() == negative_value.lower()):
                    continue
                labels.add(label)
    except Exception:
        return []
    return sorted(labels)
