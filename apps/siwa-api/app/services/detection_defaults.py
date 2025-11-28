"""
Utilities for reading default detection annotations from folder structures.
"""

from __future__ import annotations

import json
import os
from typing import Dict, List, Set, Tuple
from uuid import uuid4
import xml.etree.ElementTree as ET
from app.services.detection_csv import (
    detection_defaults_from_csv,
    detection_label_names_from_csv,
    parse_detection_bbox,
)
from app.services.image_io import load_image_or_dicom


def _expand(path: str | None) -> str:
    return os.path.expandvars(os.path.expanduser(path or ""))


def _load_label_map_from_file(file_path: str) -> Dict[str, str]:
    """
    Load a label map from a text file.
    Expected format: one mapping per line, either "index label" or "index: label"
    Example:
        0 background
        1 person
        2 car
    or:
        0: background
        1: person
        2: car
    """
    label_map: Dict[str, str] = {}
    expanded_path = _expand(file_path)
    
    if not os.path.isfile(expanded_path):
        return label_map
    
    try:
        with open(expanded_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                
                # Try splitting by colon first, then by space
                if ":" in line:
                    parts = line.split(":", 1)
                else:
                    parts = line.split(None, 1)
                
                if len(parts) == 2:
                    index = parts[0].strip()
                    label = parts[1].strip()
                    if index and label:
                        label_map[index] = label
    except Exception as e:
        print(f"Warning: Failed to load label map from {file_path}: {e}")
    
    return label_map


def _resolve_annotation_path(dataset, path: str | None) -> str:
    """
    Resolve an annotation path, falling back to the dataset root when the path is relative.
    """
    candidate = _expand(path)
    if not candidate:
        return ""
    if os.path.isabs(candidate):
        return os.path.normpath(candidate)
    source = getattr(dataset, "data_source", {}) or {}
    cfg = (source.get("config") or {}) if isinstance(source, dict) else {}
    data_root = _expand(cfg.get("path"))
    if data_root:
        candidate = os.path.normpath(os.path.join(data_root, candidate))
    return candidate


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


def _image_dimensions(path: str, cache: dict[str, Tuple[int, int] | None]) -> Tuple[int, int] | None:
    if path in cache:
        return cache[path]
    try:
        img = load_image_or_dicom(path)
        dims = (img.width, img.height)
    except Exception:
        dims = None
    cache[path] = dims
    return dims


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
    if fmt == "csv":
        return detection_defaults_from_csv(dataset, files, cfg)
    return {}


def _defaults_from_pascal_voc_xml(dataset, files: List[str], cfg: dict) -> Dict[str, List[dict]]:
    annotation_root = _resolve_annotation_path(dataset, cfg.get("path"))
    if not annotation_root or not os.path.isdir(annotation_root):
        return {}

    data_root = _expand(dataset.data_source.get("config", {}).get("path"))
    extension = cfg.get("file_extension") or ".xml"
    defaults: Dict[str, List[dict]] = {}
    
    # Load label map from file if specified, then merge with inline label_map
    label_map = {}
    label_map_file = cfg.get("label_map_file")
    if label_map_file:
        label_map = _load_label_map_from_file(label_map_file)
    
    # Merge with inline label_map (inline takes precedence)
    inline_label_map = {str(k): str(v) for k, v in (cfg.get("label_map") or {}).items()}
    label_map.update(inline_label_map)
    
    dims_cache: dict[str, Tuple[int, int] | None] = {}

    for image_path in files:
        norm_path = os.path.normpath(image_path)
        annotation_file = _annotation_file_for(
            image_path, data_root, annotation_root, extension
        )
        if not os.path.isfile(annotation_file):
            continue
            
        try:
            tree = ET.parse(annotation_file)
            root = tree.getroot()
        except (OSError, ET.ParseError):
            continue

        # Get image size from XML if available, otherwise try to load image
        size_node = root.find("size")
        width = 0
        height = 0
        if size_node is not None:
            width_node = size_node.find("width")
            height_node = size_node.find("height")
            if width_node is not None and height_node is not None:
                try:
                    width = int(width_node.text or 0)
                    height = int(height_node.text or 0)
                except ValueError:
                    pass
        
        if width <= 0 or height <= 0:
             # Fallback to loading image
             dims = _image_dimensions(norm_path, dims_cache)
             if dims:
                 width, height = dims
        
        if width <= 0 or height <= 0:
            continue

        boxes: List[dict] = []
        for obj in root.findall("object"):
            name_node = obj.find("name")
            if name_node is None or not name_node.text:
                continue
            name = name_node.text
            
            # Apply label map if exists
            if label_map:
                 name = label_map.get(name, name)

            bndbox = obj.find("bndbox")
            if bndbox is None:
                continue
            
            try:
                xmin = float(bndbox.find("xmin").text)
                ymin = float(bndbox.find("ymin").text)
                xmax = float(bndbox.find("xmax").text)
                ymax = float(bndbox.find("ymax").text)
            except (ValueError, AttributeError, TypeError):
                continue
                
            # Normalize
            box_width = xmax - xmin
            box_height = ymax - ymin
            
            x = xmin / width
            y = ymin / height
            w = box_width / width
            h = box_height / height
            
            # Clamp
            x = _clamp(x)
            y = _clamp(y)
            w = _clamp(w)
            h = _clamp(h)
            
            if w <= 0 or h <= 0:
                continue
                
            boxes.append({
                "id": f"default-xml-{uuid4()}",
                "label": name,
                "x": x,
                "y": y,
                "width": w,
                "height": h
            })
            
        if boxes:
            defaults[norm_path.lower()] = boxes
            
    return defaults


def _defaults_from_folder(dataset, files: List[str], cfg: dict) -> Dict[str, List[dict]]:
    annotation_root = _resolve_annotation_path(dataset, cfg.get("path"))
    if not annotation_root or not os.path.isdir(annotation_root):
        return {}

    data_root = _expand(dataset.data_source.get("config", {}).get("path"))
    
    # Load label map from file if specified, then merge with inline label_map
    label_map = {}
    label_map_file = cfg.get("label_map_file")
    if label_map_file:
        label_map = _load_label_map_from_file(label_map_file)
    
    # Merge with inline label_map (inline takes precedence)
    inline_label_map = {str(k): str(v) for k, v in (cfg.get("label_map") or {}).items()}
    label_map.update(inline_label_map)
    
    representation = (cfg.get("annotation_representation") or "yolo").lower()
    default_ext = ".xml" if representation == "pascal_voc" else ".txt"
    extension = cfg.get("file_extension") or default_ext
    
    if extension.lower() == ".xml" or representation == "pascal_voc":
        # If explicitly pascal_voc or .xml extension, try XML parsing first
        # But wait, what if someone has pascal_voc text files? 
        # The previous code handled pascal_voc as text.
        # But standard Pascal VOC is XML.
        # Let's assume if it's .xml it's XML, otherwise text.
        if extension.lower() == ".xml":
             return _defaults_from_pascal_voc_xml(dataset, files, cfg)

    dims_cache: dict[str, Tuple[int, int] | None] = {}
    defaults: Dict[str, List[dict]] = {}

    for image_path in files:
        norm_path = os.path.normpath(image_path)
        dims = None
        if representation in {"pascal_voc", "coco_bbox"}:
            dims = _image_dimensions(norm_path, dims_cache)
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
            if len(parts) < 2:
                continue
            label_index = parts[0]
            geom_value = " ".join(parts[1:])
            bbox = parse_detection_bbox(geom_value, dims, representation)
            if not bbox:
                continue
            x, y, width, height = bbox

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
            defaults[norm_path.lower()] = boxes

    return defaults


def _defaults_from_json(dataset, files: List[str], cfg: dict) -> Dict[str, List[dict]]:
    json_path = _resolve_annotation_path(dataset, cfg.get("path"))
    if not json_path or not os.path.isfile(json_path):
        return {}

    try:
        with open(json_path, "r") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}

    # Load label map from file if specified, then merge with inline label_map
    label_map = {}
    label_map_file = cfg.get("label_map_file")
    if label_map_file:
        label_map = _load_label_map_from_file(label_map_file)
    
    # Merge with inline label_map (inline takes precedence)
    inline_label_map = {str(k): str(v) for k, v in (cfg.get("label_map") or {}).items()}
    label_map.update(inline_label_map)
    
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
        # Check if we should scan XML files
        extension = cfg.get("file_extension")
        representation = (cfg.get("annotation_representation") or "yolo").lower()
        
        if extension == ".xml" or (not extension and representation == "pascal_voc"):
             # Scan XML files for labels
             annotation_root = _resolve_annotation_path(dataset, cfg.get("path"))
             if not annotation_root or not os.path.isdir(annotation_root):
                 return []
             
             ext = extension or ".xml"
             labels: Set[str] = set()
             
             # We need to scan all XML files in the annotation root
             # This might be expensive if there are many files.
             # But we don't have the list of files here easily without scanning.
             # Let's just scan the directory.
             for root, _, files in os.walk(annotation_root):
                 for file in files:
                     if file.endswith(ext):
                         try:
                             tree = ET.parse(os.path.join(root, file))
                             for obj in tree.findall("object"):
                                 name = obj.find("name")
                                 if name is not None and name.text:
                                     labels.add(name.text)
                         except (OSError, ET.ParseError):
                             pass
             return sorted(labels)

        label_map = cfg.get("label_map") or {}
        if label_map:
            entries = sorted(
                ((k, v) for k, v in label_map.items() if v),
                key=lambda item: (float(item[0]) if str(item[0]).isdigit() else item[0]),
            )
            return [str(label) for _, label in entries]
        return []
    if fmt == "json":
        json_path = _resolve_annotation_path(dataset, cfg.get("path"))
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
    if fmt == "csv":
        return detection_label_names_from_csv(dataset, cfg)
    return []
