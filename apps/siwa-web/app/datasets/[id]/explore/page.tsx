/**
 * Explore page
 *
 * Features:
 * - Header: total files + root path
 * - Toggle thumbnails grid vs list view
 * - Pagination
 * - Click item to open quick-view modal
 * - Works for both images and DICOM via backend thumb/view endpoints
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import api from "../../../../lib/api";
import Link from "next/link";

const CLASSIFICATION_TASKS = new Set([
  "classification",
  "multiclassification",
  "multi_label_classification",
]);

type ExploreResp = {
  dataset_id: string;
  root_path: string;
  pattern: string;
  total: number;
  overall_total?: number;
  offset: number;
  limit: number;
  files: string[];
  class_counts?: Record<string, number>;
  class_filter?: string | null;
};

type TextRecord = {
  path: string;
  caption: string;
  status: "labeled" | "skipped" | "unlabeled";
};

type TextRecordsResp = {
  dataset_id: string;
  root_path: string;
  total: number;
  offset: number;
  limit: number;
  records: TextRecord[];
};

export default function ExplorePage() {
  const { status } = useSession();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const datasetId = id || "";

  const [view, setView] = useState<"grid" | "list">("grid");
  const [data, setData] = useState<ExploreResp | null>(null);
  const [textData, setTextData] = useState<TextRecordsResp | null>(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [dataset, setDataset] = useState<any | null>(null);
  const [classFilter, setClassFilter] = useState("");
  const [textSearch, setTextSearch] = useState("");
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});
  const limit = 200;

  const datasetTask = (dataset?.task_type ?? "").toLowerCase();
  const isCaptioningTask = datasetTask === "captioning";
  const isGroundingTask = datasetTask === "grounding";
  const isTextAnnotationTask = isCaptioningTask || isGroundingTask;
  const isClassificationTask = CLASSIFICATION_TASKS.has(datasetTask);
  const isDetectionTask = datasetTask === "detection";

  // quick view modal
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      !datasetId ||
      !dataset ||
      isTextAnnotationTask
    )
      return;
    setError("");
    api
      .get(`/datasets/${datasetId}/files`, {
        params: { offset, limit, class_name: classFilter || undefined },
      })
      .then((res) => {
        setData(res.data);
        setFileStatuses(res.data.file_statuses || {});
      })
      .catch((e) =>
        setError(e?.response?.data?.detail ?? "Failed to load files")
      );
  }, [status, datasetId, offset, classFilter, dataset, isTextAnnotationTask]);

  useEffect(() => {
    if (status !== "authenticated" || !datasetId) return;
    api
      .get(`/datasets/${datasetId}`)
      .then((res) => {
        const ds = res.data;
        if ((ds.modality ?? "").toLowerCase() === "text") {
          router.replace(`/text-datasets/${datasetId}/explore/`);
          return;
        }
        setDataset(ds);
      })
      .catch(() => {});
  }, [status, datasetId, router]);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      !datasetId ||
      !dataset ||
      !isTextAnnotationTask
    )
      return;
    setError("");
    const endpoint = isGroundingTask ? "grounding" : "captioning";
    api
      .get(`/datasets/${datasetId}/annotations/${endpoint}/records`, {
        params: {
          offset,
          limit,
          search: textSearch.trim() || undefined,
        },
      })
      .then((res) => setTextData(res.data))
      .catch((e) =>
        setError(e?.response?.data?.detail ?? "Failed to load records")
      );
  }, [
    status,
    datasetId,
    dataset,
    offset,
    textSearch,
    limit,
    isTextAnnotationTask,
    isGroundingTask,
  ]);

  const totalItems = isTextAnnotationTask
    ? textData?.total ?? 0
    : data?.total ?? 0;
  const totalPages = totalItems ? Math.max(1, Math.ceil(totalItems / limit)) : 1;
  const currentPage = Math.floor(offset / limit) + 1;

  const classEntries = useMemo(() => {
    if (!data?.class_counts) return [];
    const entries = Object.entries(data.class_counts);
    const ordered = dataset?.class_names ?? [];
    return entries.sort((a, b) => {
      const ai = ordered.indexOf(a[0]);
      const bi = ordered.indexOf(b[0]);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a[0].localeCompare(b[0]);
    });
  }, [data?.class_counts, dataset?.class_names]);

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

  const canAnnotate =
    (isClassificationTask || isDetectionTask || isTextAnnotationTask) &&
    dataset?.access_level === "editor";
  const annotateHref = isDetectionTask
    ? `/datasets/${datasetId}/annotate/detection`
    : isGroundingTask
    ? `/datasets/${datasetId}/annotate/grounding`
    : isCaptioningTask
    ? `/datasets/${datasetId}/annotate/captioning`
    : `/datasets/${datasetId}/annotate/classification`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
          {/* <div className="flex gap-2 text-xs text-blue-600 mt-1">
            <Link href={`/datasets/${datasetId}/annotate/classification`} className="underline">
              Annotate
            </Link>
            <span className="text-gray-400">·</span>
            <Link href="/datasets" className="underline">
              Datasets
            </Link>
          </div> */}
          {isTextAnnotationTask && textData && (
            <p className="text-sm text-gray-600 mt-1">
              Showing{" "}
              <span className="font-medium text-gray-900">
                {textData.total}
              </span>{" "}
              items in{" "}
              <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                {textData.root_path}
              </span>
            </p>
          )}
          {!isTextAnnotationTask && data && (
            <p className="text-sm text-gray-600 mt-1">
              Showing{" "}
              <span className="font-medium text-gray-900">{data.total}</span>{" "}
              {classFilter ? (
                <>
                  items for class <span className="font-medium">{classFilter}</span> out of{" "}
                  <span className="font-medium">{data.overall_total ?? data.total}</span>
                </>
              ) : (
                <>
                  files out of{" "}
                  <span className="font-medium">{data.overall_total ?? data.total}</span>
                </>
              )}{" "}
              in{" "}
              <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                {data.root_path}
              </span>
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {canAnnotate && (
            <Link
              href={annotateHref}
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
            >
              Annotate
            </Link>
          )}
          {!isTextAnnotationTask && (
            <>
              <button
                className={`text-sm px-3 py-1.5 rounded-md border ${
                  view === "grid"
                    ? "bg-black text-white border-black"
                    : "hover:bg-gray-50"
                }`}
                onClick={() => setView("grid")}
              >
                Thumbnails
              </button>
              <button
                className={`text-sm px-3 py-1.5 rounded-md border ${
                  view === "list"
                    ? "bg-black text-white border-black"
                    : "hover:bg-gray-50"
                }`}
                onClick={() => setView("list")}
              >
                List
              </button>
            </>
          )}
        </div>
      </div>

      {isTextAnnotationTask && (
        <div className="bg-white border rounded-xl p-3 flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <input
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
            placeholder="Search text or filenames…"
            value={textSearch}
            onChange={(e) => {
              setTextSearch(e.target.value);
              setOffset(0);
            }}
          />
          {textData?.root_path && (
            <div className="text-xs text-gray-500">
              Root:{" "}
              <span className="font-mono">{textData.root_path}</span>
            </div>
          )}
        </div>
      )}

      {isClassificationTask && classEntries.length > 0 && (
        <div className="bg-white border rounded-xl p-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Classes
          </span>
          <button
            className={`text-xs px-3 py-1.5 rounded-full border ${
              !classFilter ? "bg-black text-white border-black" : "hover:bg-gray-50"
            }`}
            onClick={() => {
              setOffset(0);
              setClassFilter("");
            }}
          >
            All ({data?.overall_total ?? data?.total ?? 0})
          </button>
          {classEntries.map(([cls, count]) => (
            <button
              key={cls}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                classFilter === cls
                  ? "bg-black text-white border-black"
                  : "hover:bg-gray-50"
              }`}
              onClick={() => {
                setOffset(0);
                setClassFilter((prev) => (prev === cls ? "" : cls));
              }}
            >
              {cls} ({count})
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && !isTextAnnotationTask && !data && (
        <p className="text-sm text-gray-600">Loading files…</p>
      )}
      {!error && isTextAnnotationTask && !textData && (
        <p className="text-sm text-gray-600">Loading records…</p>
      )}

      {isTextAnnotationTask && textData && (
        <div className="bg-white border rounded-xl overflow-hidden divide-y">
          {textData.records.length === 0 ? (
            <p className="text-sm text-gray-600 p-4">No items found.</p>
          ) : (
            textData.records.map((record) => {
              const thumbUrl = `${process.env.NEXT_PUBLIC_API_URL}/datasets/${datasetId}/thumb?path=${encodeURIComponent(
                record.path
              )}`;
              const fileName = record.path.split("/").pop();
              const isLabeled = record.status === "labeled";
              return (
                <div
                  key={record.path}
                  className="grid gap-4 p-4 md:grid-cols-[220px,1fr]"
                >
                  <button
                    onClick={() => setSelectedPath(record.path)}
                    className="text-left"
                  >
                    <div className="relative aspect-video rounded-lg overflow-hidden border bg-gray-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbUrl}
                        alt={fileName ?? record.path}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {isLabeled && (
                        <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-600 text-white text-[10px]">
                          ✓
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 mt-2 truncate">
                      {fileName}
                    </div>
                  </button>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Text
                    </div>
                    {record.caption ? (
                      <p className="text-sm text-gray-800 whitespace-pre-wrap mt-1">
                        {record.caption}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-400 italic mt-1">
                        No text yet.
                      </p>
                    )}
                    <div className="text-xs text-gray-500 mt-3">
                      Status:{" "}
                      <span className="font-medium text-gray-700">
                        {record.status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Body: grid */}
          {data && view === "grid" && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {data.files.map((p) => {
                const thumbUrl = `${process.env.NEXT_PUBLIC_API_URL}/datasets/${datasetId}/thumb?path=${encodeURIComponent(
                  p
                )}`;
                const fileName = p.split("/").pop();
                const status = fileStatuses[p] || "unlabeled";
                const isLabeled = status === "labeled";

                return (
                  <button
                    key={p}
                    onClick={() => setSelectedPath(p)}
                    className="bg-white border rounded-xl overflow-hidden hover:shadow-md transition-shadow text-left"
                  >
                    <div className="relative aspect-square bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbUrl}
                        alt={fileName}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {isLabeled && (
                        <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-600 text-white text-[10px]">
                          ✓
                        </span>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-xs text-gray-700 truncate">
                        {fileName}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

      {/* Body: list */}
      {data && view === "list" && (
            <div className="bg-white border rounded-xl divide-y">
              {data.files.map((p) => {
                const fileName = p.split("/").pop();
                const status = fileStatuses[p] || "unlabeled";
                const isLabeled = status === "labeled";
                return (
                  <button
                    key={p}
                    onClick={() => setSelectedPath(p)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {fileName}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{p}</div>
                    </div>
                    <div className="text-xs text-gray-400 ml-3">Quick view</div>
                  </button>
                );
              })}
            </div>
      )}

      {/* Pagination */}
      {((!isTextAnnotationTask && data) || (isTextAnnotationTask && textData)) &&
        totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
          >
            Prev
          </button>
          <div className="text-sm text-gray-600">
            Page {currentPage} / {totalPages}
          </div>
          <button
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= totalItems}
          >
            Next
          </button>
        </div>
      )}

      {/* Quick view modal */}
      {selectedPath && (
        <QuickViewModal
          datasetId={datasetId}
          path={selectedPath}
          onClose={() => setSelectedPath(null)}
        />
      )}
    </div>
  );
}

function QuickViewModal({
  datasetId,
  path,
  onClose,
}: {
  datasetId: string;
  path: string;
  onClose: () => void;
}) {
  const viewUrl = `${process.env.NEXT_PUBLIC_API_URL}/datasets/${datasetId}/view?path=${encodeURIComponent(
    path
  )}`;
  const fileName = path.split("/").pop();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl border max-w-4xl w-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="text-sm font-medium truncate">{fileName}</div>
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <div className="bg-gray-100 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewUrl}
            alt={fileName}
            className="max-h-[80vh] w-auto object-contain"
          />
        </div>

        <div className="px-4 py-3 border-t text-xs text-gray-600 font-mono truncate">
          {path}
        </div>
      </div>
    </div>
  );
}
