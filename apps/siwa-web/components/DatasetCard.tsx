/**
 * DatasetCard
 * A polished card for the DATA list.
 * Shows key metadata and state in a scannable format.
 */
"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import api from "../lib/api";

const CLASSIFICATION_TASKS = new Set([
  "classification",
  "multiclassification",
  "multi_label_classification",
]);

const statusTone = (status: string) => {
  switch (status) {
    case "ready":
      return "bg-green-100 text-green-700 border-green-200";
    case "invalid_config":
      return "bg-red-50 text-red-700 border-red-200";
    case "configured":
      return "bg-yellow-50 text-yellow-700 border-yellow-200";
    default:
      return "bg-gray-50 text-gray-700 border-gray-200";
  }
};

type DatasetCardProps = {
  ds: any;
  onDelete?: (id: string) => void;
  isDeleting?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
};

export default function DatasetCard({
  ds,
  onDelete,
  isDeleting,
  selected = false,
  onToggleSelect
}: DatasetCardProps) {
  const { data: session } = useSession();
  const progress = Math.min(Math.max(ds.annotation_progress ?? 0, 0), 100);
  const canExport = session?.role === "owner" || session?.role === "admin";
  const canAnnotate = ds.access_level === "editor";
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const taskType = (ds.task_type ?? "").toLowerCase();
  const isClassificationTask = CLASSIFICATION_TASKS.has(taskType);
  const isDetectionTask = taskType === "detection";
  const isCaptioningTask = taskType === "captioning";
  const isGroundingTask = taskType === "grounding";
  const isTextDataset = (ds.modality ?? "").toLowerCase() === "text";
  const isTextClassification =
    isTextDataset &&
    (taskType === "text_classification" || taskType === "classification");
  const isTextSummarization = isTextDataset && taskType === "text_summarization";
  const isTextAnnotationTask = isTextClassification || isTextSummarization;
  const basePath = isTextDataset ? "/text-datasets" : "/datasets";
  const annotateHref = isDetectionTask
    ? `/datasets/${ds.id}/annotate/detection`
    : isGroundingTask
      ? `/datasets/${ds.id}/annotate/grounding`
      : isTextAnnotationTask
        ? `/text-datasets/${ds.id}/annotate/text-classification`
        : isCaptioningTask
          ? `/datasets/${ds.id}/annotate/captioning`
          : `/datasets/${ds.id}/annotate/classification`;

  const handleExport = async () => {
    const endpoint = isDetectionTask
      ? `/datasets/${ds.id}/annotations/detection/export`
      : isGroundingTask
        ? `/datasets/${ds.id}/annotations/grounding/export`
        : isClassificationTask
          ? `/datasets/${ds.id}/annotations/classification/export`
          : isCaptioningTask
            ? `/datasets/${ds.id}/annotations/captioning/export`
            : isTextAnnotationTask
              ? `/datasets/${ds.id}/annotations/text-classification/export`
              : null;
    if (!endpoint) return;
    try {
      const res = await api.get(endpoint);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const suffix = isDetectionTask
        ? "detections"
        : isGroundingTask
          ? "grounding"
          : isCaptioningTask
            ? "captions"
            : "annotations";
      const safeName = (ds.name || suffix).replace(/\s+/g, "_");
      a.download = `${safeName}_${suffix}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed", e);
      alert("Failed to export annotations. Please try again.");
    }
  };

  return (
    <div
      className={`bg-white border rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow ${selected ? "ring-2 ring-blue-500 border-blue-500" : ""
        }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {onToggleSelect && (
            <input
              type="checkbox"
              className="mt-1.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={selected}
              onChange={() => onToggleSelect(ds.id)}
            />
          )}
          <div className="min-w-0">
            <h3 className="font-semibold text-lg truncate">{ds.name}</h3>
            <p className="text-sm text-gray-600 mt-0.5">
              {ds.modality?.toUpperCase()} • {ds.task_type ?? "n/a"}
            </p>
          </div>
        </div>

        <span
          className={
            "text-xs font-semibold px-2 py-1 rounded-full border whitespace-nowrap " +
            statusTone(ds.status)
          }
        >
          {String(ds.status).replace(/_/g, " ").toUpperCase()}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-600">
        <div>
          <div className="text-gray-400">Annotation</div>
          <div className="font-medium">{ds.annotation_status}</div>
        </div>
        <div>
          <div className="text-gray-400">Source</div>
          <div className="font-medium truncate">
            {ds.data_source?.type}
          </div>
        </div>
        <div>
          <div className="text-gray-400">Items</div>
          <div className="font-medium">
            {ds.asset_count ?? "—"}
          </div>
        </div>
      </div>

      {!!ds.tags?.length && (
        <div className="mt-3 flex flex-wrap gap-1">
          {ds.tags.slice(0, 5).map((t: string) => (
            <span key={t} className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="w-12 h-12 relative">
          <svg className="w-12 h-12">
            <circle
              cx="24"
              cy="24"
              r="20"
              className="text-gray-200"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
            />
            <circle
              cx="24"
              cy="24"
              r="20"
              className="text-green-600"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={circumference - (progress / 100) * circumference}
              transform="rotate(-90 24 24)"
              strokeLinecap="round"
            />
            <text
              x="24"
              y="28"
              textAnchor="middle"
              className="text-[10px] font-semibold text-gray-800"
            >
              {progress}%
            </text>
          </svg>
        </div>
        <div className="text-xs text-gray-600">Annotation progress</div>
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          href={`${basePath}/${ds.id}`}
          className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
        >
          Edit Details
        </Link>

        <Link
          href={`${basePath}/${ds.id}/explore/`}
          className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
        >
          Explore
        </Link>

        <div className="flex gap-2">
          {(isClassificationTask ||
            isDetectionTask ||
            isCaptioningTask ||
            isTextAnnotationTask ||
            isGroundingTask) && (
              <>
                {canAnnotate && (
                  <Link
                    href={annotateHref}
                    className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
                  >
                    Annotate
                  </Link>
                )}
                {canExport && (
                  <button
                    type="button"
                    className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 text-left leading-tight"
                    onClick={handleExport}
                  >
                    <span>Export JSON</span>
                    {isDetectionTask && (
                      <span className="block text-[10px] text-gray-500 mt-0.5">
                        COCO format
                      </span>
                    )}
                  </button>
                )}
              </>
            )}

          {onDelete && (
            <button
              type="button"
              className={`text-sm px-3 py-1.5 rounded-md border ${isDeleting
                  ? "bg-red-50 border-red-100 text-red-300 cursor-not-allowed"
                  : "border-red-200 text-red-600 hover:bg-red-50"
                }`}
              disabled={isDeleting}
              onClick={() => onDelete(ds.id)}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
