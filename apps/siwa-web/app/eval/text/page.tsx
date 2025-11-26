"use client";

import Link from "next/link";
import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { useSession } from "next-auth/react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const CSV_INPUT_ID = "text-eval-upload";
const PROGRESS_UPDATE_MS = 420;

type MetricId = "bertscore" | "bleu" | "rouge" | "meteor";

const TEXT_METRICS: Array<{
  id: MetricId;
  title: string;
  description: string;
  state: "live";
}> = [
    {
      id: "bertscore",
      title: "BERTScore",
      description: "Precision, recall, and F1 on contextual embeddings.",
      state: "live",
    },
    {
      id: "bleu",
      title: "BLEU",
      description: "N-gram precision for translation-style responses.",
      state: "live",
    },
    {
      id: "rouge",
      title: "ROUGE",
      description: "Recall-based overlap metrics for summaries.",
      state: "live",
    },
    {
      id: "meteor",
      title: "METEOR",
      description: "Fragmentation-aware word matching.",
      state: "live",
    },
  ];

type BertscoreParams = {
  lang: string;
  model_type: string;
  num_layers: string;
  batch_size: string;
  nthreads: string;
  idf: boolean;
  rescale_with_baseline: boolean;
  all_layers: boolean;
  use_fast_tokenizer: boolean;
  verbose: boolean;
  baseline_path: string;
  device: string;
  run_per_row: boolean;
};

type BleuParams = {
  tokenizer: string;
  max_order: string;
  smooth: boolean;
};

type RougeParams = {
  rouge_types: string;
  use_aggregator: boolean;
  use_stemmer: boolean;
  tokenizer: string;
};

type MeteorParams = {
  alpha: string;
  beta: string;
  gamma: string;
};

type MetricParams = {
  bertscore: BertscoreParams;
  bleu: BleuParams;
  rouge: RougeParams;
  meteor: MeteorParams;
};

const DEFAULT_METRIC_PARAMS: MetricParams = {
  bertscore: {
    lang: "en",
    model_type: "",
    num_layers: "",
    batch_size: "64",
    nthreads: "4",
    idf: false,
    rescale_with_baseline: false,
    all_layers: false,
    use_fast_tokenizer: false,
    verbose: false,
    baseline_path: "",
    device: "",
    run_per_row: false,
  },
  bleu: {
    tokenizer: "default",
    max_order: "4",
    smooth: false,
  },
  rouge: {
    rouge_types: "rouge1,rouge2,rougeL,rougeLsum",
    use_aggregator: true,
    use_stemmer: false,
    tokenizer: "default",
  },
  meteor: {
    alpha: "0.9",
    beta: "3",
    gamma: "0.5",
  },
};

const getDefaultMetricParams = (): MetricParams => ({
  bertscore: { ...DEFAULT_METRIC_PARAMS.bertscore },
  bleu: { ...DEFAULT_METRIC_PARAMS.bleu },
  rouge: { ...DEFAULT_METRIC_PARAMS.rouge },
  meteor: { ...DEFAULT_METRIC_PARAMS.meteor },
});

const numericFields: Record<string, string[]> = {
  bertscore: ["num_layers", "batch_size", "nthreads"],
  bleu: ["max_order"],
  meteor: ["alpha", "beta", "gamma"],
};

const listFields: Record<string, string[]> = {
  rouge: ["rouge_types"],
};

type MetricOverrideMap = Record<MetricId, Record<string, boolean>>;

const initializeMetricOverrides = (): MetricOverrideMap => {
  const overrides: MetricOverrideMap = {} as MetricOverrideMap;
  (Object.keys(DEFAULT_METRIC_PARAMS) as MetricId[]).forEach((metricId) => {
    overrides[metricId] = Object.fromEntries(
      Object.keys(DEFAULT_METRIC_PARAMS[metricId]).map((key) => [key, false])
    ) as Record<string, boolean>;
  });
  return overrides;
};

type UploadStatus = {
  stage: "idle" | "running" | "completed";
  progress: number;
  message: string;
};

export default function TextEvalPage() {
  const router = useRouter();
  const { status: sessionStatus, data: session } = useSession();
  const [datasetName, setDatasetName] = useState("text-benchmark");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [selectedColumns, setSelectedColumns] = useState({
    truth: "",
    prediction: "",
    index: "",
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [description, setDescription] = useState("");
  const [selectedMetrics, setSelectedMetrics] = useState<MetricId[]>([]);
  const [metricParams, setMetricParams] = useState<MetricParams>(() => getDefaultMetricParams());
  const [metricOverrides, setMetricOverrides] = useState<MetricOverrideMap>(() =>
    initializeMetricOverrides()
  );
  const [status, setStatus] = useState<UploadStatus>({
    stage: "idle",
    progress: 0,
    message: "Ready to run evaluation.",
  });
  const [error, setError] = useState<string | null>(null);
  const progressTimer = useRef<number | null>(null);

  // Hardware detection state
  const [availableDevices, setAvailableDevices] = useState<string[]>(["cpu"]);
  const [defaultDevice, setDefaultDevice] = useState<string>("cpu");
  const [hardwareInfo, setHardwareInfo] = useState<any>(null);

  const previewRows = useMemo(() => csvRows.slice(0, 3), [csvRows]);
  const previewColumns = useMemo(() => {
    const selected = [
      selectedColumns.truth,
      selectedColumns.prediction,
    ].filter(Boolean);
    if (selected.length > 0) {
      return Array.from(new Set(selected));
    }
    if (csvHeaders.length > 0) {
      return csvHeaders.slice(0, 2);
    }
    if (previewRows.length > 0) {
      return Object.keys(previewRows[0]).slice(0, 2);
    }
    return [];
  }, [selectedColumns.truth, selectedColumns.prediction, csvHeaders, previewRows]);
  const hasEvalAccess = Boolean(
    session &&
    (session.role === "owner" || session.role === "admin" || session.canAccessEval)
  );
  const fetchHeaders = useMemo(() => {
    if (!session?.accessToken) return undefined;
    return { Authorization: `Bearer ${session.accessToken}` };
  }, [session?.accessToken]);

  useEffect(() => {
    if (status.stage !== "running") {
      if (progressTimer.current) {
        window.clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
      return;
    }

    progressTimer.current = window.setInterval(() => {
      setStatus((prev) => {
        if (prev.stage !== "running") return prev;
        return {
          ...prev,
          progress: Math.min(prev.progress + Math.random() * 10, 90),
        };
      });
    }, PROGRESS_UPDATE_MS);

    return () => {
      if (progressTimer.current) {
        window.clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
    };
  }, [status.stage]);

  useEffect(() => {
    return () => {
      if (progressTimer.current) {
        window.clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
    };
  }, []);

  // Load hardware info on mount
  useEffect(() => {
    if (!fetchHeaders) return;
    fetch(`${API_BASE}/evaluations/hardware`, {
      headers: fetchHeaders,
    })
      .then((res) => res.json())
      .then((data) => {
        setAvailableDevices(data.devices || ["cpu"]);
        setDefaultDevice(data.default || "cpu");
        setHardwareInfo(data);
        // Auto-set device to best available if not already set
        if (!metricParams.bertscore.device) {
          updateMetricParam("bertscore", "device", data.default || "cpu");
        }
      })
      .catch((err) => {
        console.error("Failed to load hardware info:", err);
        // Fallback to CPU
        setAvailableDevices(["cpu"]);
        setDefaultDevice("cpu");
      });
  }, [fetchHeaders]);

  useEffect(() => {
    if (!csvHeaders.length) {
      setSelectedColumns((prev) => {
        if (!prev.truth && !prev.prediction && !prev.index) {
          return prev;
        }
        return { truth: "", prediction: "", index: "" };
      });
      return;
    }

    setSelectedColumns((prev) => {
      const truthValid = !!prev.truth && csvHeaders.includes(prev.truth);
      const predictionValid = !!prev.prediction && csvHeaders.includes(prev.prediction);
      const indexValid = !!prev.index && csvHeaders.includes(prev.index);
      const nextTruth = truthValid ? prev.truth : csvHeaders[0];
      let nextPrediction = predictionValid
        ? prev.prediction
        : csvHeaders.find((header) => header !== nextTruth) ?? csvHeaders[0];
      if (nextPrediction === nextTruth && csvHeaders.length > 1) {
        const alternate = csvHeaders.find((header) => header !== nextTruth);
        if (alternate) {
          nextPrediction = alternate;
        }
      }
      const nextIndex = indexValid
        ? prev.index
        : csvHeaders.find(
          (header) => header !== nextTruth && header !== nextPrediction
        ) ?? "";

      if (
        nextTruth === prev.truth &&
        nextPrediction === prev.prediction &&
        nextIndex === prev.index
      ) {
        return prev;
      }
      return { truth: nextTruth, prediction: nextPrediction, index: nextIndex };
    });
  }, [csvHeaders]);

  const loadCsv = (file: File) => {
    setError(null);
    setSelectedFile(file);
    setUploadedFileName(file.name);
    setCsvRows([]);
    setCsvHeaders([]);
    setSelectedColumns({ truth: "", prediction: "", index: "" });
    setStatus({ stage: "idle", progress: 0, message: "Ready to run evaluation." });

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: (parseResult) => {
        const rows = parseResult.data;
        const headers = parseResult.meta.fields?.filter(Boolean) ?? [];
        if (rows.length === 0) {
          setError("The CSV file appears empty.");
          return;
        }
        setCsvRows(rows);
        setCsvHeaders(headers);
        setSelectedColumns({
          truth: headers[0] ?? "",
          prediction: headers[1] ?? "",
          index: headers[2] ?? "",
        });
      },
      error: (parseError) => {
        setError(`Unable to parse CSV: ${parseError.message}`);
      },
    });
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      loadCsv(file);
    }
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      loadCsv(file);
    }
  };

  const toggleMetric = (metricId: MetricId) => {
    setSelectedMetrics((prev) => {
      if (prev.includes(metricId)) {
        return prev.filter((id) => id !== metricId);
      }
      return [...prev, metricId];
    });
  };

  const updateMetricParam = <
    M extends MetricId,
    K extends keyof MetricParams[M]
  >(
    metricId: M,
    key: K,
    value: MetricParams[M][K]
  ) => {
    setMetricParams((prev) => ({
      ...prev,
      [metricId]: {
        ...prev[metricId],
        [key]: value,
      },
    }));

    const defaultValue = DEFAULT_METRIC_PARAMS[metricId]?.[key];
    const isDefault = defaultValue === value;
    setMetricOverrides((prev) => ({
      ...prev,
      [metricId]: {
        ...(prev[metricId] ?? {}),
        [key]: !isDefault,
      },
    }));
  };

  const prepareMetricParameters = () => {
    const prepared: Record<string, Record<string, unknown>> = {};
    selectedMetrics.forEach((metricId) => {
      const raw = metricParams[metricId] ?? {};
      const overridesForMetric = metricOverrides[metricId] ?? {};
      const sanitized: Record<string, unknown> = {};
      Object.entries(raw).forEach(([key, value]) => {
        if (!overridesForMetric[key]) {
          return;
        }
        if (value === "" || value == null) {
          return;
        }
        if (listFields[metricId]?.includes(key) && typeof value === "string") {
          const tokens = value
            .split(",")
            .map((token) => token.trim())
            .filter(Boolean);
          if (tokens.length > 0) {
            sanitized[key] = tokens;
          }
          return;
        }
        if (
          numericFields[metricId]?.includes(key) &&
          typeof value === "string"
        ) {
          const parsed = Number(value);
          if (!Number.isNaN(parsed)) {
            sanitized[key] = parsed;
          }
          return;
        }
        sanitized[key] = value;
      });
      if (Object.keys(sanitized).length > 0) {
        prepared[metricId] = sanitized;
      }
    });
    return prepared;
  };

  const startEvaluation = async () => {
    if (!selectedFile) {
      setError("Upload a CSV file first.");
      return;
    }
    if (!csvRows.length) {
      setError("Upload at least one row of data.");
      return;
    }
    if (!selectedColumns.truth || !selectedColumns.prediction) {
      setError("Select both truth and prediction columns.");
      return;
    }
    if (selectedMetrics.length === 0) {
      setError("Select at least one metric to run.");
      return;
    }

    const formData = new FormData();
    formData.append("dataset_name", datasetName);
    formData.append("truth_column", selectedColumns.truth);
    formData.append("prediction_column", selectedColumns.prediction);
    if (selectedColumns.index) {
      formData.append("index_column", selectedColumns.index);
    }
    if (sourcePath.trim()) {
      formData.append("source_path", sourcePath.trim());
    }
    if (description.trim()) {
      formData.append("description", description.trim());
    }
    formData.append("metrics", JSON.stringify(selectedMetrics));
    const preparedParams = prepareMetricParameters();
    if (Object.keys(preparedParams).length > 0) {
      formData.append("metric_parameters", JSON.stringify(preparedParams));
    }
    formData.append("file", selectedFile, selectedFile.name);

    setStatus({ stage: "running", progress: 8, message: "Uploading data…" });
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/evaluations/text`, {
        method: "POST",
        headers: fetchHeaders,
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail ?? "Unable to run evaluation.");
      }
      setStatus({ stage: "completed", progress: 100, message: "Queued evaluation…" });
      router.push(`/eval/tasks?taskId=${payload.taskId}`);
    } catch (err) {
      console.error(err);
      setStatus({ stage: "idle", progress: 0, message: "Ready to run evaluation." });
      setError(err instanceof Error ? err.message : "Evaluation failed.");
    }
  };

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
        <p className="text-base font-semibold">Sign in to run evaluations.</p>
        <p className="text-sm text-gray-500">
          Eval runs are limited to authenticated accounts with admin approval.
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
          You need eval access from an administrator to create runs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="bg-white border rounded-2xl p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">New text evaluation</p>
            <h1 className="text-3xl font-semibold text-gray-900 mt-1">Text metrics</h1>
            <p className="text-gray-600 mt-2 max-w-2xl">
              Upload predictions, map reference and prediction columns, and pick the metrics to run.
            </p>
          </div>
          <Link
            href="/eval"
            className="text-sm px-4 py-2 rounded-xl border border-gray-200 text-gray-600"
          >
            Back to dashboard
          </Link>
        </div>
      </section>

      <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-6">
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">Dataset name</label>
          <input
            type="text"
            value={datasetName}
            onChange={(event) => setDatasetName(event.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-gray-600">
            Source path (optional)
            <input
              type="text"
              value={sourcePath}
              onChange={(event) => setSourcePath(event.target.value)}
              placeholder="e.g. /Users/me/outputs/predictions.csv"
              className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
            />
          </label>
          <label className="text-sm text-gray-600">
            Description (optional)
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
            />
          </label>
        </div>
        <label
          htmlFor={CSV_INPUT_ID}
          onDrop={handleDrop}
          onDragOver={(event) => event.preventDefault()}
          className="border border-dashed rounded-2xl border-gray-300 bg-gray-50 text-center px-4 py-10 cursor-pointer block"
        >
          <input
            id={CSV_INPUT_ID}
            type="file"
            accept=".csv"
            onChange={handleFileInput}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-2 text-sm text-gray-500">
            <span className="text-lg font-semibold text-gray-800">Upload CSV</span>
            <span>Drop a file or browse</span>
          </div>
          {uploadedFileName && (
            <p className="text-xs text-gray-500 mt-3">
              Selected: <span className="font-medium text-gray-900">{uploadedFileName}</span>
            </p>
          )}
          {csvRows.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">Columns: {csvHeaders.join(", ")}</p>
          )}
        </label>
        {csvHeaders.length > 0 && (
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm text-gray-600">
              Reference column
              <select
                value={selectedColumns.truth}
                onChange={(event) =>
                  setSelectedColumns((prev) => ({ ...prev, truth: event.target.value }))
                }
                className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
              >
                <option value="">Select column</option>
                {csvHeaders.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-gray-600">
              Prediction column
              <select
                value={selectedColumns.prediction}
                onChange={(event) =>
                  setSelectedColumns((prev) => ({ ...prev, prediction: event.target.value }))
                }
                className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
              >
                <option value="">Select column</option>
                {csvHeaders.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-gray-600">
              Index column (optional)
              <select
                value={selectedColumns.index}
                onChange={(event) =>
                  setSelectedColumns((prev) => ({ ...prev, index: event.target.value }))
                }
                className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
              >
                <option value="">None</option>
                {csvHeaders.map((header) => (
                  <option key={`index-${header}`} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {previewRows.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gray-400">Preview</p>
            <div className="mt-3 grid gap-2 text-xs text-gray-500">
              {previewRows.map((row, index) => (
                <div key={`preview-${index}`} className="grid grid-cols-2 gap-3">
                  {previewColumns.length > 0 ? (
                    previewColumns.map((column) => (
                      <div key={`${index}-${column}`} className="rounded-xl bg-gray-50 px-3 py-2 break-words">
                        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-gray-400">{column}</p>
                        <p className="text-xs text-gray-800">{row[column] ?? "—"}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-500">Select columns to preview their values.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Metrics</p>
            <h2 className="text-lg font-semibold text-gray-900">Select which metrics to compute</h2>
          </div>
          <p className="text-xs text-gray-500">At least one metric must be enabled.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEXT_METRICS.map((metric) => {
            const isActive = selectedMetrics.includes(metric.id);
            return (
              <button
                key={metric.id}
                type="button"
                onClick={() => toggleMetric(metric.id)}
                className={`border rounded-2xl bg-white px-4 py-4 text-left text-sm transition ${isActive
                    ? "border-black bg-black text-white"
                    : "border-gray-200 text-gray-600 hover:border-gray-400"
                  }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{metric.title}</h3>
                  <span className="text-[0.55rem] uppercase tracking-[0.4em] text-gray-400">
                    {metric.state}
                  </span>
                </div>
                <p className="mt-2 text-[0.75rem] text-gray-400">{metric.description}</p>
                <p className="mt-3 text-[0.65rem] text-gray-400">
                  {isActive ? "Enabled" : "Disabled"}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Metric parameters</p>
            <h2 className="text-lg font-semibold text-gray-900">Customize per-metric options</h2>
          </div>
          <p className="text-xs text-gray-500 max-w-xs">
            Parameters are forwarded directly to each huggingface evaluate metric.
          </p>
        </div>
        <div className="space-y-5">
          {selectedMetrics.includes("bertscore") && (
            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-gray-500">BERTScore</p>
                  <h3 className="text-base font-semibold text-gray-900">Embedding-based F1</h3>
                </div>
                <p className="text-xs text-gray-500">Enabled</p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm text-gray-600">
                  Language
                  <input
                    type="text"
                    value={metricParams.bertscore.lang}
                    onChange={(event) =>
                      updateMetricParam("bertscore", "lang", event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
                <label className="text-sm text-gray-600">
                  Model type
                  <input
                    type="text"
                    value={metricParams.bertscore.model_type}
                    onChange={(event) =>
                      updateMetricParam("bertscore", "model_type", event.target.value)
                    }
                    placeholder="e.g. microsoft/deberta-xlarge-mnli"
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
                <label className="text-sm text-gray-600">
                  Num layers
                  <input
                    type="number"
                    min={1}
                    value={metricParams.bertscore.num_layers}
                    onChange={(event) =>
                      updateMetricParam("bertscore", "num_layers", event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
                <label className="text-sm text-gray-600">
                  Batch size
                  <input
                    type="number"
                    min={1}
                    value={metricParams.bertscore.batch_size}
                    onChange={(event) =>
                      updateMetricParam("bertscore", "batch_size", event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
                <label className="text-sm text-gray-600">
                  Threads
                  <input
                    type="number"
                    min={1}
                    value={metricParams.bertscore.nthreads}
                    onChange={(event) =>
                      updateMetricParam("bertscore", "nthreads", event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
                <label className="text-sm text-gray-600">
                  Device
                  <select
                    value={metricParams.bertscore.device || defaultDevice}
                    onChange={(event) => updateMetricParam("bertscore", "device", event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  >
                    {availableDevices.map((device) => {
                      let description = device.toUpperCase();
                      if (device === "cuda" && hardwareInfo?.cuda_device_name) {
                        description = `CUDA - ${hardwareInfo.cuda_device_name} (Fastest)`;
                      } else if (device === "cuda") {
                        description = "CUDA - NVIDIA GPU (Fastest)";
                      } else if (device === "mps") {
                        description = "MPS - Apple Silicon GPU (Fast)";
                      } else if (device === "cpu") {
                        description = "CPU - Universal (Slowest)";
                      }
                      return (
                        <option key={device} value={device}>
                          {description}
                        </option>
                      );
                    })}
                  </select>
                  {hardwareInfo?.info && (
                    <p className="mt-1 text-xs text-gray-500">
                      Available: {hardwareInfo.info}
                    </p>
                  )}
                </label>
                <label className="text-sm text-gray-600">
                  Baseline path
                  <input
                    type="text"
                    value={metricParams.bertscore.baseline_path}
                    onChange={(event) =>
                      updateMetricParam("bertscore", "baseline_path", event.target.value)
                    }
                    placeholder="Optional baseline file"
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-gray-600 mt-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={metricParams.bertscore.idf}
                    onChange={(event) => updateMetricParam("bertscore", "idf", event.target.checked)}
                  />
                  Use IDF weighting
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={metricParams.bertscore.rescale_with_baseline}
                    onChange={(event) =>
                      updateMetricParam("bertscore", "rescale_with_baseline", event.target.checked)
                    }
                  />
                  Rescale with baseline
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={metricParams.bertscore.all_layers}
                    onChange={(event) =>
                      updateMetricParam("bertscore", "all_layers", event.target.checked)
                    }
                  />
                  Aggregate all layers
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={metricParams.bertscore.use_fast_tokenizer}
                    onChange={(event) =>
                      updateMetricParam("bertscore", "use_fast_tokenizer", event.target.checked)
                    }
                  />
                  Use fast tokenizer
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={metricParams.bertscore.verbose}
                    onChange={(event) => updateMetricParam("bertscore", "verbose", event.target.checked)}
                  />
                  Verbose logging
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={metricParams.bertscore.run_per_row}
                    onChange={(event) =>
                      updateMetricParam("bertscore", "run_per_row", event.target.checked)
                    }
                  />
                  Run BERTScore per row (avoids OOM; means will be reported)
                </label>
              </div>
            </div>
          )}

          {selectedMetrics.includes("bleu") && (
            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-gray-500">BLEU</p>
                  <h3 className="text-base font-semibold text-gray-900">N-gram precision</h3>
                </div>
                <p className="text-xs text-gray-500">Enabled</p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm text-gray-600">
                  Tokenizer
                  <select
                    value={metricParams.bleu.tokenizer}
                    onChange={(event) => updateMetricParam("bleu", "tokenizer", event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  >
                    <option value="default">13a (default)</option>
                    <option value="whitespace">Whitespace</option>
                  </select>
                </label>
                <label className="text-sm text-gray-600">
                  Max order
                  <input
                    type="number"
                    min={1}
                    value={metricParams.bleu.max_order}
                    onChange={(event) => updateMetricParam("bleu", "max_order", event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={metricParams.bleu.smooth}
                    onChange={(event) => updateMetricParam("bleu", "smooth", event.target.checked)}
                  />
                  Apply smoothing
                </label>
              </div>
            </div>
          )}

          {selectedMetrics.includes("rouge") && (
            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-gray-500">ROUGE</p>
                  <h3 className="text-base font-semibold text-gray-900">
                    Recall-focused overlap
                  </h3>
                </div>
                <p className="text-xs text-gray-500">Enabled</p>
              </div>
              <div className="mt-4 space-y-3">
                <label className="text-sm text-gray-600">
                  Rouge types
                  <input
                    type="text"
                    value={metricParams.rouge.rouge_types}
                    onChange={(event) =>
                      updateMetricParam("rouge", "rouge_types", event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={metricParams.rouge.use_aggregator}
                      onChange={(event) =>
                        updateMetricParam("rouge", "use_aggregator", event.target.checked)
                      }
                    />
                    Return aggregates
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={metricParams.rouge.use_stemmer}
                      onChange={(event) =>
                        updateMetricParam("rouge", "use_stemmer", event.target.checked)
                      }
                    />
                    Use Porter stemmer
                  </label>
                </div>
                <label className="text-sm text-gray-600">
                  Tokenizer
                  <select
                    value={metricParams.rouge.tokenizer}
                    onChange={(event) => updateMetricParam("rouge", "tokenizer", event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  >
                    <option value="default">Default</option>
                    <option value="whitespace">Whitespace</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {selectedMetrics.includes("meteor") && (
            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-gray-500">METEOR</p>
                  <h3 className="text-base font-semibold text-gray-900">
                    Fragmentation-aware scoring
                  </h3>
                </div>
                <p className="text-xs text-gray-500">Enabled</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="text-sm text-gray-600">
                  Alpha
                  <input
                    type="number"
                    step="0.01"
                    value={metricParams.meteor.alpha}
                    onChange={(event) => updateMetricParam("meteor", "alpha", event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
                <label className="text-sm text-gray-600">
                  Beta
                  <input
                    type="number"
                    step="0.1"
                    value={metricParams.meteor.beta}
                    onChange={(event) => updateMetricParam("meteor", "beta", event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
                <label className="text-sm text-gray-600">
                  Gamma
                  <input
                    type="number"
                    step="0.1"
                    value={metricParams.meteor.gamma}
                    onChange={(event) => updateMetricParam("meteor", "gamma", event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring focus:border-black"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
        {error && (
          <p className="text-sm text-red-600 border border-red-100 px-3 py-2 rounded-xl bg-red-50">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={startEvaluation}
            disabled={
              status.stage === "running" ||
              !selectedFile ||
              !selectedColumns.truth ||
              !selectedColumns.prediction ||
              selectedMetrics.length === 0
            }
            className="px-5 py-2 rounded-xl bg-black text-white text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Run evaluation
          </button>
          <div className="flex-1 min-w-[120px]">
            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
              <div
                style={{ width: `${status.progress}%` }}
                className={`h-full transition-all ${status.stage === "completed" ? "bg-emerald-500" : "bg-sky-500"
                  }`}
              />
            </div>
            <p className="text-[0.65rem] uppercase tracking-[0.4em] text-gray-500 mt-1">
              {status.message}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
