"""
Hardware detection service.

Detects available compute devices (CUDA, MPS, CPU) for ML workloads.
"""

from typing import Dict, List, Any


def detect_available_devices() -> Dict[str, Any]:
    """
    Detect available compute devices on the system.
    
    Returns:
        dict: {
            "devices": List of available device names ["cpu", "cuda", "mps"],
            "default": Best available device (cuda > mps > cpu),
            "cuda_available": bool,
            "mps_available": bool,
            "cuda_device_count": int,
            "cuda_device_name": str | None,
            "info": Human-readable description
        }
    """
    devices: List[str] = ["cpu"]  # CPU is always available
    cuda_available = False
    mps_available = False
    cuda_device_count = 0
    cuda_device_name = None
    default_device = "cpu"
    info_parts = []
    
    # Check for CUDA (NVIDIA GPUs)
    try:
        import torch
        if torch.cuda.is_available():
            cuda_available = True
            devices.append("cuda")
            cuda_device_count = torch.cuda.device_count()
            if cuda_device_count > 0:
                cuda_device_name = torch.cuda.get_device_name(0)
                default_device = "cuda"
                info_parts.append(f"CUDA: {cuda_device_name} ({cuda_device_count} device(s))")
    except Exception:
        pass
    
    # Check for MPS (Apple Silicon)
    try:
        import torch
        if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            mps_available = True
            devices.append("mps")
            if default_device == "cpu":  # Only set if CUDA not available
                default_device = "mps"
            info_parts.append("MPS: Apple Silicon GPU")
    except Exception:
        pass
    
    # Build info string
    if not info_parts:
        info_parts.append("CPU only")
    info = " | ".join(info_parts)
    
    return {
        "devices": devices,
        "default": default_device,
        "cuda_available": cuda_available,
        "mps_available": mps_available,
        "cuda_device_count": cuda_device_count,
        "cuda_device_name": cuda_device_name,
        "info": info,
    }


def get_device_description(device: str, hardware_info: Dict[str, Any] | None = None) -> str:
    """
    Get a human-readable description for a device.
    
    Args:
        device: Device name ("cpu", "cuda", "mps")
        hardware_info: Optional hardware info from detect_available_devices()
    
    Returns:
        Human-readable description
    """
    if device == "cuda":
        if hardware_info and hardware_info.get("cuda_device_name"):
            return f"CUDA - {hardware_info['cuda_device_name']} (Fastest)"
        return "CUDA - NVIDIA GPU (Fastest)"
    elif device == "mps":
        return "MPS - Apple Silicon GPU (Fast)"
    elif device == "cpu":
        return "CPU - Universal (Slowest)"
    return device
