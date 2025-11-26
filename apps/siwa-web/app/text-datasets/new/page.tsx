/**
 * New Text Dataset form (separate workflow from image datasets).
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "../../../lib/api";
import { TEXT_TASK_OPTIONS } from "../../../lib/datasetOptions";
import FileBrowser from "../../../components/FileBrowser";

export default function NewTextDatasetPage() {
  const router = useRouter();

  const [name, setName] = useState("New Text Dataset");
  const [nameEdited, setNameEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState("");
  const [classNamesText, setClassNamesText] = useState("");

  const [textDataPath, setTextDataPath] = useState("");
  const [textDataTextColumn, setTextDataTextColumn] = useState("");
  const [textDataLabelColumn, setTextDataLabelColumn] = useState("");
  const [textDataIdColumn, setTextDataIdColumn] = useState("");
  const [customIndexEnabled, setCustomIndexEnabled] = useState(false);
  const [textCsvColumns, setTextCsvColumns] = useState<string[]>([]);
  const [textCsvColumnsError, setTextCsvColumnsError] = useState("");
  const [loadingTextColumns, setLoadingTextColumns] = useState(false);
  const [extraColumns, setExtraColumns] = useState<string[]>([]);

  const [hasAnnotations, setHasAnnotations] = useState(false);

  useEffect(() => {
    if (nameEdited) return;
    if (!taskType) {
      setName("New Text Dataset");
      return;
    }
    const option = TEXT_TASK_OPTIONS.find((opt) => opt.value === taskType);
    const suffix = option?.label ?? taskType;
    setName(`New ${suffix} Dataset`);
  }, [taskType, nameEdited]);

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // File browser state
  const [showCsvBrowser, setShowCsvBrowser] = useState(false);

  useEffect(() => {
    setTextCsvColumns([]);
    setTextCsvColumnsError("");
    setExtraColumns([]);
  }, [textDataPath]);

  const loadTextCsvColumns = async () => {
    if (!textDataPath.trim()) {
      setTextCsvColumnsError("Provide the CSV path first.");
      return;
    }
    setLoadingTextColumns(true);
    setTextCsvColumnsError("");
    try {
      const res = await api.post("/datasets/inspect/csv", { path: textDataPath });
      const cols = res.data?.columns ?? [];
      setTextCsvColumns(cols);
      if (!cols.length) {
        setTextCsvColumnsError("No header columns detected in CSV.");
      }
    } catch (e: any) {
      setTextCsvColumns([]);
      setTextCsvColumnsError(
        e?.response?.data?.detail ?? e?.message ?? "Failed to read CSV."
      );
    } finally {
      setLoadingTextColumns(false);
    }
  };

  const isSummarization = taskType === "text_summarization";
  const annotationColumnLabel = isSummarization
    ? "Reference summary column"
    : "Label column";
  const annotationColumnPlaceholder = isSummarization ? "reference_summary" : "label";
  const annotationColumnError = isSummarization
    ? "Select which column contains the reference summary."
    : "Select which column contains the annotation label.";

  const onCreate = async () => {
    setMsg("");
    setLoading(true);
    try {
      if (!taskType) {
        throw new Error("Task type is required.");
      }
      if (!textDataPath.trim()) {
        throw new Error("Provide the CSV file path for your text dataset.");
      }
      if (!textDataTextColumn.trim()) {
        throw new Error("Select which column contains the text.");
      }
      if (hasAnnotations && !textDataLabelColumn.trim()) {
        throw new Error(annotationColumnError);
      }

      const classNames = isSummarization
        ? []
        : classNamesText
          .split("\n")
          .map((c) => c.trim())
          .filter(Boolean);

      const res = await api.post("/datasets", {
        name,
        description,
        tags: [],
        modality: "text",
        task_type: taskType,
        data_source: {
          type: "local_csv",
          config: {
            path: textDataPath,
            text_column: textDataTextColumn,
            label_column: hasAnnotations ? textDataLabelColumn : "",
            id_column: textDataIdColumn,
          },
        },
        annotation_source: null,
        has_annotations: hasAnnotations,
        class_names: classNames,
        ds_metadata: extraColumns.length ? { extra_text_columns: extraColumns } : {},
      });

      api.post(`/datasets/${res.data.id}/validate`).catch(() => {
        console.warn("Validation job failed to start.");
      });

      router.push("/datasets");
    } catch (e: any) {
      console.error(e);
      setMsg(
        e?.response?.data?.detail ??
        e?.message ??
        "Create failed"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* File browser modal */}
      {showCsvBrowser && (
        <FileBrowser
          onSelect={(path) => {
            setTextDataPath(path);
            setShowCsvBrowser(false);
          }}
          onCancel={() => setShowCsvBrowser(false)}
          selectFiles={true}
        />
      )}

      <div className="max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New text dataset</h1>
          <p className="text-sm text-gray-600 mt-1">
            Configure a local CSV for text tasks. Looking for images?{" "}
            <button
              className="underline"
              onClick={() => router.push("/datasets/new")}
              type="button"
            >
              Go to image workflow.
            </button>
          </p>
        </div>
        <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
          <div>
            <label className="text-sm font-medium">Dataset name</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Description (optional)</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1 min-h-[80px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Task type</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
            >
              <option value="">Select task type</option>
              {TEXT_TASK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">CSV file path</label>
            <div className="flex gap-2 mt-1">
              <input
                className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="/Users/me/data/text.csv"
                value={textDataPath}
                onChange={(e) => setTextDataPath(e.target.value)}
              />
              <button
                type="button"
                className="text-sm px-3 py-2 rounded-lg border hover:bg-gray-50 whitespace-nowrap"
                onClick={() => setShowCsvBrowser(true)}
              >
                Browse
              </button>
              <button
                type="button"
                className="text-sm px-3 py-2 rounded-lg border hover:bg-gray-50"
                onClick={loadTextCsvColumns}
                disabled={loadingTextColumns}
              >
                {loadingTextColumns ? "Loading…" : "Load columns"}
              </button>
            </div>
            {textCsvColumnsError && (
              <p className="text-xs text-red-600 mt-1">{textCsvColumnsError}</p>
            )}
            {!textCsvColumnsError && textCsvColumns.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Columns detected: {textCsvColumns.join(", ")}
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">Text column</label>
            {textCsvColumns.length > 0 ? (
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={textDataTextColumn}
                onChange={(e) => setTextDataTextColumn(e.target.value)}
              >
                <option value="">Select column</option>
                {textCsvColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                placeholder="text"
                value={textDataTextColumn}
                onChange={(e) => setTextDataTextColumn(e.target.value)}
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={customIndexEnabled}
                onChange={(e) => {
                  setCustomIndexEnabled(e.target.checked);
                  if (!e.target.checked) setTextDataIdColumn("");
                }}
              />
              Replace index column
            </label>
            {customIndexEnabled && (
              <>
                {textCsvColumns.length > 0 ? (
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={textDataIdColumn}
                    onChange={(e) => setTextDataIdColumn(e.target.value)}
                  >
                    <option value="">Select column</option>
                    {textCsvColumns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-gray-500">
                    Load CSV columns to choose an index column.
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  The selected column will be used as the dataset index.
                </p>
              </>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasAnnotations}
              onChange={(e) => setHasAnnotations(e.target.checked)}
            />
            I already have annotations in this CSV
          </label>

          {hasAnnotations && (
            <div>
              <label className="text-sm font-medium">{annotationColumnLabel}</label>
              {textCsvColumns.length > 0 ? (
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  value={textDataLabelColumn}
                  onChange={(e) => setTextDataLabelColumn(e.target.value)}
                >
                  <option value="">Select column</option>
                  {textCsvColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  placeholder={annotationColumnPlaceholder}
                  value={textDataLabelColumn}
                  onChange={(e) => setTextDataLabelColumn(e.target.value)}
                />
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Additional columns to show</label>
            {textCsvColumns.length > 0 ? (
              <div className="flex flex-wrap gap-2 text-sm">
                {textCsvColumns.map((col) => (
                  <label key={col} className="inline-flex items-center gap-1 border rounded-full px-3 py-1">
                    <input
                      type="checkbox"
                      checked={extraColumns.includes(col)}
                      onChange={(e) => {
                        setExtraColumns((prev) =>
                          e.target.checked ? [...prev, col] : prev.filter((c) => c !== col)
                        );
                      }}
                    />
                    {col}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Load CSV columns to choose which extra fields to display.
              </p>
            )}
            <p className="text-xs text-gray-500">
              Selected columns appear beneath the controls in the annotator and on the explore page.
            </p>
          </div>

          {!isSummarization && (
            <div>
              <label className="text-sm font-medium">Class names (optional, one per line)</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 min-h-[120px] font-mono"
                placeholder={"e.g.\npositive\nnegative"}
                value={classNamesText}
                onChange={(e) => setClassNamesText(e.target.value)}
              />
            </div>
          )}

          {msg && <p className="text-sm text-red-600">{msg}</p>}

          <div className="flex gap-2 pt-2">
            <button
              className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 text-sm disabled:opacity-60"
              onClick={onCreate}
              disabled={
                loading ||
                !taskType ||
                !textDataPath.trim() ||
                !textDataTextColumn.trim() ||
                (hasAnnotations && !textDataLabelColumn.trim())
              }
            >
              {loading ? "Creating..." : "Create dataset"}
            </button>
            <button
              className="px-4 py-2 rounded-lg border hover:bg-gray-50 text-sm"
              onClick={() => router.push("/datasets")}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
