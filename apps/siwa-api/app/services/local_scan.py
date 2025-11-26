"""
Local filesystem scanning helpers for local-first data sources.

Supports:
- local_folder + glob pattern
Designed to be extended later to local_file_list, minio, and external connectors.
"""

import glob
import os
import fnmatch
from typing import List, Dict, Any, Iterable


def _normalize_root(path: str) -> str:
    return os.path.expandvars(os.path.expanduser(path or ""))


def _pattern_list(pattern: Any) -> List[str]:
    if isinstance(pattern, list):
        patterns = [str(p).strip() for p in pattern if str(p).strip()]
    elif isinstance(pattern, str):
        patterns = [p.strip() for p in pattern.split(",") if p.strip()]
    else:
        patterns = []
    return patterns or ["*"]


def scan_local_folder(path: str, pattern: Any = "*", recursive: bool = False) -> List[str]:
    """
    Return a sorted list of matching file paths in a local folder.
    Non-recursive unless pattern includes **.
    """
    root = _normalize_root(path)
    if not os.path.isdir(root):
        return []

    patterns = _pattern_list(pattern)

    if not recursive:
        files: list[str] = []
        for pat in patterns:
            search_pattern = os.path.join(root, pat or "*")
            files.extend(glob.glob(search_pattern))
        return sorted({f for f in files if os.path.isfile(f)})

    matches: set[str] = set()
    rel_patterns = patterns
    for dirpath, _, filenames in os.walk(root):
        for filename in filenames:
            full_path = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(full_path, root)
            for pat in rel_patterns:
                if fnmatch.fnmatch(filename, pat) or fnmatch.fnmatch(rel_path, pat):
                    matches.add(full_path)
                    break
    return sorted(matches)


def preview_local_folder(path: str, pattern: str = "*", limit: int = 12, recursive: bool = False) -> Dict[str, Any]:
    """
    Return a small preview payload:
    - count
    - first N file paths
    """
    files = scan_local_folder(path, pattern, recursive=recursive)
    return {
        "count": len(files),
        "sample_paths": files[:limit],
    }
