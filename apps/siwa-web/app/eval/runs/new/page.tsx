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
const CSV_INPUT_ID = "eval-run-upload";
const PROGRESS_UPDATE_MS = 420;

const evaluationModes = [
  {
    id: "single-label",
    title: "Single-label classification",
    description:
      "Compare a single predicted label with ground truth labels for each row.",
    state: "live",
  },
  {
    id: "multi-label",
    title: "Multi-label classification",
    description: "Compare sets of labels for each row (e.g. 'cat, outdoor').",
    state: "live",
  },
];

type UploadStatus = {
  stage: "idle" | "running" | "completed";
  progress: number;
  message: string;
};

export default function NewEvalRunPage() {
  const router = useRouter();
  const { status: sessionStatus, data: session } = useSession();
  const [selectedMode, setSelectedMode] = useState(evaluationModes[0].id);
  const [datasetName, setDatasetName] = useState("classification-benchmark");
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
  const [status, setStatus] = useState<UploadStatus>({
    stage: "idle",
    progress: 0,
    message: "Ready to run evaluation.",
  });
  const [error, setError] = useState<string | null>(null);
  const progressTimer = useRef<number | null>(null);

  const previewRows = useMemo(() => csvRows.slice(0, 3), [csvRows]);
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
        return { ...prev, progress: Math.min(prev.progress + Math.random() * 10, 90) };
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

    const formData = new FormData();
    formData.append("dataset_name", datasetName);
    formData.append("truth_column", selectedColumns.truth);
    formData.append("prediction_column", selectedColumns.prediction);
    if (selectedColumns.index) {
      formData.append("index_column", selectedColumns.index);
    }
    formData.append("mode", selectedMode);
    if (sourcePath.trim()) {
      formData.append("source_path", sourcePath.trim());
    }
    if (description.trim()) {
      formData.append("description", description.trim());
    }
    formData.append("file", selectedFile, selectedFile.name);

    setStatus({ stage: "running", progress: 8, message: "Uploading data…" });
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/evaluations/classification`, {
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
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">New evaluation</p>
            <h1 className="text-3xl font-semibold text-gray-900 mt-1">Create a run</h1>
            <p className="text-gray-600 mt-2 max-w-2xl">
              Upload your predictions, select the ground truth column, and run the evaluation with scikit-learn under the hood.
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
        <div className="grid gap-4 sm:grid-cols-2">
          {evaluationModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => mode.state === "live" && setSelectedMode(mode.id)}
              className={`border rounded-2xl p-4 text-left transition ${selectedMode === mode.id
                  ? "border-black bg-black text-white"
                  : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-400"
                }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">{mode.title}</h3>
                <span className="text-xs uppercase tracking-wider">{mode.state}</span>
              </div>
              <p className="text-sm mt-2 text-gray-400">{mode.description}</p>
            </button>
          ))}
        </div>

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
              Ground truth column
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
                  {Object.entries(row).slice(0, 2).map(([key, value]) => (
                    <div key={key} className="rounded-xl bg-gray-50 px-3 py-2 break-words">
                      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-gray-400">{key}</p>
                      <p className="text-xs text-gray-800">{value}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 border border-red-100 rounded-xl px-3 py-2 bg-red-50">
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
              !selectedColumns.prediction
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
