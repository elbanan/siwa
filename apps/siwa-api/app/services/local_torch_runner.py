"""
Utility to run a locally uploaded torch model for simple text generation.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict


@lru_cache(maxsize=4)
def _load_model(path: str):
    import torch  # type: ignore

    return torch.load(path, map_location="cpu")


def run_local_model(
    path: str,
    prompt: str,
    params: Dict[str, Any],
    architecture_hint: str | None = None,
) -> str:
    """
    Attempts to execute a local PyTorch artifact.
    The artifact must be either callable or expose a .generate(prompt, **kwargs) method.
    """
    model = _load_model(path)

    kwargs = {
        "prompt": prompt,
        "temperature": params.get("temperature"),
        "top_p": params.get("top_p"),
        "max_tokens": params.get("max_tokens"),
        "presence_penalty": params.get("presence_penalty"),
        "frequency_penalty": params.get("frequency_penalty"),
    }

    # Remove None values to make kwargs cleaner
    kwargs = {k: v for k, v in kwargs.items() if v is not None}

    if hasattr(model, "generate"):
        result = model.generate(prompt, **kwargs)  # type: ignore[attr-defined]
    elif callable(model):
        result = model(prompt, **kwargs)
    else:
        raise RuntimeError(
            f"Model {architecture_hint or ''} is not callable and exposes no .generate() method."
        )

    if isinstance(result, str):
        return result
    if isinstance(result, dict) and "text" in result:
        return str(result["text"])
    return str(result)
