"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type ClassificationReportRow = {
  precision: number;
  recall: number;
  f1_score: number;
  support: number;
};

type LabelConfusionRow = {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
};

type ClassificationEvaluationResult = {
  labels: string[];
  confusionMatrix: Record<string, Record<string, number>>;
  classificationReport: Record<string, ClassificationReportRow>;
  accuracy: number;
  macroF1: number;
  microF1: number;
  total: number;
  perLabelConfusion: Record<string, LabelConfusionRow>;
};

type TextMetricResult = {
  score: Record<string, unknown>;
  aggregates?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
};

type TextEvaluationResult = {
  total: number;
  metrics: Record<string, TextMetricResult>;
  indexValues?: string[];
};

type EvaluationRunDetail = {
  id: string;
  dataset: string;
  metric: string;
  status: string;
  accuracy: number;
  evaluationType?: "classification" | "text";
  summaryLabel?: string;
  summaryValue?: number;
  selectedMetrics?: string[];
  metricParameters?: Record<string, Record<string, unknown>>;
  createdAt: string;
  completedAt?: string | null;
  truthColumn: string;
  predictionColumn: string;
  indexColumn?: string | null;
  fileName?: string | null;
  sourcePath?: string | null;
  description?: string | null;
  mode?: string;
  taskId?: string;
  results: ClassificationEvaluationResult | TextEvaluationResult;
};

type TaskSummary = {
  taskId: string;
  taskType: string;
  dataset: string;
  status: string;
  error?: string | null;
  runId?: string | null;
  currentMetric?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  processedRows?: number | null;
  totalRows?: number | null;
};

const isAggregateKey = (key: string) =>
  key === "accuracy" || key.toLowerCase().includes("avg");

const ROW_PREVIEW_COUNT = 5;

type MetricRowSamples = {
  columns: string[];
  rows: Record<string, number | string>[];
  total: number;
};

const getMetricRowSamples = (
  entry: TextMetricResult,
  indexColumn?: string,
  indexValues?: string[]
): MetricRowSamples => {
  const score = entry.score;
  if (!score || typeof score !== "object") {
    return { columns: [], rows: [], total: 0 };
  }

  const numericEntries = Object.entries(score).filter(
    (_entry): _entry is [string, readonly unknown[]] =>
      Array.isArray(_entry[1]) && _entry[1].length > 0
  );
  if (numericEntries.length === 0) {
    return { columns: [], rows: [], total: 0 };
  }

  const total = Math.min(...numericEntries.map(([, values]) => values.length));
  if (total === 0) {
    return { columns: [], rows: [], total: 0 };
  }

  const rows = Array.from({ length: total }, (_, rowIndex) => {
    const row: Record<string, number | string> = {};
    if (indexColumn) {
      row[indexColumn] = indexValues?.[rowIndex] ?? "";
    }
    numericEntries.forEach(([key, values]) => {
      const value = values[rowIndex];
      const numericValue = typeof value === "number" ? value : Number(value ?? 0);
      row[key] = Number.isFinite(numericValue) ? numericValue : 0;
    });
    return row;
  });

  const columns = numericEntries.map(([key]) => key);
  if (indexColumn && indexValues && indexValues.length > 0) {
    columns.unshift(indexColumn);
  }

  return {
    columns,
    rows,
    total,
  };
};

export default function EvaluationRunPage() {
  const params = useParams();
  const runId = params?.runId;
  const [rowModal, setRowModal] = useState<{
    metricId: string;
    samples: MetricRowSamples;
  } | null>(null);
  const [run, setRun] = useState<EvaluationRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "heatmap">("table");
  const { status: sessionStatus, data: session } = useSession();
  const hasEvalAccess = Boolean(
    session &&
    (session.role === "owner" ||
      session.role === "admin" ||
      session.canAccessEval)
  );
  const fetchHeaders = useMemo(() => {
    if (!session?.accessToken) return undefined;
    return { Authorization: `Bearer ${session.accessToken}` };
  }, [session?.accessToken]);
  const [taskInfo, setTaskInfo] = useState<TaskSummary | null>(null);

  useEffect(() => {
    if (!runId || sessionStatus !== "authenticated" || !hasEvalAccess) return;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/evaluations/runs/${runId}`, {
      headers: fetchHeaders,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.detail ?? "Run not found.");
        }
        setRun(payload);
      })
      .catch((err) => {
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to load run.");
      })
      .finally(() => setLoading(false));
  }, [runId, sessionStatus, hasEvalAccess]);

  useEffect(() => {
    if (!run?.taskId || sessionStatus !== "authenticated" || !hasEvalAccess) {
      setTaskInfo(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/evaluations/tasks/${run.taskId}`, { headers: fetchHeaders })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 404) {
            return;
          }
          const payload = await response.json();
          throw new Error(payload?.detail ?? "Unable to load task.");
        }
        const payload = await response.json();
        if (!cancelled) {
          setTaskInfo(payload);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setTaskInfo(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [run?.taskId, sessionStatus, hasEvalAccess, fetchHeaders]);

  const isTextRun = run?.evaluationType === "text";
  const classificationResults =
    run && !isTextRun ? (run.results as ClassificationEvaluationResult) : null;
  const textResults = run && isTextRun ? (run.results as TextEvaluationResult) : null;

  const labelRows = useMemo(() => {
    if (!classificationResults) return [];
    return Object.entries(classificationResults.classificationReport)
      .filter(([label]) => !isAggregateKey(label))
      .map(([label, metrics]) => ({ label, metrics }));
  }, [classificationResults]);

  const aggregateRows = useMemo(() => {
    if (!classificationResults) return [];
    return Object.entries(classificationResults.classificationReport).filter(
      ([label]) => isAggregateKey(label)
    );
  }, [classificationResults]);

  const labelConfusionRows = useMemo(() => {
    if (!classificationResults) return [];
    return Object.entries(classificationResults.perLabelConfusion);
  }, [classificationResults]);

  const displayedTimestamp = run?.completedAt ?? run?.createdAt;

  const heatmapMax = useMemo(() => {
    if (!classificationResults) return 1;
    let highest = 0;
    classificationResults.labels.forEach((truth) => {
      classificationResults.labels.forEach((pred) => {
        const value = classificationResults.confusionMatrix[truth]?.[pred] ?? 0;
        highest = Math.max(highest, value);
      });
    });
    return highest || 1;
  }, [classificationResults]);

  const formatAggregateValue = (value: unknown, key: string) => {
    // Hashcode is a string identifier, not a numeric value
    if (key.toLowerCase().includes("hash")) {
      return String(value ?? "—");
    }
    if (typeof value === "number") {
      return `${(value * 100).toFixed(4)}%`;
    }
    return String(value ?? "—");
  };

  const formatRowValue = (value: number | string | undefined) => {
    if (typeof value === "number") {
      return value.toFixed(3);
    }
    return value ?? "—";
  };

  const textMetricOrder = useMemo(() => {
    if (!textResults) return [];
    const requested = run?.selectedMetrics ?? [];
    if (requested.length > 0) {
      return requested.filter((id) => textResults.metrics[id]);
    }
    return Object.keys(textResults.metrics ?? {});
  }, [run?.selectedMetrics, textResults]);

  const textMetricsSelected = run
    ? run.selectedMetrics ?? Object.keys(textResults?.metrics ?? {})
    : [];
  const textMetricsCount = textMetricsSelected.length;
  const textSummaryValue = run?.summaryValue ?? run?.accuracy ?? 0;
  const textSummaryLabel = run?.summaryLabel ?? "Score";

  const aggregatorDisabledMetrics = useMemo(() => {
    if (!run?.metricParameters) return new Set<string>();
    return new Set(
      Object.entries(run.metricParameters ?? {})
        .filter(
          ([, params]) =>
            params?.use_aggregator === false || params?.run_per_row === true
        )
        .map(([metricId]) => metricId)
    );
  }, [run?.metricParameters]);
  const showSummaryMeanCaption = textMetricOrder.some((metricId) =>
    aggregatorDisabledMetrics.has(metricId)
  );
  if (sessionStatus === "loading") {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center">
        <p className="text-sm text-gray-600">Checking authentication…</p>
      </div>
    );
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center space-y-2">
        <p className="text-base font-semibold">Sign in to view eval runs.</p>
        <p className="text-sm text-gray-500">
          Eval runs require authenticated accounts with admin-approved access.
        </p>
        <Link
          href="/login"
          className="inline-flex mt-2 px-4 py-2 rounded-lg bg-black text-white text-sm hover:bg-gray-900"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (!hasEvalAccess) {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center space-y-2">
        <p className="text-base font-semibold">Access denied</p>
        <p className="text-sm text-gray-500">
          Please ask an administrator to grant Eval access.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Evaluation run</p>
            <h1 className="text-3xl font-semibold text-gray-900">
              {run ? run.dataset : loading ? "Loading run..." : "Run not found"}
            </h1>
          </div>
          <Link
            href="/eval"
            className="text-sm px-4 py-2 rounded-xl border border-black/10 hover:bg-gray-50"
          >
            Back to eval
          </Link>
        </div>

        {/* Task banner hidden - info moved to right side */}

        {loading && <p className="text-sm text-gray-500">Loading evaluation details…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !run && !error && (
          <p className="text-sm text-gray-500">Could not find that evaluation run.</p>
        )}

        {run && (
          <>
            {isTextRun ? (
              <>
                <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs text-gray-500">Metric</p>
                      <p className="text-lg font-semibold text-gray-900">{run.metric}</p>
                      {run.description && (
                        <p className="text-sm text-gray-500 mt-1 italic">{run.description}</p>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 space-y-1 text-right">
                      {taskInfo?.startedAt && (
                        <p>
                          Started:{" "}
                          <span className="font-medium text-gray-900">
                            {new Date(taskInfo.startedAt).toLocaleString()}
                          </span>
                        </p>
                      )}
                      <p>
                        Completed:{" "}
                        <span className="font-medium text-gray-900">
                          {displayedTimestamp ? new Date(displayedTimestamp).toLocaleString() : "—"}
                        </span>
                      </p>
                      <p>
                        Status:{" "}
                        <span className="font-semibold uppercase tracking-[0.3em] text-sm">
                          {run.status}
                        </span>
                      </p>
                      {taskInfo?.currentMetric && (
                        <p className="text-blue-700 font-medium">
                          Running: {taskInfo.currentMetric}
                          {typeof taskInfo.processedRows === "number" &&
                            typeof taskInfo.totalRows === "number" &&
                            taskInfo.totalRows > 0 && (
                              <> ({taskInfo.processedRows}/{taskInfo.totalRows} rows)</>
                            )}
                        </p>
                      )}
                      {taskInfo?.error && (
                        <p className="text-red-600 font-medium">
                          Error: {taskInfo.error}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                    <span>
                      Truth column: <strong className="text-gray-900">{run.truthColumn}</strong>
                    </span>
                    <span>
                      Prediction column: <strong className="text-gray-900">{run.predictionColumn}</strong>
                    </span>
                    {run.indexColumn && (
                      <span>
                        Index column: <strong className="text-gray-900">{run.indexColumn}</strong>
                      </span>
                    )}
                    <span>
                      Rows:{" "}
                      <strong className="text-gray-900">
                        {textResults?.total ?? run.results.total ?? 0}
                      </strong>
                    </span>
                  </div>
                  {run.fileName && (
                    <p className="text-xs text-gray-500">
                      CSV: <span className="text-gray-900">{run.fileName}</span>
                    </p>
                  )}

                </section>
                <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Text metrics</p>
                      <h2 className="text-lg font-semibold text-gray-900">Metric breakdown</h2>
                    </div>
                    <p className="text-xs text-gray-500">Showing {textMetricOrder.length} metrics</p>
                  </div>
                  <div className="space-y-4">
                    {textMetricOrder.map((metricId) => {
                      const entry = textResults?.metrics?.[metricId];
                      if (!entry) return null;
                      const params =
                        entry.parameters ?? run.metricParameters?.[metricId] ?? {};
                      const paramList = Object.entries(params ?? {}).map(
                        ([key, value]) => `${key}=${value}`
                      );
                      const rowSamples = getMetricRowSamples(
                        entry,
                        run?.indexColumn,
                        textResults?.indexValues
                      );
                      const showRowSamples =
                        rowSamples.rows.length > 0 && aggregatorDisabledMetrics.has(metricId);
                      return (
                        <article
                          key={metricId}
                          className="rounded-2xl border border-gray-200 p-4 space-y-3 bg-white"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs uppercase tracking-[0.3em] text-gray-500">
                                {metricId.toUpperCase()}
                              </p>
                              <h3 className="text-lg font-semibold text-gray-900">{metricId}</h3>
                            </div>
                            <span className="text-xs text-gray-500">
                              {paramList.length > 0 ? `${paramList.length} overrides` : "Default"}
                            </span>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {entry.aggregates &&
                              Object.entries(entry.aggregates).map(([key, value]) => (
                                <div key={key} className="rounded-xl bg-gray-50 px-3 py-2">
                                  <p className="text-[0.6rem] uppercase tracking-[0.2em] text-gray-400">
                                    {key}
                                  </p>
                                  <p className="text-sm font-semibold text-gray-900">
                                    {formatAggregateValue(value, key)}
                                  </p>
                                </div>
                              ))}
                          </div>
                          {showRowSamples && (
                            <div className="space-y-2 border-t border-gray-100 pt-4">
                              <div className="flex items-baseline justify-between">
                                <p className="text-xs uppercase tracking-[0.35em] text-gray-500">
                                  Row-level scores
                                </p>
                                <p className="text-[0.65rem] uppercase tracking-[0.3em] text-gray-400">
                                  Showing {Math.min(rowSamples.rows.length, ROW_PREVIEW_COUNT)} of {rowSamples.total} rows
                                </p>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-xs text-left">
                                  <thead>
                                    <tr>
                                      <th className="px-2 py-1 font-semibold uppercase tracking-[0.3em] text-gray-400">
                                        Row
                                      </th>
                                      {rowSamples.columns.map((column) => (
                                        <th
                                          key={`column-${metricId}-${column}`}
                                          className="px-2 py-1 font-semibold uppercase tracking-[0.3em] text-gray-400"
                                        >
                                          {column}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rowSamples.rows.slice(0, ROW_PREVIEW_COUNT).map((row, index) => (
                                      <tr key={`row-${metricId}-${index}`} className="border-t border-gray-100">
                                        <td className="px-2 py-1 font-semibold text-[0.7rem] text-gray-700">
                                          {index + 1}
                                        </td>
                                        {rowSamples.columns.map((column) => (
                                          <td
                                            key={`value-${metricId}-${column}-${index}`}
                                            className="px-2 py-1"
                                          >
                                            {formatRowValue(row[column])}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {rowSamples.total > ROW_PREVIEW_COUNT && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRowModal({
                                      metricId,
                                      samples: rowSamples,
                                    })
                                  }
                                  className="text-xs font-semibold uppercase tracking-[0.3em] text-gray-500 hover:text-gray-900"
                                >
                                  View all {rowSamples.total} rows
                                </button>
                              )}
                            </div>
                          )}
                          {paramList.length > 0 && (
                            <p className="text-[0.65rem] text-gray-500">
                              Params: {paramList.join(", ")}
                            </p>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              </>
            ) : (
              <>
                {classificationResults && (
                  <>
                    <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs text-gray-500">Metric</p>
                          <p className="text-lg font-semibold text-gray-900">{run.metric}</p>
                          {run.description && (
                            <p className="text-sm text-gray-500 mt-1 italic">{run.description}</p>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 space-y-1 text-right">
                          <p>
                            Created:{" "}
                            <span className="font-medium text-gray-900">
                              {new Date(run.createdAt).toLocaleString()}
                            </span>
                          </p>
                          {taskInfo?.startedAt && (
                            <p>
                              Started:{" "}
                              <span className="font-medium text-gray-900">
                                {new Date(taskInfo.startedAt).toLocaleString()}
                              </span>
                            </p>
                          )}
                          <p>
                            Completed:{" "}
                            <span className="font-medium text-gray-900">
                              {displayedTimestamp
                                ? new Date(displayedTimestamp).toLocaleString()
                                : "—"}
                            </span>
                          </p>
                          <p>
                            Status:{" "}
                            <span className="font-semibold uppercase tracking-[0.3em] text-sm">
                              {run.status}
                            </span>
                          </p>
                          {taskInfo?.currentMetric && (
                            <p className="text-blue-700 font-medium">
                              Running: {taskInfo.currentMetric}
                              {typeof taskInfo.processedRows === "number" &&
                                typeof taskInfo.totalRows === "number" &&
                                taskInfo.totalRows > 0 && (
                                  <> ({taskInfo.processedRows}/{taskInfo.totalRows} rows)</>
                                )}
                            </p>
                          )}
                          {taskInfo?.error && (
                            <p className="text-red-600 font-medium">
                              Error: {taskInfo.error}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                        <span>
                          Truth column: <strong className="text-gray-900">{run.truthColumn}</strong>
                        </span>
                        <span>
                          Prediction column:{" "}
                          <strong className="text-gray-900">{run.predictionColumn}</strong>
                        </span>
                        {run.indexColumn && (
                          <span>
                            Index column: <strong className="text-gray-900">{run.indexColumn}</strong>
                          </span>
                        )}
                        <span>
                          Rows:{" "}
                          <strong className="text-gray-900">
                            {classificationResults.total ?? 0}
                          </strong>
                        </span>
                      </div>
                      {run.fileName && (
                        <p className="text-xs text-gray-500">
                          CSV: <span className="text-gray-900">{run.fileName}</span>
                        </p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Accuracy</p>
                          <p className="text-3xl font-semibold text-gray-900 mt-2">
                            {(classificationResults.accuracy * 100).toFixed(4)}%
                          </p>
                        </div>
                        <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Macro F1</p>
                          <p className="text-3xl font-semibold text-gray-900 mt-2">
                            {(classificationResults.macroF1 * 100).toFixed(4)}%
                          </p>
                        </div>
                        <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Micro F1</p>
                          <p className="text-3xl font-semibold text-gray-900 mt-2">
                            {(classificationResults.microF1 * 100).toFixed(4)}%
                          </p>
                        </div>
                      </div>
                    </section>
                    <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
                      <div className="flex items-baseline justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Classification report</p>
                          <h2 className="text-lg font-semibold text-gray-900">Per-label metrics</h2>
                        </div>
                      </div>
                      <div className="overflow-auto rounded-2xl border border-gray-100">
                        <table className="min-w-full text-xs text-left">
                          <thead>
                            <tr>
                              <th className="px-3 py-2 font-semibold uppercase tracking-[0.3em] text-gray-500">
                                Label
                              </th>
                              <th className="px-3 py-2 font-semibold uppercase tracking-[0.3em] text-gray-500">
                                Precision
                              </th>
                              <th className="px-3 py-2 font-semibold uppercase tracking-[0.3em] text-gray-500">
                                Recall
                              </th>
                              <th className="px-3 py-2 font-semibold uppercase tracking-[0.3em] text-gray-500">
                                F1
                              </th>
                              <th className="px-3 py-2 font-semibold uppercase tracking-[0.3em] text-gray-500">
                                Support
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {labelRows.map(({ label, metrics }) => (
                              <tr
                                key={`report-label-${label}`}
                                className="border-t border-gray-100"
                              >
                                <td className="px-3 py-2 text-gray-900 font-semibold">{label}</td>
                                <td className="px-3 py-2">{(metrics.precision * 100).toFixed(4)}%</td>
                                <td className="px-3 py-2">{(metrics.recall * 100).toFixed(4)}%</td>
                                <td className="px-3 py-2">{(metrics.f1_score * 100).toFixed(4)}%</td>
                                <td className="px-3 py-2">{metrics.support}</td>
                              </tr>
                            ))}
                            {aggregateRows.map(([label, metrics]) => (
                              <tr
                                key={`report-agg-${label}`}
                                className="border-t border-gray-100 bg-gray-50"
                              >
                                <td className="px-3 py-2 text-gray-700 font-semibold">{label}</td>
                                <td className="px-3 py-2">{(metrics.precision * 100).toFixed(4)}%</td>
                                <td className="px-3 py-2">{(metrics.recall * 100).toFixed(4)}%</td>
                                <td className="px-3 py-2">{(metrics.f1_score * 100).toFixed(4)}%</td>
                                <td className="px-3 py-2">{metrics.support}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                )}
                {run.mode === "multi-label" && labelConfusionRows.length > 0 && classificationResults && (
                  <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">
                          Multi-label confusion
                        </p>
                        <h2 className="text-lg font-semibold text-gray-900">
                          TP / FP / FN / TN per label
                        </h2>
                      </div>
                      <p className="text-xs text-gray-500 max-w-xs">
                        Counts show how often each label was predicted when it was present or absent
                        to expose per-label trade-offs.
                      </p>
                    </div>
                    <div className="overflow-auto rounded-2xl border border-gray-100">
                      <table className="min-w-full text-xs text-left">
                        <thead>
                          <tr>
                            <th className="px-3 py-2 font-semibold uppercase tracking-[0.3em] text-gray-500">
                              Label
                            </th>
                            <th className="px-3 py-2 font-semibold uppercase tracking-[0.3em] text-gray-500">
                              TP
                            </th>
                            <th className="px-3 py-2 font-semibold uppercase tracking-[0.3em] text-gray-500">
                              FP
                            </th>
                            <th className="px-3 py-2 font-semibold uppercase tracking-[0.3em] text-gray-500">
                              FN
                            </th>
                            <th className="px-3 py-2 font-semibold uppercase tracking-[0.3em] text-gray-500">
                              TN
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {labelConfusionRows.map(([label, metrics]) => (
                            <tr key={`confusion-${label}`} className="border-t border-gray-100">
                              <td className="px-3 py-2 text-gray-900 font-semibold">{label}</td>
                              <td className="px-3 py-2">{metrics.tp}</td>
                              <td className="px-3 py-2">{metrics.fp}</td>
                              <td className="px-3 py-2">{metrics.fn}</td>
                              <td className="px-3 py-2">{metrics.tn}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                {run.mode !== "multi-label" && classificationResults && (
                  <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">Confusion matrix</h3>
                        <p className="text-xs text-gray-500">Counts per label</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setViewMode("table")}
                          className={`px-3 py-1 rounded-full font-semibold transition ${viewMode === "table"
                            ? "bg-gray-900 text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                            }`}
                        >
                          Table view
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode("heatmap")}
                          className={`px-3 py-1 rounded-full font-semibold transition ${viewMode === "heatmap"
                            ? "bg-gray-900 text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                            }`}
                        >
                          Figure view
                        </button>
                      </div>
                    </div>
                    {viewMode === "table" ? (
                      <div className="overflow-auto rounded-2xl border border-gray-100">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.4em] text-gray-500">
                                Truth ↓
                              </th>
                              {classificationResults.labels.map((label) => (
                                <th
                                  key={`matrix-head-${label}`}
                                  className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.4em] text-gray-500"
                                >
                                  {label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {classificationResults.labels.map((truthLabel) => (
                              <tr
                                key={`matrix-row-${truthLabel}`}
                                className="border-t border-gray-100"
                              >
                                <td className="px-3 py-2 font-semibold text-xs text-gray-700">
                                  {truthLabel}
                                </td>
                                {classificationResults.labels.map((predLabel) => {
                                  const value =
                                    classificationResults.confusionMatrix[truthLabel]?.[predLabel] ?? 0;
                                  const isDiagonal = truthLabel === predLabel;
                                  return (
                                    <td
                                      key={`matrix-cell-${truthLabel}-${predLabel}`}
                                      className={`px-3 py-2 text-center text-sm font-semibold ${isDiagonal ? "text-emerald-500" : "text-gray-500"
                                        }`}
                                    >
                                      {value}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="overflow-auto rounded-2xl border border-gray-100">
                        <div
                          className="grid gap-1 p-2 bg-white"
                          style={{
                            gridTemplateColumns: `repeat(${classificationResults.labels.length + 1}, minmax(48px, 1fr))`,
                          }}
                        >
                          <div className="px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-gray-500 border border-gray-100">
                            Truth ↓ / Pred →
                          </div>
                          {classificationResults.labels.map((label) => (
                            <div
                              key={`heat-header-${label}`}
                              className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-gray-500 border border-gray-100 text-center"
                            >
                              {label}
                            </div>
                          ))}
                          {classificationResults.labels.map((truthLabel) => (
                            <Fragment key={`heat-truth-${truthLabel}`}>
                              <div className="px-2 py-2 text-xs font-semibold text-gray-900 border border-gray-100">
                                {truthLabel}
                              </div>
                              {classificationResults.labels.map((predLabel) => {
                                const value =
                                  classificationResults.confusionMatrix[truthLabel]?.[predLabel] ?? 0;
                                const intensity = heatmapMax ? value / heatmapMax : 0;
                                const alpha = 0.15 + intensity * 0.75;
                                const background = `rgba(14,116,144,${alpha})`;
                                const textColor = alpha > 0.45 ? "text-white" : "text-gray-900";
                                return (
                                  <div
                                    key={`heat-cell-${truthLabel}-${predLabel}`}
                                    className={`px-2 py-3 text-center text-sm font-semibold border border-gray-100 ${textColor}`}
                                    style={{ background }}
                                  >
                                    {value}
                                  </div>
                                );
                              })}
                            </Fragment>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
      {rowModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Row data</p>
                <h3 className="text-lg font-semibold text-gray-900">
                  {rowModal.metricId.toUpperCase()} ({rowModal.samples.total} rows)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRowModal(null)}
                className="text-xs uppercase tracking-[0.3em] text-gray-500 hover:text-gray-900"
              >
                Close
              </button>
            </div>
            <div className="mt-4 max-h-[80vh] overflow-y-auto rounded-2xl border border-gray-100">
              <table className="min-w-full text-xs text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 font-semibold uppercase tracking-[0.3em] text-gray-400">Row</th>
                    {rowModal.samples.columns.map((column) => (
                      <th
                        key={`modal-column-${column}`}
                        className="px-2 py-2 font-semibold uppercase tracking-[0.3em] text-gray-400"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowModal.samples.rows.map((row, index) => (
                    <tr key={`modal-row-${index}`} className="border-t border-gray-100">
                      <td className="px-2 py-1 font-semibold text-[0.7rem] text-gray-700">{index + 1}</td>
                      {rowModal.samples.columns.map((column) => (
                        <td key={`modal-value-${index}-${column}`} className="px-2 py-1">
                          {formatRowValue(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
