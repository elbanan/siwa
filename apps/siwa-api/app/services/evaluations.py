"""
Simple local store for evaluation runs.

Each run is persisted as a JSON file under `SIWA_HOME/runs` so the UI can
display summaries and drill down into completed evaluations.
"""

import json
from pathlib import Path
from typing import Any, Dict, List

from app.core.config import settings

RUNS_DIR = Path(settings.SIWA_HOME) / "runs"


def ensure_runs_dir() -> None:
    """Create the runs directory if it is missing."""
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


def save_run(run_payload: Dict[str, Any]) -> None:
    """Persist a run as JSON using the run ID as file name."""
    ensure_runs_dir()
    run_file = RUNS_DIR / f"{run_payload['id']}.json"
    with run_file.open("w", encoding="utf-8") as handle:
        json.dump(run_payload, handle, ensure_ascii=False, indent=2)


def list_runs() -> List[Dict[str, Any]]:
    """Return all runs sorted by creation timestamp (newest first)."""
    ensure_runs_dir()
    runs: List[Dict[str, Any]] = []
    for run_file in RUNS_DIR.glob("*.json"):
        try:
            with run_file.open("r", encoding="utf-8") as handle:
                runs.append(json.load(handle))
        except (json.JSONDecodeError, OSError):
            continue
    runs.sort(key=lambda r: r.get("createdAt", ""), reverse=True)
    return runs


def delete_run(run_id: str) -> None:
    """Remove a persisted run."""
    ensure_runs_dir()
    run_file = RUNS_DIR / f"{run_id}.json"
    if not run_file.exists():
        raise FileNotFoundError(f"Run {run_id} not found.")
    run_file.unlink()


def get_run(run_id: str) -> Dict[str, Any]:
    """Load a specific run or raise a FileNotFoundError if missing."""
    ensure_runs_dir()
    run_file = RUNS_DIR / f"{run_id}.json"
    if not run_file.exists():
        raise FileNotFoundError(f"Run {run_id} not found.")
    with run_file.open("r", encoding="utf-8") as handle:
        run_data = json.load(handle)
    
    # Fix hashcode if it's stored as character array (legacy issue)
    if run_data.get("evaluationType") == "text" and "results" in run_data:
        results = run_data["results"]
        if "metrics" in results:
            for metric_id, metric_data in results["metrics"].items():
                if metric_id == "bertscore":
                    # Fix hashcode in score section
                    if "score" in metric_data and "hashcode" in metric_data["score"]:
                        hashcode_val = metric_data["score"]["hashcode"]
                        if isinstance(hashcode_val, list) and all(
                            isinstance(c, str) and len(c) == 1 for c in hashcode_val
                        ):
                            metric_data["score"]["hashcode"] = "".join(hashcode_val)
                        elif isinstance(hashcode_val, list) and len(hashcode_val) > 0:
                            metric_data["score"]["hashcode"] = str(hashcode_val[0])
                    
                    # Fix hashcode in aggregates section
                    if "aggregates" in metric_data and "hashcode" in metric_data["aggregates"]:
                        # Re-extract from the now-fixed score section
                        if "score" in metric_data and "hashcode" in metric_data["score"]:
                            metric_data["aggregates"]["hashcode"] = metric_data["score"]["hashcode"]
    
    return run_data
