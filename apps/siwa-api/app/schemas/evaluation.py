from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ClassificationReportRow(BaseModel):
    precision: float
    recall: float
    f1_score: float
    support: int


class LabelConfusionRow(BaseModel):
    tp: int
    fp: int
    fn: int
    tn: int

class EvaluationRunSummary(BaseModel):
    id: str
    dataset: str
    metric: str
    status: str
    accuracy: float
    evaluationType: str = "classification"
    summaryLabel: Optional[str] = None
    summaryValue: Optional[float] = None
    selectedMetrics: Optional[List[str]] = None
    metricParameters: Optional[Dict[str, Dict[str, Any]]] = None
    createdAt: datetime
    completedAt: Optional[datetime]
    truthColumn: str
    predictionColumn: str
    indexColumn: Optional[str] = None
    sourcePath: Optional[str] = None
    description: Optional[str] = None
    fileName: Optional[str] = None
    mode: Optional[str] = "single-label"
    taskId: Optional[str] = None


class EvaluationRunDetail(EvaluationRunSummary):
    results: Dict[str, Any]


class TaskSummary(BaseModel):
    taskId: str
    taskType: str
    dataset: str
    status: str
    createdAt: datetime
    startedAt: Optional[datetime]
    completedAt: Optional[datetime]
    error: Optional[str] = None
    runId: Optional[str] = None
    currentMetric: Optional[str] = None
    processedRows: Optional[int] = None
    totalRows: Optional[int] = None
