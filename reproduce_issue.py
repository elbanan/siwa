
import csv
import os
from typing import Dict, List

def _build_csv_lookup(csv_path: str, image_column: str, label_column: str) -> Dict[str, List[str]]:
    lookup: Dict[str, List[str]] = {}
    if not os.path.isfile(csv_path):
        return lookup
    with open(csv_path, "r", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            return lookup
        for row in reader:
            image_id = (row.get(image_column) or "").strip()
            val = (row.get(label_column) or "").strip()
            if not image_id or not val:
                continue
            
            # Heuristic: if comma is present, assume comma-separated.
            # Otherwise, if space is present, assume space-separated.
            if "," in val:
                labels = [p.strip() for p in val.split(",")]
            else:
                labels = [p.strip() for p in val.split(" ")]
            
            labels = [l for l in labels if l]
            if not labels:
                continue

            norm = image_id.replace("\\", "/")
            base = os.path.basename(norm)
            stem = os.path.splitext(base)[0]
            for key in {norm, base, stem}:
                lookup[key] = labels
    return lookup

# Create a dummy CSV
with open("test.csv", "w") as f:
    f.write("image_id,labels\n")
    f.write("img1.jpg,cat dog\n")
    f.write("img2.jpg,bird\n")
    f.write("img3.jpg,1 2 3\n")

# Test
lookup = _build_csv_lookup("test.csv", "image_id", "labels")
print(lookup)
