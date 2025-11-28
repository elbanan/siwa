/**
 * Object detection annotator.
 */
"use client";

import {
  PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

type DetectionBox = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const generateBoxId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 9);

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(Math.max(value, min), max);

export default function DetectionAnnotatePage({
}: {
  params: { id: string };
}) {
  const { id } = useParams<{ id: string }>();
  const datasetId = id || "";
  const { status } = useSession();

  const [ds, setDs] = useState<any | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});
  const [rootPath, setRootPath] = useState("");
  const [index, setIndex] = useState(0);
  const [filesLoading, setFilesLoading] = useState(true);

  const [boxes, setBoxes] = useState<DetectionBox[]>([]);
  const [itemStatus, setItemStatus] = useState<"unlabeled" | "labeled" | "skipped">(
    "unlabeled"
  );
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);

  const [jumpOpen, setJumpOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyUnlabeled, setOnlyUnlabeled] = useState(false);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null
  );
  const [draftBox, setDraftBox] = useState<DetectionBox | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageBounds, setImageBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>({ x: 0, y: 0, width: 0, height: 0 });

  const currentPath = files[index];
  const fileName = currentPath?.split("/").pop() ?? "";

  const detectionLabelMap = (ds?.annotation_source?.config?.label_map ??
    {}) as Record<string, string>;
  const classes: string[] = useMemo(() => {
    const defined = Array.isArray(ds?.class_names)
      ? (ds?.class_names as string[]).filter(Boolean)
      : [];
    if (defined.length > 0) return defined;
    const entries = Object.entries(detectionLabelMap || {});
    return entries
      .sort((a, b) => {
        const ai = Number(a[0]);
        const bi = Number(b[0]);
        if (!Number.isNaN(ai) && !Number.isNaN(bi)) {
          return ai - bi;
        }
        return a[0].localeCompare(b[0]);
      })
      .map(([, label]) => String(label))
      .filter(Boolean);
  }, [ds?.class_names, detectionLabelMap]);
  const instructions = (ds?.ds_metadata?.annotation_instructions ?? "").trim();

  useEffect(() => {
    if (!selectedLabel && classes.length > 0) {
      setSelectedLabel(classes[0]);
    }
  }, [classes, selectedLabel]);

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

  const viewUrl = currentPath
    ? `${process.env.NEXT_PUBLIC_API_URL}/datasets/${datasetId}/view?path=${encodeURIComponent(
      currentPath
    )}`
    : "";

  const thumbUrlFor = (p: string) =>
    `${process.env.NEXT_PUBLIC_API_URL}/datasets/${datasetId}/thumb?path=${encodeURIComponent(
      p
    )}`;

  const progressPct = summary
    ? summary.labeled >= summary.total && summary.total > 0
      ? 100
      : Math.floor((summary.labeled / Math.max(summary.total, 1)) * 100)
    : 0;

  const loadSummary = useCallback(async () => {
    if (!datasetId) return;
    const res = await api.get(
      `/datasets/${datasetId}/annotations/detection/summary`
    );
    setSummary(res.data);
  }, [datasetId]);

  const refreshImageBounds = useCallback(() => {
    if (!imageRef.current || !overlayRef.current) return;
    const imgRect = imageRef.current.getBoundingClientRect();
    const overlayRect = overlayRef.current.getBoundingClientRect();
    setImageBounds({
      x: imgRect.left - overlayRect.left,
      y: imgRect.top - overlayRect.top,
      width: imgRect.width,
      height: imgRect.height,
    });
  }, []);

  useEffect(() => {
    refreshImageBounds();
  }, [refreshImageBounds, viewUrl]);

  useEffect(() => {
    window.addEventListener("resize", refreshImageBounds);
    return () => window.removeEventListener("resize", refreshImageBounds);
  }, [refreshImageBounds]);

  useEffect(() => {
    if (status !== "authenticated" || !datasetId) return;
    (async () => {
      const dsRes = await api.get(`/datasets/${datasetId}`);
      setDs(dsRes.data);
      await loadSummary();
    })().catch(console.error);
  }, [status, datasetId, loadSummary]);

  useEffect(() => {
    if (status !== "authenticated" || !datasetId) return;
    setFilesLoading(true);
    const params: Record<string, any> = { offset: 0, limit: 100000 };
    if (onlyUnlabeled) params.class_name = "unlabeled";
    api
      .get(`/datasets/${datasetId}/files`, { params })
      .then((res) => {
        setFiles(res.data.files);
        setRootPath(res.data.root_path);
        setFileStatuses(res.data.file_statuses || {});
        setIndex(0);
      })
      .catch(console.error)
      .finally(() => setFilesLoading(false));
  }, [status, datasetId, onlyUnlabeled]);

  useEffect(() => {
    if (!currentPath || status !== "authenticated" || !datasetId) return;
    api
      .get(`/datasets/${datasetId}/annotations/detection`, {
        params: { path: currentPath },
      })
      .then((res) => {
        const incoming: DetectionBox[] = (res.data.boxes ?? []).map((box: any) => ({
          id: box.id || generateBoxId(),
          label: box.label,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        }));
        setBoxes(incoming);
        setItemStatus(res.data.status ?? "unlabeled");
        setSelectedBoxId(null);
      })
      .catch(() => {
        setBoxes([]);
        setItemStatus("unlabeled");
      });
  }, [status, datasetId, currentPath]);

  useEffect(() => {
    setItemStatus((prev) => {
      if (boxes.length > 0) return "labeled";
      if (prev === "skipped") return "skipped";
      return "unlabeled";
    });
  }, [boxes]);

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((p) => p.toLowerCase().includes(q));
  }, [files, search]);

  const colorForLabel = useCallback((label: string) => {
    // Use a predefined palette of distinct colors for better visual separation
    const colors = [
      "hsl(0, 70%, 55%)",    // Red
      "hsl(120, 70%, 45%)",  // Green
      "hsl(210, 70%, 55%)",  // Blue
      "hsl(45, 85%, 55%)",   // Yellow
      "hsl(280, 70%, 55%)",  // Purple
      "hsl(30, 85%, 55%)",   // Orange
      "hsl(180, 70%, 45%)",  // Cyan
      "hsl(330, 70%, 55%)",  // Pink
      "hsl(90, 60%, 45%)",   // Lime
      "hsl(260, 70%, 60%)",  // Violet
      "hsl(15, 80%, 55%)",   // Red-Orange
      "hsl(150, 65%, 45%)",  // Teal
    ];

    // Hash the label to get a consistent index
    let hash = 0;
    for (let i = 0; i < label.length; i += 1) {
      hash = label.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }, []);

  const getRelativePosition = useCallback(
    (clientX: number, clientY: number, allowOutside = false) => {
      if (!imageRef.current) return null;
      const rect = imageRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const withinX = clientX >= rect.left && clientX <= rect.right;
      const withinY = clientY >= rect.top && clientY <= rect.bottom;
      if (!allowOutside && (!withinX || !withinY)) return null;
      const rawX = (clientX - rect.left) / rect.width;
      const rawY = (clientY - rect.top) / rect.height;
      return {
        x: clamp(rawX),
        y: clamp(rawY),
      };
    },
    []
  );

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!selectedLabel) return;
    const coords = getRelativePosition(e.clientX, e.clientY);
    if (!coords) return;
    e.preventDefault();
    overlayRef.current?.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    setStartPoint(coords);
    setDraftBox({
      id: generateBoxId(),
      label: selectedLabel,
      x: coords.x,
      y: coords.y,
      width: 0,
      height: 0,
    });
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDrawing || !startPoint || !draftBox) return;
    const coords = getRelativePosition(e.clientX, e.clientY, true);
    if (!coords) return;
    e.preventDefault();
    const x1 = startPoint.x;
    const y1 = startPoint.y;
    const x2 = coords.x;
    const y2 = coords.y;
    const nextBox = {
      ...draftBox,
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x1 - x2),
      height: Math.abs(y1 - y2),
    };
    setDraftBox(nextBox);
  };

  const finishDrawing = () => {
    if (!draftBox) return;
    if (draftBox.width < 0.005 || draftBox.height < 0.005) {
      setDraftBox(null);
      setStartPoint(null);
      setIsDrawing(false);
      return;
    }
    setBoxes((prev) => [...prev, draftBox]);
    setDraftBox(null);
    setStartPoint(null);
    setIsDrawing(false);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDrawing) return;
    overlayRef.current?.releasePointerCapture(e.pointerId);
    finishDrawing();
  };

  const removeBox = (id: string) => {
    setBoxes((prev) => prev.filter((box) => box.id !== id));
    setSelectedBoxId((prev) => (prev === id ? null : prev));
  };

  const clearBoxes = () => {
    setBoxes([]);
    setSelectedBoxId(null);
  };

  const updateBoxLabel = (id: string, nextLabel: string) => {
    setBoxes((prev) =>
      prev.map((box) => (box.id === id ? { ...box, label: nextLabel } : box))
    );
  };

  const save = async (nextIndex?: number) => {
    if (!currentPath) return;
    await api.post(`/datasets/${datasetId}/annotations/detection`, {
      path: currentPath,
      status: boxes.length > 0 ? "labeled" : "unlabeled",
      boxes,
    });
    await loadSummary();
    if (typeof nextIndex === "number") {
      setIndex(nextIndex);
    }
  };

  const skip = async () => {
    if (!currentPath) return;
    setBoxes([]);
    await api.post(`/datasets/${datasetId}/annotations/detection`, {
      path: currentPath,
      status: "skipped",
      boxes: [],
    });
    setItemStatus("skipped");
    await loadSummary();
    setIndex((i) => Math.min(i + 1, files.length - 1));
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
        {onlyUnlabeled ? (
          <button
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
            onClick={() => setOnlyUnlabeled(false)}
          >
            Show all files
          </button>
        ) : (
          <Link
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 inline-block"
            href={`/datasets/${datasetId}`}
          >
            Go back
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border rounded-2xl p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-gray-500">Dataset</div>
            <div className="font-semibold text-lg">{ds.name}</div>
            <div className="text-xs text-gray-500 mt-1">
              Root: <span className="font-mono">{rootPath}</span>
            </div>
            <div className="flex gap-2 text-xs text-blue-600 mt-2 flex-wrap">
              <Link href={`/datasets/${datasetId}/explore/`} className="underline">
                Explore
              </Link>
              <span className="text-gray-400">·</span>
              <Link
                href={`/datasets/${datasetId}/annotations/detection/summary`}
                className="underline"
              >
                Summary
              </Link>
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
            <div className="mt-3 flex gap-2 justify-end flex-wrap">
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

      <div className="grid lg:grid-cols-5 gap-3">
        <div className="lg:col-span-4 bg-white border rounded-2xl p-3 shadow-sm">
          <div className="text-xs text-gray-500 mb-2">
            {fileName} • {index + 1} / {files.length} • {itemStatus}
          </div>
          <div className="relative w-full bg-gray-50 rounded-lg flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={viewUrl}
              alt={fileName}
              className="object-contain max-h-[80vh] max-w-full w-auto h-auto select-none pointer-events-none mx-auto"
              onLoad={() => {
                setDraftBox(null);
                setStartPoint(null);
                setIsDrawing(false);
                refreshImageBounds();
              }}
            />
            <div
              ref={overlayRef}
              className="absolute inset-0 cursor-crosshair"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {boxes.map((box) => (
                <div
                  key={box.id}
                  className={`absolute border-2 ${selectedBoxId === box.id ? "ring-2 ring-black" : ""
                    }`}
                  style={{
                    borderColor: colorForLabel(box.label),
                    left: `${imageBounds.x + box.x * imageBounds.width}px`,
                    top: `${imageBounds.y + box.y * imageBounds.height}px`,
                    width: `${box.width * imageBounds.width}px`,
                    height: `${box.height * imageBounds.height}px`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBoxId(box.id);
                  }}
                >
                  <div
                    className="absolute -top-5 left-0 text-[10px] px-1 py-0.5 rounded bg-black/70 text-white"
                    style={{ backgroundColor: colorForLabel(box.label) }}
                  >
                    {box.label}
                  </div>
                </div>
              ))}
              {draftBox && (
                <div
                  className="absolute border-2 border-dashed border-indigo-500 bg-indigo-500/10"
                  style={{
                    left: `${imageBounds.x + draftBox.x * imageBounds.width}px`,
                    top: `${imageBounds.y + draftBox.y * imageBounds.height}px`,
                    width: `${draftBox.width * imageBounds.width}px`,
                    height: `${draftBox.height * imageBounds.height}px`,
                  }}
                />
              )}
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {selectedLabel
              ? `Drawing as ${selectedLabel}. Click and drag on the image to add a bounding box.`
              : "Add class names in Dataset Details to start annotating."}
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-3 shadow-sm space-y-4">
          <div>
            <div className="font-semibold text-sm">Classes</div>
            <div className="text-xs text-gray-500">Select a class to draw boxes.</div>
            {classes.length === 0 && (
              <div className="text-xs text-red-600 mt-2">
                No classes defined yet. Add them in Dataset Details.
              </div>
            )}
            <div className="space-y-1 mt-2">
              {classes.map((cls) => {
                const active = cls === selectedLabel;
                return (
                  <button
                    key={cls}
                    className={`w-full text-left px-3 py-2 rounded-md border text-sm ${active ? "bg-black text-white border-black" : "hover:bg-gray-50"
                      }`}
                    onClick={() => setSelectedLabel(cls)}
                  >
                    {cls}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="font-semibold text-sm">Boxes</div>
            <div className="text-xs text-gray-500 mb-2">
              {boxes.length === 0
                ? "No boxes yet."
                : `${boxes.length} ${boxes.length === 1 ? "box" : "boxes"} added.`}
            </div>
            <div className="space-y-2 max-h-72 overflow-auto pr-1">
              {boxes.map((box) => (
                <div
                  key={box.id}
                  className={`border rounded-lg p-2 text-xs space-y-1 ${selectedBoxId === box.id
                    ? "border-black bg-gray-50"
                    : "border-gray-200"
                    }`}
                  onClick={() => setSelectedBoxId(box.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <select
                      className="flex-1 border rounded px-2 py-1"
                      value={box.label}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateBoxLabel(box.id, e.target.value)}
                    >
                      {classes.length === 0 && (
                        <option value={box.label}>{box.label}</option>
                      )}
                      {classes.map((cls) => (
                        <option key={cls} value={cls}>
                          {cls}
                        </option>
                      ))}
                    </select>
                    <button
                      className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBox(box.id);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-500">
                    x:{(box.x * 100).toFixed(1)}% · y:{(box.y * 100).toFixed(1)}% · w:
                    {(box.width * 100).toFixed(1)}% · h:
                    {(box.height * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
            {boxes.length > 0 && (
              <button
                className="mt-2 w-full text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
                onClick={clearBoxes}
              >
                Clear boxes
              </button>
            )}
          </div>

          <div className="flex gap-2">
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
        </div>
      </div>

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
