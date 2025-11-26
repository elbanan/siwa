/**
 * Text classification annotator (text datasets).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import api from "../../../../../lib/api";

type Summary = {
  total: number;
  labeled: number;
  skipped: number;
  unlabeled: number;
  by_user: Record<string, number>;
};

type TextRow = {
  id: string;
  text: string;
  label: string;
  status: string;
  original_label?: string;
  extra_columns?: Record<string, any>;
  [key: string]: any;
};

export default function TextClassificationAnnotatePage() {
  const { status } = useSession();
  const { id } = useParams<{ id: string }>();
  const datasetId = id || "";

  const [dataset, setDataset] = useState<any | null>(null);
  const [rows, setRows] = useState<TextRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [textValue, setTextValue] = useState("");
  const [labelValue, setLabelValue] = useState("");
  const [itemStatus, setItemStatus] = useState<"labeled" | "unlabeled" | "skipped">(
    "unlabeled"
  );
  const [saving, setSaving] = useState(false);
  const [onlyUnlabeled, setOnlyUnlabeled] = useState(false);
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    let base = rows;
    if (onlyUnlabeled) {
      base = base.filter((row) => row.status !== "labeled");
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter(
        (row) =>
          row.text.toLowerCase().includes(q) ||
          row.label.toLowerCase().includes(q)
      );
    }
    return base;
  }, [rows, onlyUnlabeled, search]);

  useEffect(() => {
    if (status !== "authenticated" || !datasetId) return;
    api
      .get(`/datasets/${datasetId}`)
      .then((res) => setDataset(res.data))
      .catch(() => {});
  }, [status, datasetId]);

  const fetchRows = () => {
    api
      .get(`/datasets/${datasetId}/text-rows`, { params: { offset: 0, limit: 100000 } })
      .then((res) => setRows(res.data.rows))
      .catch(() => setRows([]));
  };

  const fetchSummary = () => {
    api
      .get(`/datasets/${datasetId}/annotations/text-classification/summary`)
      .then((res) => setSummary(res.data))
      .catch(() => {});
  };

  useEffect(() => {
    if (status !== "authenticated" || !datasetId) return;
    fetchRows();
    fetchSummary();
  }, [status, datasetId]);

  useEffect(() => {
    if (!filteredRows.length) {
      setCurrentIndex(0);
      setTextValue("");
      setLabelValue("");
      setItemStatus("unlabeled");
      return;
    }
    const row = filteredRows[currentIndex] ?? filteredRows[0];
    setTextValue(row.text);
    setLabelValue(row.label);
    setItemStatus(row.status as "labeled" | "unlabeled" | "skipped");
    setCurrentIndex(filteredRows.indexOf(row));
  }, [filteredRows, currentIndex]);

  const updateRowStatus = (recordId: string, label: string, status: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === recordId ? { ...row, label, status } : row
      )
    );
  };

  const saveAnnotation = async (
    nextIndex?: number,
    newStatus?: "labeled" | "skipped" | "unlabeled"
  ) => {
    if (!filteredRows.length) return;
    const row = filteredRows[currentIndex];
    if (!row) return;
    setSaving(true);
    try {
      await api.post(`/datasets/${datasetId}/annotations/text-classification`, {
        record_id: row.id,
        text: textValue,
        label: labelValue,
        status: newStatus ?? (labelValue ? "labeled" : "unlabeled"),
      });
      updateRowStatus(row.id, labelValue, newStatus ?? (labelValue ? "labeled" : "unlabeled"));
      await fetchSummary();
      if (typeof nextIndex === "number") {
        setCurrentIndex(Math.min(Math.max(nextIndex, 0), filteredRows.length - 1));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const datasetTask = dataset?.task_type;
  const isSummarization = datasetTask === "text_summarization";
  const classes: string[] = isSummarization ? [] : (dataset?.class_names ?? []);
  const extraColumns =
    (dataset?.ds_metadata?.extra_text_columns as string[] | undefined) ?? [];
  const labelColumn =
    (dataset?.data_source?.config?.label_column as string | undefined)?.trim() || "";
  const filteredExtraColumns = extraColumns;
  const idColumn =
    (dataset?.data_source?.config?.id_column as string | undefined)?.trim() || "";
  const annotationValueLabel = isSummarization ? "Summary" : "Label";
  const annotationPlaceholder = isSummarization ? "Enter summary" : "Enter label";
  const clearButtonText = isSummarization ? "Clear summary" : "Clear label";
  const searchPlaceholder = isSummarization
    ? "Search text or summary…"
    : "Search text…";

  const valueForColumn = (row: TextRow | undefined, column: string) => {
    if (!row) return "—";
    return (
      row[column] ??
      row?.extra_columns?.[column] ??
      row?.original_row?.[column] ??
      "—"
    );
  };

  const displayId = (row: TextRow | undefined) => {
    if (!row) return "";
    if (idColumn) {
      const val = valueForColumn(row, idColumn);
      if (val !== "—") return String(val);
    }
    return row.id;
  };

  if (status === "unauthenticated") {
    return (
      <div className="bg-white border rounded-2xl p-10 text-center">
        <h1 className="text-xl font-semibold">Sign in required</h1>
        <Link href="/login" className="underline text-sm">
          Sign in
        </Link>
      </div>
    );
  }

  if (!dataset || !rows.length) {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center text-sm text-gray-600">
        {rows.length === 0 ? "No rows found in CSV." : "Loading annotator…"}
      </div>
    );
  }

  const row = filteredRows[currentIndex];

  return (
    <div className="space-y-3">
      <div className="bg-white border rounded-2xl p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">Dataset</div>
            <div className="font-semibold text-lg">{dataset.name}</div>
            <div className="text-xs text-gray-500 mt-1">
              CSV: <span className="font-mono">{dataset.data_source?.config?.path}</span>
            </div>
            <div className="flex gap-2 text-xs text-blue-600 mt-2">
              <Link href={`/text-datasets/${datasetId}/explore/`} className="underline">
                Explore
              </Link>
              <span className="text-gray-400">·</span>
              <Link
                href={`/text-datasets/${datasetId}/annotations/text-classification/summary`}
                className="underline"
              >
                Summary
              </Link>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">
              Labeled {summary?.labeled ?? 0} / {summary?.total ?? rows.length}
            </div>
            <div className="w-56 h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-green-600"
                style={{
                  width: summary?.total
                    ? `${Math.min(
                        100,
                        Math.floor(
                          ((summary?.labeled ?? 0) / Math.max(summary?.total ?? 1, 1)) *
                            100
                        )
                      )}%`
                    : "0%",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,1.5fr)] gap-3">
        {/* Left: controls + big text box */}
        <div className="bg-white border rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-gray-500">
              {displayId(row)} • {currentIndex + 1} / {filteredRows.length} • {itemStatus}
            </div>
            <div className="flex gap-2 text-xs">
              <input
                className="border rounded-md px-3 py-1 text-sm"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyUnlabeled}
                  onChange={(e) => {
                    setOnlyUnlabeled(e.target.checked);
                    setCurrentIndex(0);
                  }}
                />
                Show unlabeled only
              </label>
            </div>
          </div>

          {/* Controls and labels above text box */}
          {!isSummarization && (
            <div className="space-y-2">
              <label className="text-sm font-medium">{annotationValueLabel}</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={labelValue}
                onChange={(e) => setLabelValue(e.target.value)}
                placeholder={annotationPlaceholder}
              />
              {classes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {classes.map((cls) => (
                    <button
                      key={cls}
                      className={`text-xs px-3 py-1.5 rounded-full border ${
                        labelValue === cls
                          ? "bg-black text-white border-black"
                          : "hover:bg-gray-50"
                      }`}
                      type="button"
                      onClick={() => setLabelValue(cls)}
                    >
                      {cls}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {filteredExtraColumns.length > 0 && row && (
            <div className="border rounded-lg p-3 bg-gray-50 space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Additional columns
              </div>
              <div className="divide-y text-sm">
                {filteredExtraColumns.map((col) => {
                  const val = valueForColumn(row, col);
                  return (
                    <div key={col} className="py-1">
                      <div className="text-xs text-gray-500">{col}</div>
                      <div className="text-gray-800 whitespace-pre-wrap">
                        {val === "—" ? <span className="text-gray-400">—</span> : String(val)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Main text input */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Text
            </div>
            <textarea
              className="w-full border rounded-lg px-3 py-3 text-sm min-h-[320px] md:min-h-[400px]"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
            />
          </div>

          {isSummarization && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Reference summary
              </div>
              <textarea
                className="w-full border rounded-lg px-3 py-3 text-sm min-h-[240px] bg-white"
                value={labelValue}
                onChange={(e) => setLabelValue(e.target.value)}
                placeholder={annotationPlaceholder}
              />
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <button
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
              disabled={currentIndex === 0}
            >
              Prev
            </button>
            <button
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
              onClick={() =>
                setCurrentIndex((idx) =>
                  Math.min(filteredRows.length - 1, idx + 1)
                )
              }
              disabled={currentIndex >= filteredRows.length - 1}
            >
              Next
            </button>
            <button
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
              onClick={() => {
                setLabelValue("");
                setItemStatus("unlabeled");
              }}
            >
              {clearButtonText}
            </button>
            <button
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
              onClick={() => saveAnnotation(undefined, "skipped")}
              disabled={saving}
            >
              Skip
            </button>
            <button
              className="text-sm px-3 py-1.5 rounded-md bg-black text-white hover:bg-gray-800 disabled:opacity-50"
              onClick={() =>
                saveAnnotation(
                  Math.min(currentIndex + 1, filteredRows.length - 1),
                  labelValue ? "labeled" : "unlabeled"
                )
              }
              disabled={saving}
            >
              Save & Next
            </button>
          </div>
        </div>

        {/* Right: rows list, single column */}
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <div className="font-semibold text-sm mb-2">Rows</div>
          <div className="flex flex-col gap-2 max-h-[100vh] overflow-auto pr-1">
            {filteredRows.map((r, idx) => {
              const isActive = idx === currentIndex;
              const isLabeled = r.status === "labeled";
              const statusStyles = isLabeled
                ? "border-green-300 bg-green-50"
                : "border-gray-200";
              return (
                <button
                  key={r.id}
                  onClick={() => setCurrentIndex(idx)}
                  className={`border rounded-md px-3 py-2 text-left text-xs flex items-center justify-between gap-2 ${
                    isActive ? "border-black bg-gray-50" : statusStyles + " hover:bg-gray-50"
                  }`}
                >
                  <div className="font-mono text-xs text-gray-600 truncate">
                    #{idx + 1} • {displayId(r)}
                  </div>
                  {isLabeled && <span className="text-green-600 text-xs">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
