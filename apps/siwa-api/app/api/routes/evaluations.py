"""Evaluation-focused API endpoints."""

from __future__ import annotations

import csv
import json
import threading
from contextlib import nullcontext
from datetime import datetime
from io import StringIO
from statistics import mean
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sklearn.preprocessing import MultiLabelBinarizer
import evaluate

from app.api.deps import require_eval_access
from app.models.user import User
from app.schemas.evaluation import EvaluationRunDetail, EvaluationRunSummary, TaskSummary
from app.services.evaluations import delete_run, get_run, list_runs, save_run
from app.services.task_queue import TaskInfo, task_queue
from app.services.hardware import detect_available_devices

router = APIRouter(prefix="/evaluations", tags=["evaluations"])

TEXT_EVALUATION_METRICS = ["bertscore", "bleu", "rouge", "meteor"]
_TEXT_METRIC_CACHE: Dict[str, evaluate.Metric] = {}
BERTSCORE_LOCK = threading.Lock()


def _normalize_label(value: str | None) -> Any:
    """Trim whitespace and try to preserve numeric values when possible."""

    normalized = (value or "").strip()
    if normalized == "":
        return "<missing>"
    try:
        return int(normalized)
    except ValueError:
        pass
    try:
        return float(normalized)
    except ValueError:
        return normalized


def _load_columns(
    raw_content: str,
    truth_column: str,
    prediction_column: str,
) -> Tuple[List[Any], List[Any], List[str]]:
    """Load classification columns and return normalized values plus headers."""
    reader = csv.DictReader(StringIO(raw_content))
    raw_fieldnames = [name for name in (reader.fieldnames or []) if name]
    if not raw_fieldnames:
        raise HTTPException(status_code=400, detail="CSV must include a header row.")

    header_map: Dict[str, str] = {name.strip(): name for name in raw_fieldnames}
    if truth_column not in header_map or prediction_column not in header_map:
        raise HTTPException(
            status_code=400,
            detail="Selected columns could not be found in the uploaded CSV.",
        )

    truth_key = header_map[truth_column]
    prediction_key = header_map[prediction_column]

    truth_values: List[Any] = []
    prediction_values: List[Any] = []
    for row in reader:
        truth_values.append(_normalize_label(row.get(truth_key)))
        prediction_values.append(_normalize_label(row.get(prediction_key)))

    if not truth_values:
        raise HTTPException(status_code=400, detail="CSV must contain at least one row.")

    return truth_values, prediction_values, raw_fieldnames


def _build_confusion_matrix(labels: List[Any], truth: List[Any], prediction: List[Any]) -> Dict[str, Dict[str, int]]:
    matrix = confusion_matrix(truth, prediction, labels=labels)
    matrix_dict: Dict[str, Dict[str, int]] = {}
    for i, truth_label in enumerate(labels):
        row: Dict[str, int] = {}
        for j, predicted_label in enumerate(labels):
            row[str(predicted_label)] = int(matrix[i][j])
        matrix_dict[str(truth_label)] = row
    return matrix_dict


def _build_classification_report(
    report: Dict[str, Any], total_samples: int
) -> Dict[str, Dict[str, Any]]:
    normalized: Dict[str, Dict[str, Any]] = {}
    for label, values in report.items():
        if isinstance(values, dict):
            normalized[label] = {
                "precision": float(values.get("precision", 0.0)),
                "recall": float(values.get("recall", 0.0)),
                "f1_score": float(values.get("f1-score", 0.0)),
                "support": int(values.get("support", 0)),
            }
        else:
            normalized[label] = {
                "precision": float(values),
                "recall": float(values),
                "f1_score": float(values),
                "support": total_samples,
            }
    return normalized


def _build_label_sets(values: List[Any], multi_label: bool) -> List[Set[str]]:
    """Convert raw label records into sets of strings for per-label accounting."""

    sets: List[Set[str]] = []
    for value in values:
        if multi_label and isinstance(value, list):
            cleaned = {str(item).strip() for item in value if str(item).strip()}
            sets.append(cleaned)
        else:
            sets.append({str(value)})
    return sets


def _build_multilabel_confusion_matrix(
    labels: List[str], truth_sets: List[Set[str]], pred_sets: List[Set[str]]
) -> Dict[str, Dict[str, int]]:
    """Count how often each truth label co-occurs with each predicted label."""

    matrix: Dict[str, Dict[str, int]] = {
        label: {pred_label: 0 for pred_label in labels} for label in labels
    }
    for truth_set, pred_set in zip(truth_sets, pred_sets):
        for truth_label in truth_set:
            row = matrix.get(truth_label)
            if row is None:
                continue
            for pred_label in pred_set:
                if pred_label in row:
                    row[pred_label] += 1
    return matrix


def _build_per_label_confusion(
    labels: List[str], truth_sets: List[Set[str]], pred_sets: List[Set[str]]
) -> Dict[str, Dict[str, int]]:
    """Produce tp/fp/fn/tn counts for each label. Works for single or multi-label sets."""

    confusion: Dict[str, Dict[str, int]] = {
        label: {"tp": 0, "fp": 0, "fn": 0, "tn": 0} for label in labels
    }
    for truth_set, pred_set in zip(truth_sets, pred_sets):
        for label in labels:
            truth_has = label in truth_set
            pred_has = label in pred_set
            if truth_has and pred_has:
                confusion[label]["tp"] += 1
            elif truth_has and not pred_has:
                confusion[label]["fn"] += 1
            elif not truth_has and pred_has:
                confusion[label]["fp"] += 1
            else:
                confusion[label]["tn"] += 1
    return confusion


@router.post("/classification", response_model=TaskSummary)
async def run_classification_evaluation(
    dataset_name: str = Form("Unnamed evaluation"),
    truth_column: str = Form(...),
    prediction_column: str = Form(...),
    index_column: str | None = Form(None),
    mode: str = Form("single-label"),
    source_path: str | None = Form(None),
    description: str | None = Form(None),
    file: UploadFile = File(...),
    user: User = Depends(require_eval_access),
) -> Dict[str, Any]:
    content = (await file.read()).decode("utf-8-sig")
    truth_values, prediction_values, headers = _load_columns(
        content, truth_column, prediction_column
    )

    if index_column and index_column not in headers:
        raise HTTPException(status_code=400, detail="Index column not found in CSV.")

    def work(task: TaskInfo):
        run_payload = _build_classification_run_payload(
            run_id=str(uuid4()),
            dataset_name=dataset_name,
            truth_column=truth_column,
            prediction_column=prediction_column,
            index_column=index_column,
            mode=mode,
            source_path=source_path,
            description=description,
            file_name=file.filename,
            truth_values=truth_values,
            prediction_values=prediction_values,
        )
        run_payload["indexColumn"] = index_column
        return run_payload

    task = task_queue.submit("classification", dataset_name, work)
    return task.to_dict()


def _load_text_columns(
    raw_content: str,
    truth_column: str,
    prediction_column: str,
    index_column: str | None = None,
) -> Tuple[List[str], List[str], List[str], List[str]]:
    """Load text columns, optionally capturing an index column."""
    reader = csv.DictReader(StringIO(raw_content))
    raw_fieldnames = [name for name in (reader.fieldnames or []) if name]
    if not raw_fieldnames:
        raise HTTPException(status_code=400, detail="CSV must include a header row.")

    header_map: Dict[str, str] = {name.strip(): name for name in raw_fieldnames}
    if truth_column not in header_map or prediction_column not in header_map:
        raise HTTPException(
            status_code=400,
            detail="Selected columns could not be found in the uploaded CSV.",
        )

    truth_key = header_map[truth_column]
    prediction_key = header_map[prediction_column]
    index_key: Optional[str] = None
    if index_column:
        if index_column not in header_map:
            raise HTTPException(status_code=400, detail="Index column not found in CSV.")
        index_key = header_map[index_column]

    truth_values: List[str] = []
    prediction_values: List[str] = []
    index_values: List[str] = []
    for row in reader:
        truth_values.append((row.get(truth_key) or "").strip())
        prediction_values.append((row.get(prediction_key) or "").strip())
        if index_key:
            index_values.append((row.get(index_key) or "").strip())

    if not truth_values:
        raise HTTPException(status_code=400, detail="CSV must contain at least one row.")

    return truth_values, prediction_values, index_values, raw_fieldnames


def _get_text_metric(metric_name: str) -> evaluate.Metric:
    metric = _TEXT_METRIC_CACHE.get(metric_name)
    if metric is None:
        metric = evaluate.load(metric_name)
        _TEXT_METRIC_CACHE[metric_name] = metric
    return metric


def _split_whitespace_tokenizer(text: str) -> List[str]:
    return [token for token in text.split() if token]


def _serialize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _serialize_value(val) for key, val in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize_value(item) for item in value]
    if hasattr(value, "tolist") and callable(value.tolist):
        try:
            return _serialize_value(value.tolist())
        except Exception:
            pass
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _normalize_hashcode(value: Any) -> str | None:
    """
    Ensure hashcodes returned by evaluate (which can be strings, character lists,
    or other sequences) are normalized to a single string.
    """
    if value is None:
        return None
    if isinstance(value, list):
        if not value:
            return None
        if all(isinstance(item, str) and len(item) == 1 for item in value):
            return "".join(value)
        return str(value[0])
    return str(value)


def _ensure_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed if trimmed else None
    return str(value)


def _ensure_int(value: Any, name: str) -> Optional[int]:
    if value in (None, ""):
        return None
    if isinstance(value, int):
        return value
    try:
        return int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid value for {name}.")


def _ensure_float(value: Any, name: str) -> Optional[float]:
    if value in (None, ""):
        return None
    if isinstance(value, float):
        return value
    try:
        return float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid value for {name}.")


def _ensure_bool(value: Any, name: str) -> Optional[bool]:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1", "yes"):
            return True
        if lowered in ("false", "0", "no"):
            return False
    raise HTTPException(status_code=400, detail=f"Invalid boolean value for {name}.")


def _ensure_list_of_str(value: Any, name: str) -> Optional[List[str]]:
    if value in (None, ""):
        return None
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        tokens = [token.strip() for token in value.split(",") if token.strip()]
        return tokens or None
    raise HTTPException(status_code=400, detail=f"{name} must be a list of strings.")


def _parse_metrics_selection(raw: str | None) -> List[str]:
    if not raw:
        return TEXT_EVALUATION_METRICS.copy()

    parsed: List[str] = []
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError:
        decoded = raw

    if isinstance(decoded, str):
        parsed = [token.strip().lower() for token in decoded.split(",") if token.strip()]
    elif isinstance(decoded, list):
        parsed = [str(token).strip().lower() for token in decoded if str(token).strip()]
    else:
        raise HTTPException(
            status_code=400,
            detail="Invalid metrics payload. Expect a JSON array of metric names or a comma-separated string.",
        )

    selected: List[str] = []
    seen: Set[str] = set()
    for metric in parsed:
        if metric == "all":
            for default_metric in TEXT_EVALUATION_METRICS:
                if default_metric not in seen:
                    seen.add(default_metric)
                    selected.append(default_metric)
            continue
        if metric not in TEXT_EVALUATION_METRICS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported metric '{metric}'. Valid text metrics: {', '.join(TEXT_EVALUATION_METRICS)}.",
            )
        if metric not in seen:
            seen.add(metric)
            selected.append(metric)

    if not selected:
        raise HTTPException(status_code=400, detail="At least one text metric must be selected.")

    return selected


def _parse_metric_parameters(raw: str | None) -> Dict[str, Dict[str, Any]]:
    if not raw:
        return {}
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400,
            detail="metric_parameters must be a valid JSON object.",
        )
    if not isinstance(decoded, dict):
        raise HTTPException(
            status_code=400,
            detail="metric_parameters must be a JSON object mapping metric names to parameter objects.",
        )

    sanitized: Dict[str, Dict[str, Any]] = {}
    for key, value in decoded.items():
        if key not in TEXT_EVALUATION_METRICS:
            continue
        if isinstance(value, dict):
            sanitized[key] = value
    return sanitized


def _resolve_tokenizer(name: str | None) -> Callable[[str], List[str]] | None:
    normalized = (name or "").strip().lower()
    if normalized in ("whitespace", "space", "simple"):
        return _split_whitespace_tokenizer
    return None


def _prepare_bertscore_params(raw_params: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    call_kwargs: Dict[str, Any] = {}
    record: Dict[str, Any] = {}

    lang = _ensure_str(raw_params.get("lang")) or "en"
    call_kwargs["lang"] = lang
    record["lang"] = lang

    model_type = _ensure_str(raw_params.get("model_type"))
    if model_type:
        call_kwargs["model_type"] = model_type
        record["model_type"] = model_type

    num_layers = _ensure_int(raw_params.get("num_layers"), "num_layers")
    if num_layers is not None:
        call_kwargs["num_layers"] = num_layers
        record["num_layers"] = num_layers

    batch_size = _ensure_int(raw_params.get("batch_size"), "batch_size")
    if batch_size is not None:
        call_kwargs["batch_size"] = batch_size
        record["batch_size"] = batch_size

    nthreads = _ensure_int(raw_params.get("nthreads"), "nthreads")
    if nthreads is not None:
        call_kwargs["nthreads"] = nthreads
        record["nthreads"] = nthreads

    for bool_key in ("verbose", "idf", "all_layers", "rescale_with_baseline", "use_fast_tokenizer"):
        bool_value = _ensure_bool(raw_params.get(bool_key), bool_key)
        if bool_value is not None:
            call_kwargs[bool_key] = bool_value
            record[bool_key] = bool_value

    device = _ensure_str(raw_params.get("device"))
    if device:
        call_kwargs["device"] = device
        record["device"] = device

    baseline_path = _ensure_str(raw_params.get("baseline_path"))
    if baseline_path:
        call_kwargs["baseline_path"] = baseline_path
        record["baseline_path"] = baseline_path

    run_per_row = _ensure_bool(raw_params.get("run_per_row"), "run_per_row")
    if run_per_row is not None:
        record["run_per_row"] = run_per_row

    return call_kwargs, record


def _prepare_bleu_params(raw_params: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    call_kwargs: Dict[str, Any] = {}
    record: Dict[str, Any] = {}

    tokenizer_name = _ensure_str(raw_params.get("tokenizer")) or "default"
    tokenizer = _resolve_tokenizer(tokenizer_name)
    if tokenizer is not None:
        call_kwargs["tokenizer"] = tokenizer
    record["tokenizer"] = tokenizer_name

    max_order = _ensure_int(raw_params.get("max_order"), "max_order")
    if max_order is not None:
        call_kwargs["max_order"] = max_order
        record["max_order"] = max_order

    smooth = _ensure_bool(raw_params.get("smooth"), "smooth")
    if smooth is not None:
        call_kwargs["smooth"] = smooth
        record["smooth"] = smooth

    return call_kwargs, record


def _prepare_rouge_params(raw_params: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    call_kwargs: Dict[str, Any] = {}
    record: Dict[str, Any] = {}

    rouge_types = _ensure_list_of_str(raw_params.get("rouge_types"), "rouge_types")
    if rouge_types:
        call_kwargs["rouge_types"] = rouge_types
        record["rouge_types"] = rouge_types

    use_aggregator = _ensure_bool(raw_params.get("use_aggregator"), "use_aggregator")
    if use_aggregator is not None:
        call_kwargs["use_aggregator"] = use_aggregator
        record["use_aggregator"] = use_aggregator

    use_stemmer = _ensure_bool(raw_params.get("use_stemmer"), "use_stemmer")
    if use_stemmer is not None:
        call_kwargs["use_stemmer"] = use_stemmer
        record["use_stemmer"] = use_stemmer

    tokenizer_name = _ensure_str(raw_params.get("tokenizer")) or "default"
    tokenizer = _resolve_tokenizer(tokenizer_name)
    if tokenizer is not None:
        call_kwargs["tokenizer"] = tokenizer
    record["tokenizer"] = tokenizer_name

    return call_kwargs, record


def _prepare_meteor_params(raw_params: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    call_kwargs: Dict[str, Any] = {}
    record: Dict[str, Any] = {}

    for key in ("alpha", "beta", "gamma"):
        value = _ensure_float(raw_params.get(key), key)
        if value is not None:
            call_kwargs[key] = value
            record[key] = value

    return call_kwargs, record


def _collect_numeric_values(value: Any) -> List[float]:
    if isinstance(value, (int, float)):
        return [float(value)]
    if isinstance(value, (list, tuple)):
        numbers: List[float] = []
        for item in value:
            numbers.extend(_collect_numeric_values(item))
        return numbers
    if isinstance(value, dict):
        numbers: List[float] = []
        for nested in value.values():
            numbers.extend(_collect_numeric_values(nested))
        return numbers
    return []


def _numeric_mean(value: Any) -> float:
    numbers = _collect_numeric_values(value)
    if numbers:
        return mean(numbers)
    return 0.0

def _flatten_score_values(
    collectors: Dict[str, List[float]],
    value: Any,
    prefix: str = "",
) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            next_prefix = f"{prefix}_{key}" if prefix else key
            _flatten_score_values(collectors, nested, next_prefix)
    elif isinstance(value, (int, float)):
        key = prefix or "value"
        collectors.setdefault(key, []).append(float(value))
    elif isinstance(value, (list, tuple)):
        for item in value:
            _flatten_score_values(collectors, item, prefix)


def _aggregate_from_score_list(scores: List[Dict[str, Any]]) -> Dict[str, float]:
    collectors: Dict[str, List[float]] = {}
    for entry in scores:
        _flatten_score_values(collectors, entry)
    return {key: mean(values) for key, values in collectors.items() if values}


def _compute_rouge_aggregates(score: Dict[str, Any]) -> Dict[str, float]:
    if not isinstance(score, dict):
        return {}
    raw_scores = score.get("scores")
    if isinstance(raw_scores, list):
        aggregates = _aggregate_from_score_list(raw_scores)
        if aggregates:
            return aggregates
    return {
        key: _numeric_mean(value)
        for key, value in score.items()
        if key != "scores"
    }


def _build_classification_run_payload(
    run_id: str,
    dataset_name: str,
    truth_column: str,
    prediction_column: str,
    index_column: str | None,
    mode: str,
    source_path: str | None,
    description: str | None,
    file_name: str,
    truth_values: List[Any],
    prediction_values: List[Any],
) -> Dict[str, Any]:
    truth_sets: List[Set[str]]
    pred_sets: List[Set[str]]
    label_names: List[str]

    if mode == "multi-label":
        truth_lists = [
            [t.strip() for t in str(val).split(",") if t.strip()]
            for val in truth_values
        ]
        pred_lists = [
            [p.strip() for p in str(val).split(",") if p.strip()]
            for val in prediction_values
        ]

        truth_sets = _build_label_sets(truth_lists, multi_label=True)
        pred_sets = _build_label_sets(pred_lists, multi_label=True)

        mlb = MultiLabelBinarizer()
        mlb.fit(truth_lists + pred_lists)
        report_labels = sorted(list(mlb.classes_), key=lambda value: str(value))
        label_names = [str(label) for label in report_labels]

        y_true = mlb.transform(truth_lists)
        y_pred = mlb.transform(pred_lists)

        result_matrix = _build_multilabel_confusion_matrix(label_names, truth_sets, pred_sets)
        raw_report = classification_report(
            y_true,
            y_pred,
            target_names=label_names,
            zero_division=0,
            output_dict=True,
        )
        accuracy = float(accuracy_score(y_true, y_pred))

    else:
        truth_sets = _build_label_sets(truth_values, multi_label=False)
        pred_sets = _build_label_sets(prediction_values, multi_label=False)

        report_labels = sorted(
            list({*truth_values, *prediction_values}), key=lambda value: str(value)
        )
        label_names = [str(label) for label in report_labels]

        y_true = truth_values
        y_pred = prediction_values

        result_matrix = _build_confusion_matrix(report_labels, y_true, y_pred)
        raw_report = classification_report(
            y_true,
            y_pred,
            labels=report_labels,
            zero_division=0,
            output_dict=True,
        )
        accuracy = float(accuracy_score(y_true, y_pred))

    per_label_confusion = _build_per_label_confusion(label_names, truth_sets, pred_sets)
    total = len(truth_values)
    report = _build_classification_report(raw_report, total)

    _, _, macro_f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="macro", zero_division=0
    )
    _, _, micro_f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="micro", zero_division=0
    )

    timestamp = datetime.utcnow().isoformat()
    result_matrix_payload: Dict[str, Any] = {
        "labels": label_names,
        "confusionMatrix": result_matrix,
        "classificationReport": report,
        "accuracy": accuracy,
        "macroF1": float(macro_f1),
        "microF1": float(micro_f1),
        "total": total,
        "perLabelConfusion": per_label_confusion,
    }

    payload = {
        "id": run_id,
        "dataset": dataset_name,
        "metric": "Multi-label classification" if mode == "multi-label" else "Single-label classification",
        "status": "completed",
        "evaluationType": "classification",
        "summaryLabel": "Accuracy",
        "summaryValue": accuracy,
        "accuracy": accuracy,
        "createdAt": timestamp,
        "completedAt": timestamp,
        "truthColumn": truth_column,
        "predictionColumn": prediction_column,
        "indexColumn": index_column,
        "sourcePath": source_path,
        "description": description,
        "fileName": file_name,
        "mode": mode,
        "results": result_matrix_payload,
    }

    return payload


def _run_text_metrics(
    predictions: List[str],
    references: List[str],
    metrics: List[str],
    metric_parameters: Dict[str, Dict[str, Any]],
    progress_callback: Callable[[str, int, int], None] | None = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    results: Dict[str, Any] = {}
    record_parameters: Dict[str, Dict[str, Any]] = {}
    total_rows = len(predictions)

    for metric in metrics:
        sanitized = metric_parameters.get(metric, {})
        if metric == "bertscore":
            kwargs, record = _prepare_bertscore_params(sanitized)
        elif metric == "bleu":
            kwargs, record = _prepare_bleu_params(sanitized)
        elif metric == "rouge":
            kwargs, record = _prepare_rouge_params(sanitized)
        elif metric == "meteor":
            kwargs, record = _prepare_meteor_params(sanitized)
        else:
            continue

        record_parameters[metric] = record
        metric_obj = _get_text_metric(metric)
        use_per_row = metric == "bertscore" and bool(record.get("run_per_row"))
        lock_context = BERTSCORE_LOCK if metric == "bertscore" else nullcontext()
        if progress_callback:
            progress_callback(metric, 0, total_rows)

        try:
            with lock_context:
                if use_per_row:
                    precision_values: List[float] = []
                    recall_values: List[float] = []
                    f1_values: List[float] = []
                    hashcodes: List[str] = []
                    for prediction, reference in zip(predictions, references):
                        row_score = metric_obj.compute(
                            predictions=[prediction],
                            references=[reference],
                            **kwargs,
                        )
                        precision_list = row_score.get("precision", [])
                        recall_list = row_score.get("recall", [])
                        f1_list = row_score.get("f1", [])
                        hashcode_value = _normalize_hashcode(row_score.get("hashcode"))
                        precision = float(precision_list[0]) if precision_list else 0.0
                        recall = float(recall_list[0]) if recall_list else 0.0
                        f1 = float(f1_list[0]) if f1_list else 0.0
                        precision_values.append(precision)
                        recall_values.append(recall)
                        f1_values.append(f1)
                        if hashcode_value:
                            hashcodes.append(hashcode_value)
                        if progress_callback:
                            progress_callback(metric, len(precision_values), total_rows)
                    score = {
                        "precision": precision_values,
                        "recall": recall_values,
                        "f1": f1_values,
                    }
                    if hashcodes:
                        score["hashcode"] = hashcodes
                else:
                    score = metric_obj.compute(
                        predictions=predictions, references=references, **kwargs
                    )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Text metric '{metric}' failed: {exc}",
            )

        serialized = _serialize_value(score)
        
        # Special handling for hashcode to prevent it from being split into characters
        # BERTScore returns hashcode as a string, but serialization can split it
        if metric == "bertscore" and "hashcode" in serialized:
            hashcode_val = serialized["hashcode"]
            # If it's a list of single characters, join them back into a string
            if isinstance(hashcode_val, list) and all(isinstance(c, str) and len(c) == 1 for c in hashcode_val):
                serialized["hashcode"] = "".join(hashcode_val)
            # If it's any other list, take the first element and convert to string
            elif isinstance(hashcode_val, list) and len(hashcode_val) > 0:
                serialized["hashcode"] = str(hashcode_val[0])
        
        metric_result: Dict[str, Any] = {"score": serialized, "parameters": record}

        if metric == "bertscore":
            aggregates = {
                "precision": mean(score["precision"]) if isinstance(score.get("precision"), list) and score.get("precision") else 0.0,
                "recall": mean(score["recall"]) if isinstance(score.get("recall"), list) and score.get("recall") else 0.0,
                "f1": mean(score["f1"]) if isinstance(score.get("f1"), list) and score.get("f1") else 0.0,
            }
            first_hash = _normalize_hashcode(score.get("hashcode"))
            if first_hash is not None:
                aggregates["hashcode"] = first_hash
            
            metric_result["aggregates"] = aggregates
            if progress_callback:
                progress_callback(metric, total_rows, total_rows)
        elif metric == "bleu":
            metric_result["aggregates"] = {"bleu": _numeric_mean(score.get("bleu"))}
            if progress_callback:
                progress_callback(metric, total_rows, total_rows)
        elif metric == "rouge":
            metric_result["aggregates"] = _compute_rouge_aggregates(score)
            if progress_callback:
                progress_callback(metric, total_rows, total_rows)
        elif metric == "meteor":
            metric_result["aggregates"] = {"meteor": _numeric_mean(score.get("meteor"))}
            if progress_callback:
                progress_callback(metric, total_rows, total_rows)

        results[metric] = metric_result

    return results, record_parameters



def _summarize_text_metrics(metrics: Dict[str, Any], selected_metrics: List[str]) -> Tuple[str, float]:
    highlight_label = "Text score"
    highlight_value = 0.0

    for metric in selected_metrics:
        entry = metrics.get(metric)
        if not entry:
            continue
        aggregates = entry.get("aggregates", {})
        if metric == "bertscore":
            highlight_label = "BERTScore F1"
            highlight_value = float(aggregates.get("f1", 0.0))
            break
        if metric == "bleu":
            highlight_label = "BLEU"
            highlight_value = float(aggregates.get("bleu", 0.0))
            break
        if metric == "rouge":
            rouge_keys = [key for key in aggregates.keys() if key.startswith("rouge")]
            primary = rouge_keys[0] if rouge_keys else None
            highlight_label = primary or "ROUGE"
            highlight_value = float(aggregates.get(primary, 0.0)) if primary else 0.0
            break
        if metric == "meteor":
            highlight_label = "METEOR"
            highlight_value = float(aggregates.get("meteor", 0.0))
            break

    return highlight_label, highlight_value


def _build_text_run_payload(
    run_id: str,
    dataset_name: str,
    truth_column: str,
    prediction_column: str,
    index_column: str | None,
    metrics: List[str],
    metric_parameters: Dict[str, Dict[str, Any]],
    source_path: str | None,
    description: str | None,
    file_name: str,
    predictions: List[str],
    references: List[str],
    index_values: List[str],
    progress_callback: Callable[[str, int, int], None] | None = None,
) -> Dict[str, Any]:
    metric_results, recorded_params = _run_text_metrics(
        predictions, references, metrics, metric_parameters, progress_callback
    )

    summary_label, summary_value = _summarize_text_metrics(metric_results, metrics)
    timestamp = datetime.utcnow().isoformat()
    return {
        "id": run_id,
        "dataset": dataset_name,
        "metric": "Text generation metrics",
        "status": "completed",
        "accuracy": summary_value,
        "summaryLabel": summary_label,
        "summaryValue": summary_value,
        "selectedMetrics": metrics,
        "metricParameters": recorded_params,
        "evaluationType": "text",
        "createdAt": timestamp,
        "completedAt": timestamp,
        "truthColumn": truth_column,
        "predictionColumn": prediction_column,
        "indexColumn": index_column,
        "sourcePath": source_path,
        "description": description,
        "fileName": file_name,
        "results": {
            "total": len(references),
            "metrics": metric_results,
            "indexValues": index_values,
        },
    }


@router.post("/text", response_model=TaskSummary)
async def run_text_evaluation(
    dataset_name: str = Form("Unnamed evaluation"),
    truth_column: str = Form(...),
    prediction_column: str = Form(...),
    index_column: str | None = Form(None),
    metrics: str | None = Form(None),
    metric_parameters: str | None = Form(None),
    source_path: str | None = Form(None),
    description: str | None = Form(None),
    file: UploadFile = File(...),
    user: User = Depends(require_eval_access),
) -> Dict[str, Any]:
    content = (await file.read()).decode("utf-8-sig")
    truth_values, prediction_values, index_values, headers = _load_text_columns(
        content, truth_column, prediction_column, index_column
    )

    if index_column and index_column not in headers:
        raise HTTPException(status_code=400, detail="Index column not found in CSV.")

    selected_metrics = _parse_metrics_selection(metrics)
    parsed_parameters = _parse_metric_parameters(metric_parameters)

    sanitized_truth = [value for value in truth_values]
    sanitized_predictions = [value for value in prediction_values]

    def work(task: TaskInfo):
        return _build_text_run_payload(
            run_id=str(uuid4()),
            dataset_name=dataset_name,
            truth_column=truth_column,
            prediction_column=prediction_column,
            index_column=index_column,
            metrics=selected_metrics,
            metric_parameters=parsed_parameters,
            source_path=source_path,
            description=description,
            file_name=file.filename,
            predictions=sanitized_predictions,
            references=sanitized_truth,
            index_values=index_values,
            progress_callback=task.update_progress,
        )

    task = task_queue.submit("text", dataset_name, work)
    return task.to_dict()


@router.get("/runs", response_model=List[EvaluationRunSummary])
def list_evaluations(user: User = Depends(require_eval_access)) -> List[Dict[str, Any]]:
    return list_runs()


@router.get("/runs/{run_id}", response_model=EvaluationRunDetail)
def get_evaluation(run_id: str, user: User = Depends(require_eval_access)) -> Dict[str, Any]:
    try:
        return get_run(run_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Evaluation run not found.")


@router.delete("/runs/{run_id}")
def delete_evaluation(run_id: str, user: User = Depends(require_eval_access)) -> Dict[str, str]:
    try:
        delete_run(run_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Evaluation run not found.")
    return {"detail": "deleted"}


@router.get("/hardware")
def get_hardware_info(user: User = Depends(require_eval_access)) -> Dict[str, Any]:
    """
    Get information about available compute devices (CUDA, MPS, CPU).
    
    Returns device availability and recommendations for BERTScore evaluation.
    """
    return detect_available_devices()


@router.get("/tasks", response_model=List[TaskSummary])
def list_tasks(user: User = Depends(require_eval_access)) -> List[Dict[str, Any]]:
    return task_queue.list()


@router.get("/tasks/{task_id}", response_model=TaskSummary)
def get_task(task_id: str, user: User = Depends(require_eval_access)) -> TaskSummary:
    task = task_queue.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    return task
