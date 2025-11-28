"""
Browse external data directory routes.

Allows users to browse folders and files within the mounted external data directory.
Security: All paths are validated to prevent directory traversal attacks.
"""

import os
from pathlib import Path
from typing import List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from app.api.deps import get_current_user
from app.core.config import settings
from app.models.user import User


router = APIRouter(prefix="/browse", tags=["browse"])


def _validate_path(requested_path: str) -> Path:
    """
    Validate that the requested path is within the external data directory.
    
    Args:
        requested_path: Relative path within external data directory
        
    Returns:
        Absolute resolved path
        
    Raises:
        HTTPException: If path is outside allowed directory or doesn't exist
    """
    # Get the base external data path
    base_path = Path(settings.EXTERNAL_DATA_PATH).resolve()
    
    # Resolve the requested path relative to base
    if requested_path:
        full_path = (base_path / requested_path).resolve()
    else:
        full_path = base_path
    
    # Security check: ensure the resolved path is within base_path
    try:
        full_path.relative_to(base_path)
    except ValueError:
        raise HTTPException(
            status_code=403,
            detail="Access denied: path is outside allowed directory"
        )
    
    # Check if path exists
    if not full_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Path not found: {requested_path}"
        )
    
    return full_path


@router.get("", response_model=Dict[str, Any])
def browse_directory(
    path: str = Query(default="", description="Relative path within external data directory"),
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    List contents of a directory within the external data mount.
    
    Returns:
        - current_path: The current relative path
        - parent_path: The parent relative path (null if at root)
        - items: List of files and directories with metadata
    """
    full_path = _validate_path(path)
    
    # Check if it's a directory
    if not full_path.is_dir():
        raise HTTPException(
            status_code=400,
            detail="Path must be a directory"
        )
    
    # Get parent path
    base_path = Path(settings.EXTERNAL_DATA_PATH).resolve()
    parent_path = None
    if full_path != base_path:
        parent = full_path.parent
        try:
            parent_rel = parent.relative_to(base_path)
            parent_path = str(parent_rel) if str(parent_rel) != "." else ""
        except ValueError:
            parent_path = None
    
    # List directory contents
    items: List[Dict[str, Any]] = []
    try:
        for entry in sorted(full_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            item_type = "directory" if entry.is_dir() else "file"
            
            # Get relative path from base
            rel_path = entry.relative_to(base_path)
            
            item = {
                "name": entry.name,
                "type": item_type,
                "path": str(rel_path),
            }
            
            # Add size for files
            if entry.is_file():
                try:
                    item["size"] = entry.stat().st_size
                except OSError:
                    item["size"] = 0
            
            items.append(item)
    except PermissionError:
        raise HTTPException(
            status_code=403,
            detail="Permission denied: cannot read directory"
        )
    
    return {
        "current_path": path,
        "parent_path": parent_path,
        "root_path": str(base_path),
        "items": items,
    }
