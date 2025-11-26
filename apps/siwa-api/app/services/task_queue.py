from __future__ import annotations

from datetime import datetime
from enum import Enum
import threading
from queue import Queue
from threading import Thread
from typing import Any, Callable, Dict, List, Optional
from uuid import uuid4

from app.services.evaluations import save_run


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class TaskInfo:
    def __init__(self, *, task_id: str, task_type: str, dataset: str):
        now = datetime.utcnow().isoformat()
        self.task_id = task_id
        self.task_type = task_type
        self.dataset = dataset
        self.status: TaskStatus = TaskStatus.PENDING
        self.created_at = now
        self.started_at: Optional[str] = None
        self.completed_at: Optional[str] = None
        self.error: Optional[str] = None
        self.run_id: Optional[str] = None
        self.current_metric: Optional[str] = None
        self.processed_rows: int = 0
        self.total_rows: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "taskId": self.task_id,
            "taskType": self.task_type,
            "dataset": self.dataset,
            "status": self.status,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
            "error": self.error,
            "runId": self.run_id,
            "currentMetric": self.current_metric,
            "processedRows": self.processed_rows,
            "totalRows": self.total_rows,
        }

    def update_progress(
        self,
        metric: str | None,
        processed_rows: int | None,
        total_rows: int | None,
    ) -> None:
        if metric is not None:
            self.current_metric = metric
        if processed_rows is not None:
            self.processed_rows = processed_rows
        if total_rows is not None:
            self.total_rows = total_rows


class TaskQueue:
    def __init__(self):
        self._tasks: Dict[str, TaskInfo] = {}
        self._lock = threading.Lock()

    def submit(
        self,
        task_type: str,
        dataset: str,
        work: Callable[[TaskInfo], Dict[str, Any]],
    ) -> TaskInfo:
        task_id = str(uuid4())
        task = TaskInfo(task_id=task_id, task_type=task_type, dataset=dataset)
        with self._lock:
            self._tasks[task_id] = task

        thread = Thread(target=self._run, args=(task, work))
        thread.daemon = True
        thread.start()
        return task

    def _run(self, task: TaskInfo, work: Callable[[TaskInfo], Dict[str, Any]]) -> None:
        task.status = TaskStatus.RUNNING
        task.started_at = datetime.utcnow().isoformat()
        try:
            run_payload = work(task)
            run_payload["taskId"] = task.task_id
            save_run(run_payload)
            task.run_id = run_payload.get("id")
            task.status = TaskStatus.COMPLETED
        except Exception as exc:  # noqa: BLE001
            task.error = str(exc)
            task.status = TaskStatus.FAILED
        finally:
            task.completed_at = datetime.utcnow().isoformat()

    def list(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [task.to_dict() for task in self._tasks.values()]

    def get(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            return task.to_dict()


task_queue = TaskQueue()
