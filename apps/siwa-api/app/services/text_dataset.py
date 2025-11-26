"""
Helpers for loading text classification datasets from CSV sources.
"""

import csv
import os
from typing import Dict, List


def _expand(path: str | None) -> str:
    return os.path.expandvars(os.path.expanduser(path or ""))


def read_text_rows(dataset) -> List[dict]:
    source = dataset.data_source or {}
    if source.get("type") != "local_csv":
        return []
    cfg = source.get("config") or {}
    csv_path = _expand(cfg.get("path"))
    text_col = cfg.get("text_column")
    label_col = cfg.get("label_column")
    id_col = (cfg.get("id_column") or "").strip() or None
    if not csv_path or not os.path.isfile(csv_path) or not text_col:
        return []
    rows: List[dict] = []
    with open(csv_path, "r", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            return []
        for idx, row in enumerate(reader):
            record_id = (
                (str(row.get(id_col)).strip() if id_col and row.get(id_col) is not None else None)
                or row.get("id")
                or row.get("ID")
                or row.get("uuid")
                or row.get("UUID")
                or f"{idx}"
            )
            if record_id is None:
                record_id = f"{idx}"
            record_id = str(record_id).strip()
            text_value = (row.get(text_col) or "").strip()
            label_value = (row.get(label_col) or "").strip() if label_col else ""
            rows.append(
                {
                    "id": record_id,
                    "index": idx,
                    "text": text_value,
                    "label": label_value,
                    "row": row,
                }
            )
    return rows


def infer_text_labels(rows: List[dict]) -> List[str]:
    labels = sorted({row.get("label", "") for row in rows if row.get("label")})
    return labels
