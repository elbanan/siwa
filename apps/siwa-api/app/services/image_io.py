"""
image_io.py

Utilities to:
- Detect file type (image vs DICOM)
- Load local image or DICOM into a PIL Image
- Produce a resized JPEG thumbnail or full-resolution PNG/JPEG

Local-first security:
- We only load files that are part of a dataset's local_folder source.
- We rely on dataset source config for allowed root path(s).
"""

from __future__ import annotations

import os
from io import BytesIO
from typing import Tuple, Optional

import numpy as np
from PIL import Image
try:
    import pydicom
except ImportError:  # pragma: no cover
    pydicom = None


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".gif"}
DICOM_EXTS = {".dcm", ".dicom"}


def is_dicom(path: str) -> bool:
    return os.path.splitext(path.lower())[1] in DICOM_EXTS


def is_image(path: str) -> bool:
    return os.path.splitext(path.lower())[1] in IMAGE_EXTS


def _normalize_path(path: str) -> str:
    return os.path.expandvars(os.path.expanduser(path))


def load_image_or_dicom(path: str) -> Image.Image:
    """
    Load a local image or DICOM into PIL Image.

    For DICOM:
    - Reads pixel_array
    - Normalizes to 0..255
    - Converts to uint8 and PIL
    - Handles MONOCHROME1 by inversion
    """
    path = _normalize_path(path)

    if is_image(path):
        return Image.open(path).convert("RGB")

    if is_dicom(path):
        if pydicom is None:
            raise ValueError("pydicom not installed")
        ds = pydicom.dcmread(path)
        arr = ds.pixel_array.astype(np.float32)

        # Handle rescale for CT-like modalities if present
        slope = float(getattr(ds, "RescaleSlope", 1.0))
        intercept = float(getattr(ds, "RescaleIntercept", 0.0))
        arr = arr * slope + intercept

        # If photometric is MONOCHROME1, invert
        if getattr(ds, "PhotometricInterpretation", "") == "MONOCHROME1":
            arr = arr.max() - arr

        # Normalize robustly
        lo, hi = np.percentile(arr, (1, 99))
        arr = np.clip(arr, lo, hi)
        arr = (arr - lo) / (hi - lo + 1e-6) * 255.0
        arr = arr.astype(np.uint8)

        # If grayscale, convert to RGB
        if arr.ndim == 2:
            img = Image.fromarray(arr, mode="L").convert("RGB")
        else:
            img = Image.fromarray(arr).convert("RGB")

        return img

    # Fallback
    raise ValueError(f"Unsupported file type: {path}")


def make_thumbnail(img: Image.Image, size: Tuple[int, int] = (256, 256)) -> bytes:
    """
    Produce JPEG thumbnail bytes.
    """
    im = img.copy()
    im.thumbnail(size)
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def encode_full(img: Image.Image, fmt: str = "JPEG") -> bytes:
    """
    Encode full view bytes.
    """
    buf = BytesIO()
    img.save(buf, format=fmt, quality=95)
    return buf.getvalue()
