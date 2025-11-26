"""
Thin wrapper around the local Ollama CLI.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any, Tuple, List, Dict

import requests


def _parse_json_lines(stdout: str) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    for raw_line in stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        models.append(
            {
                "name": parsed.get("name") or parsed.get("model"),
                "digest": parsed.get("digest"),
                "size": parsed.get("size"),
                "modified_at": parsed.get("modified_at") or parsed.get("modified"),
                "raw": parsed,
            }
        )
    return models


def _parse_plain_table(stdout: str) -> list[dict[str, Any]]:
    """
    Parse the default `ollama list` output when --json is unavailable.
    """
    lines = [line.rstrip() for line in stdout.splitlines() if line.strip()]
    if not lines or len(lines) == 1:
        return []
    entries: list[dict[str, Any]] = []
    for line in lines[1:]:
        parts = line.split(None, 3)
        if not parts:
            continue
        name = parts[0]
        digest = parts[1] if len(parts) > 1 else None
        size_label = parts[2] if len(parts) > 2 else None
        modified = parts[3] if len(parts) > 3 else None
        entries.append(
            {
                "name": name,
                "digest": digest,
                "size": None,
                "modified_at": modified,
                "raw": {
                    "size_label": size_label,
                    "line": line,
                },
            }
        )
    return entries


def _run_ollama(args: list[str], timeout: int = 10) -> Tuple[str, str]:
    """
    Run an Ollama CLI command and return (stdout, stderr).
    Raises subprocess.CalledProcessError on failure.
    """
    result = subprocess.run(
        ["ollama", *args],
        capture_output=True,
        text=True,
        check=True,
        timeout=timeout,
    )
    return result.stdout or "", result.stderr or ""


def list_local_models() -> Tuple[List[dict[str, Any]], str | None]:
    """
    Returns ([models], error_message).
    Uses `ollama list --json`, which emits one JSON object per line.
    """
    try:
        stdout, _ = _run_ollama(["list", "--json"])
        return _parse_json_lines(stdout), None
    except FileNotFoundError:
        return [], "Ollama CLI not found. Install Ollama to link local models."
    except subprocess.TimeoutExpired:
        return [], "Timed out talking to Ollama CLI."
    except subprocess.CalledProcessError as exc:
        err = exc.stderr.strip() or str(exc)
        lowered = err.lower()
        json_not_supported = "unknown flag" in lowered or "unknown shorthand flag" in lowered
        if json_not_supported:
            try:
                stdout, _ = _run_ollama(["list"])
            except subprocess.CalledProcessError as exc_plain:
                plain_err = exc_plain.stderr.strip() or str(exc_plain)
                return [], f"ollama list failed: {plain_err}"
            except subprocess.TimeoutExpired:
                return [], "Timed out talking to Ollama CLI."
            models = _parse_plain_table(stdout)
            if not models:
                return [], "ollama list returned no parsable entries."
            return models, None
        return [], f"ollama list failed: {err}"


def generate_with_ollama(
    model_name: str,
    prompt: str,
    params: Dict[str, Any] | None = None,
    host: str = "http://127.0.0.1:11434",
) -> tuple[str, dict[str, Any]]:
    """
    Call the local Ollama HTTP API for generation.
    Returns (response_text, raw_payload).
    """
    url = f"{host.rstrip('/')}/api/generate"
    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
    }
    if params:
        payload["options"] = {k: v for k, v in params.items() if v is not None}

    try:
        resp = requests.post(url, json=payload, timeout=60)
    except requests.RequestException as exc:
        raise RuntimeError(f"Failed to contact Ollama API: {exc}") from exc

    if resp.status_code != 200:
        raise RuntimeError(f"Ollama API error: {resp.text}")
    data = resp.json()
    return data.get("response", ""), data


def find_model(model_name: str) -> tuple[dict[str, Any] | None, str | None]:
    """
    Helper that searches local Ollama models by name.
    """
    models, error = list_local_models()
    if error:
        return None, error
    match = next(
        (
            m
            for m in models
            if m.get("name") == model_name or m.get("raw", {}).get("model") == model_name
        ),
        None,
    )
    if match:
        return match, None
    return None, "Model not found in local Ollama cache."
