/**
 * Image Classification Annotator
 *
 * - Shows current image (jpg/png/dcm)
 * - Right-side class list
 * - Single-label or Multi-label depending on ds.ds_metadata.multi_label
 * - Progress bar from /summary
 * - Prev/Next + Skip
 * - Jump drawer (global navigation)
 */

"use client";

import { useEffect, useMemo, useState, PointerEvent, useCallback } from "react";
import { useSession } from "next-auth/react";
import api from "../../../../../lib/api";
import Link from "next/link";
import { useParams } from "next/navigation";

type Summary = {
  total: number;
  labeled: number;
  skipped: number;
  unlabeled: number;
  by_user: Record<string, number>;
};

export default function ClassificationAnnotatePage({
  params,
}: {
  params: { id: string };
}) {
  const { status } = useSession();
  const { id } = useParams<{ id: string }>();
  const datasetId = id || "";

  const [files, setFiles] = useState<string[]>([]);
  const [rootPath, setRootPath] = useState("");
  const [index, setIndex] = useState(0);
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});

  const [ds, setDs] = useState<any | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [labels, setLabels] = useState<string[]>([]);
  const [itemStatus, setItemStatus] = useState<"unlabeled" | "labeled" | "skipped">(
    "unlabeled"
  );
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [lastPointer, setLastPointer] = useState<{ x: number; y: number } | null>(
    null
  );

  const [jumpOpen, setJumpOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyUnlabeled, setOnlyUnlabeled] = useState(false);
  const [filesLoading, setFilesLoading] = useState(true);

  const currentPath = files[index];

  const taskType = ds?.task_type ?? "";
  const multiLabelFlag = ds?.ds_metadata?.multi_label;
  const multiLabel =
    typeof multiLabelFlag === "boolean"
      ? multiLabelFlag
      : ["multiclassification", "multi_label_classification"].includes(taskType);
  const instructions = (ds?.ds_metadata?.annotation_instructions ?? "").trim();

  const loadSummary = useCallback(async () => {
    if (!datasetId) return;
    const res = await api.get(
      `/datasets/${datasetId}/annotations/classification/summary`
    );
    setSummary(res.data);
  }, [datasetId]);

  // load dataset + summary
  useEffect(() => {
    if (status !== "authenticated" || !datasetId) return;

    (async () => {
      const dsRes = await api.get(`/datasets/${datasetId}`);
      setDs(dsRes.data);

      await loadSummary();
    })().catch(console.error);
  }, [status, datasetId, loadSummary]);

  // load files (optionally filtered to unlabeled only)
  useEffect(() => {
    if (status !== "authenticated" || !datasetId) return;
    setFilesLoading(true);
    const params: Record<string, any> = { offset: 0, limit: 100000 };
    if (onlyUnlabeled) params.class_name = "unlabeled";
    api
      .get(`/datasets/${datasetId}/files`, { params })
      .then((filesRes) => {
        setFiles(filesRes.data.files);
        setRootPath(filesRes.data.root_path);
        setFileStatuses(filesRes.data.file_statuses || {});
        setIndex(0);
      })
      .catch(console.error)
      .finally(() => setFilesLoading(false));
  }, [status, datasetId, onlyUnlabeled]);

  // load annotation for current file
  useEffect(() => {
    if (!currentPath || status !== "authenticated" || !datasetId) return;
    api
      .get(`/datasets/${datasetId}/annotations/classification`, {
        params: { path: currentPath },
      })
      .then((res) => {
        setLabels(res.data.labels ?? []);
        setItemStatus(res.data.status ?? "unlabeled");
      })
      .catch(() => {
        setLabels([]);
        setItemStatus("unlabeled");
      });
  }, [status, datasetId, currentPath]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(files.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [files.length]);

  const progressPct = summary
    ? summary.labeled >= summary.total && summary.total > 0
      ? 100
      : Math.floor((summary.labeled / Math.max(summary.total, 1)) * 100)
    : 0;

  const classes: string[] = ds?.class_names ?? [];

  const viewUrl = currentPath
    ? `${process.env.NEXT_PUBLIC_API_URL}/datasets/${datasetId}/view?path=${encodeURIComponent(
      currentPath
    )}`
    : "";

  const thumbUrlFor = (p: string) =>
    `${process.env.NEXT_PUBLIC_API_URL}/datasets/${datasetId}/thumb?path=${encodeURIComponent(
      p
    )}`;

  const fileName = currentPath?.split("/").pop() ?? "";

  const toggleLabel = (c: string) => {
    if (!multiLabel) {
      setLabels([c]);
      return;
    }
    setLabels((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    setDragging(true);
    setLastPointer({ x: e.clientX, y: e.clientY });
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !lastPointer) return;
    const deltaX = e.clientX - lastPointer.x;
    const deltaY = e.clientY - lastPointer.y;
    setPan((prev) => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
    setLastPointer({ x: e.clientX, y: e.clientY });
  };

  const handlePointerUp = () => {
    setDragging(false);
    setLastPointer(null);
  };

  useEffect(() => {
    if (zoom <= 1) {
      setPan({ x: 0, y: 0 });
    }
  }, [zoom]);
  const save = async (nextIndex?: number) => {
    if (!currentPath) return;
    await api.post(`/datasets/${datasetId}/annotations/classification`, {
      path: currentPath,
      labels,
      status: labels.length > 0 ? "labeled" : "unlabeled",
    });

    setItemStatus(labels.length > 0 ? "labeled" : "skipped");
    await loadSummary();
    if (typeof nextIndex === "number") setIndex(nextIndex);
  };

  const skip = async () => {
    if (!currentPath) return;
    setLabels([]);
    await api.post(`/datasets/${datasetId}/annotations/classification`, {
      path: currentPath,
      labels: [],
      status: "skipped",
    });
    setItemStatus("skipped");
    await loadSummary();
    setIndex((i) => Math.min(i + 1, files.length - 1));
  };

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((p) => p.toLowerCase().includes(q));
  }, [files, search]);

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

  if (!ds || filesLoading) {
    return <div className="text-sm text-gray-600">Loading annotator…</div>;
  }

  if (files.length === 0) {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center text-sm text-gray-600 space-y-3">
        <div>
          {onlyUnlabeled
            ? "All files have been labeled. No unlabeled items left."
            : "No files available in this dataset."}
        </div>
        {onlyUnlabeled && (
          <button
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
            onClick={() => setOnlyUnlabeled(false)}
          >
            Unlabeled ONLY
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="bg-white border rounded-2xl p-4 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-gray-500">Dataset</div>
            <div className="font-semibold text-lg">{ds.name}</div>
            <div className="text-xs text-gray-500 mt-1">
              {/* Root: <span className="font-mono">{rootPath}</span> */}
            </div>
            <div className="flex gap-2 text-xs text-blue-600 mt-2">
              <Link href={`/datasets/${datasetId}/explore/`} className="underline">
                Explore
              </Link>
              <span className="text-gray-400">·</span>
              <Link
                href={`/datasets/${datasetId}/annotations/classification/summary`}
                className="underline"
              >
                Summary
              </Link>
              <span className="text-gray-400">·</span>
              {/* <Link href="/datasets" className="underline">
                Datasets
              </Link> */}
            </div>
          </div>

          <div className="text-right">
            <div className="text-sm text-gray-600">
              Labeled {summary?.labeled ?? 0} / {summary?.total ?? files.length} (
              {progressPct}%)
            </div>
            <div className="w-56 h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-green-600"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <div className="mt-3 flex gap-2 justify-end">
              <button
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
                onClick={() => setInstructionsOpen(true)}
              >
                Instructions
              </button>
              <button
                className={`text-sm px-3 py-1.5 rounded-md border ${onlyUnlabeled
                  ? "bg-black text-white border-black"
                  : "hover:bg-gray-50"
                  }`}
                onClick={() => setOnlyUnlabeled((prev) => !prev)}
              >
                {onlyUnlabeled ? "Showing unlabeled" : "Unlabeled Only"}
              </button>
              <Link
                href={`/datasets/${datasetId}/annotations/classification/summary`}
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 text-center"
              >
                View summary
              </Link>
              <button
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
                onClick={() => setJumpOpen(true)}
              >
                Jump to…
              </button>
              <button
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
                onClick={skip}
              >
                Skip
              </button>
              <button
                className="text-sm px-3 py-1.5 rounded-md bg-black text-white hover:bg-gray-800"
                onClick={() => save(Math.min(index + 1, files.length - 1))}
              >
                Save & Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="grid lg:grid-cols-5 gap-3">
        {/* Image viewer */}
        <div className="lg:col-span-4 bg-white border rounded-2xl p-3 shadow-sm">
          <div className="text-xs text-gray-500 mb-2">
            {fileName} • {index + 1} / {files.length} • {itemStatus}
          </div>
          <div
            className="relative w-full bg-gray-50 rounded-lg overflow-hidden touch-pan-y cursor-grab flex items-center justify-center"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY > 0 ? -0.1 : 0.1;
              setZoom((prev) => Math.min(3, Math.max(0.5, prev + delta)));
            }}
          >
            <div className="max-h-[80vh] max-w-full w-full flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={viewUrl}
                alt={fileName}
                className="object-contain max-h-[80vh] max-w-full w-auto h-auto"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "center",
                  transition: dragging ? "none" : "transform 0.15s ease",
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
            <span>Zoom:</span>
            <button
              className="px-2 py-1 rounded border hover:bg-gray-100"
              onClick={() => setZoom((prev) => Math.max(0.5, prev - 0.25))}
            >
              -
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              className="px-2 py-1 rounded border hover:bg-gray-100"
              onClick={() => setZoom((prev) => Math.min(2, prev + 0.25))}
            >
              +
            </button>
          </div>
        </div>

        {/* Class palette */}
        <div className="bg-white border rounded-2xl p-3 shadow-sm space-y-2">
          <div className="font-semibold text-sm">Classes</div>
          <div className="text-xs text-gray-500">
            {multiLabel ? "Multi-label" : "Single-label"}
          </div>
          {classes.length === 0 && (
            <div className="text-xs text-red-600">
              No classes set. Add class names in Dataset Details.
            </div>
          )}

          <div className="space-y-1">
            {classes.map((c) => {
              const active = labels.includes(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleLabel(c)}
                  className={`w-full text-left px-3 py-2 rounded-md border text-sm transition ${active
                    ? "bg-black text-white border-black"
                    : "hover:bg-gray-50"
                    }`}
                >
                  {c}
                </button>
              );
            })}
          </div>

          {labels.filter(l => !classes.includes(l)).length > 0 && (
            <div className="space-y-1 pt-2 border-t">
              <div className="text-xs font-medium text-gray-500">
                Extra labels (from file)
              </div>
              {labels.filter(l => !classes.includes(l)).map((c) => (
                <button
                  key={c}
                  onClick={() => toggleLabel(c)}
                  className="w-full text-left px-3 py-2 rounded-md border text-sm transition bg-black text-white border-black"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Prev/Next */}
          <div className="pt-2 flex gap-2 flex-wrap">
            <button
              className="flex-1 text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
            >
              Prev
            </button>
            <button
              className="flex-1 text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setIndex((i) => Math.min(files.length - 1, i + 1))}
              disabled={index >= files.length - 1}
            >
              Next
            </button>
          </div>
          <button
            className="w-full text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
            onClick={() => setLabels([])}
          >
            Clear selection
          </button>
        </div>
      </div>

      {/* Jump drawer */}
      {jumpOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
          <div className="w-full sm:w-[420px] h-full bg-white border-l p-4 overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Jump to image</div>
              <button
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
                onClick={() => setJumpOpen(false)}
              >
                Close
              </button>
            </div>

            <input
              className="w-full border rounded-md px-3 py-2 text-sm mt-3"
              placeholder="Search filename…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="grid grid-cols-3 gap-2 mt-3">
              {filteredFiles.slice(0, 600).map((p) => {
                const i = files.indexOf(p);
                const active = i === index;
                const status = fileStatuses[p] || "unlabeled";
                const isLabeled = status === "labeled";
                return (
                  <button
                    key={p}
                    onClick={() => {
                      setIndex(i);
                      setJumpOpen(false);
                    }}
                    className={`border rounded-md overflow-hidden ${active ? "ring-2 ring-black" : "hover:shadow-sm"
                      }`}
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbUrlFor(p)}
                        alt={p}
                        className="w-full h-24 object-cover bg-gray-100"
                      />
                      {isLabeled && (
                        <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-600 text-white text-[10px]">
                          ✓
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] p-1 truncate">
                      {p.split("/").pop()}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-xs text-gray-500 mt-3">
              Showing first 600 matches for performance.
            </div>
          </div>
        </div>
      )}

      {instructionsOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white border rounded-2xl shadow-xl p-6 relative">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold">Annotation instructions</div>
                <div className="text-xs text-gray-500">
                  Manage these in Dataset Details.
                </div>
              </div>
              <button
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
                onClick={() => setInstructionsOpen(false)}
              >
                Close
              </button>
            </div>
            {instructions ? (
              <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans bg-gray-50 border rounded-lg p-4 max-h-[60vh] overflow-auto">
                {instructions}
              </pre>
            ) : (
              <div className="text-sm text-gray-500">
                No instructions provided. Add them in Dataset Details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
