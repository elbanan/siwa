"use client";

import {
  PointerEvent,
  SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import api from "../../../../../lib/api";

type Summary = {
  total: number;
  labeled: number;
  skipped: number;
  unlabeled: number;
  by_user: Record<string, number>;
};

type GroundingPair = {
  id: string;
  text: string;
  span_start: number;
  span_end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
};

type SelectedRange = {
  start: number;
  end: number;
  text: string;
};

const generateBoxId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 9);

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(Math.max(value, min), max);

const pickColor = (idx: number) => `hsl(${(idx * 67) % 360}, 80%, 55%)`;

export default function GroundingAnnotatePage() {
  const { status } = useSession();
  const { id } = useParams<{ id: string }>();
  const datasetId = id || "";

  const [files, setFiles] = useState<string[]>([]);
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});
  const [rootPath, setRootPath] = useState("");
  const [index, setIndex] = useState(0);
  const [filesLoading, setFilesLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [onlyUnlabeled, setOnlyUnlabeled] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);

  const [ds, setDs] = useState<any | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const [caption, setCaption] = useState("");
  const [pairs, setPairs] = useState<GroundingPair[]>([]);
  const [itemStatus, setItemStatus] = useState<"unlabeled" | "labeled" | "skipped">(
    "unlabeled"
  );
  const captionRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<SelectedRange | null>(null);
  const [msg, setMsg] = useState("");

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null
  );
  const [draftBox, setDraftBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageBounds, setImageBounds] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.trim().toLowerCase();
    return files.filter((p) => p.toLowerCase().includes(q));
  }, [files, search]);

  useLayoutEffect(() => {
    if (!captionRef.current) return;
    const el = captionRef.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [caption]);

  useEffect(() => {
    setIndex(0);
  }, [filteredFiles]);

  const currentPath = filteredFiles[index];
  const fileName = currentPath?.split("/").pop() ?? "";

  const instructions = (ds?.ds_metadata?.annotation_instructions ?? "").trim();

  const loadSummary = useCallback(async () => {
    if (!datasetId) return;
    const res = await api.get(
      `/datasets/${datasetId}/annotations/grounding/summary`
    );
    setSummary(res.data);
  }, [datasetId]);

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
    if (onlyUnlabeled) {
      params.class_name = "unlabeled";
    }
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
      .get(`/datasets/${datasetId}/annotations/grounding`, {
        params: { path: currentPath },
      })
      .then((res) => {
        setCaption(res.data.caption ?? "");
        setPairs(
          (res.data.pairs ?? []).map((pair: any) => ({
            ...pair,
            span_start: Number(pair.span_start ?? 0),
            span_end: Number(pair.span_end ?? 0),
            x: Number(pair.x ?? 0),
            y: Number(pair.y ?? 0),
            width: Number(pair.width ?? 0),
            height: Number(pair.height ?? 0),
          }))
        );
        setItemStatus(res.data.status ?? "unlabeled");
        setSelectedPairId(null);
        setSelectedRange(null);
        setMsg("");
      })
      .catch(() => {
        setCaption("");
        setPairs([]);
        setItemStatus("unlabeled");
        setSelectedPairId(null);
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

  useEffect(() => {
    const handleResize = () => {
      if (!imageRef.current || !overlayRef.current) return;
      const imgRect = imageRef.current.getBoundingClientRect();
      const overlayRect = overlayRef.current.getBoundingClientRect();
      setImageBounds({
        x: imgRect.left - overlayRect.left,
        y: imgRect.top - overlayRect.top,
        width: imgRect.width,
        height: imgRect.height,
      });
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [currentPath]);

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

  const highlightSegments = useMemo(() => {
    if (!caption) {
      return [{ text: "", pairId: null, color: "" }];
    }
    const normalizedPairs = [...pairs].sort((a, b) => a.span_start - b.span_start);
    const segments: { text: string; color?: string; pairId?: string }[] = [];
    let cursor = 0;
    const textLength = caption.length;
    normalizedPairs.forEach((pair, idx) => {
      const start = Math.min(Math.max(pair.span_start, 0), textLength);
      const end = Math.min(Math.max(pair.span_end, start), textLength);
      if (start > cursor) {
        segments.push({
          text: caption.slice(cursor, start),
        });
      }
      if (end > start) {
        segments.push({
          text: caption.slice(start, end),
          color: pair.color || pickColor(idx),
          pairId: pair.id,
        });
        cursor = end;
      }
    });
    if (cursor < textLength) {
      segments.push({
        text: caption.slice(cursor),
      });
    }
    return segments;
  }, [caption, pairs]);

  const handleTextSelect = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    if (target.selectionStart === target.selectionEnd) {
      setSelectedRange(null);
      return;
    }
    const start = target.selectionStart;
    const end = target.selectionEnd;
    setSelectedRange({
      start,
      end,
      text: target.value.slice(start, end),
    });
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!imageBounds.width || !imageBounds.height) return;
    setIsDrawing(true);
    setStartPoint({ x: e.clientX, y: e.clientY });
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDrawing || !startPoint) return;
    if (!imageBounds.width || !imageBounds.height) return;
    const overlayRect = overlayRef.current?.getBoundingClientRect();
    if (!overlayRect) return;

    const startX = startPoint.x - overlayRect.left;
    const startY = startPoint.y - overlayRect.top;
    const currentX = e.clientX - overlayRect.left;
    const currentY = e.clientY - overlayRect.top;
    const minX = Math.min(startX, currentX);
    const minY = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    const normalized = {
      x: clamp((minX - imageBounds.x) / imageBounds.width),
      y: clamp((minY - imageBounds.y) / imageBounds.height),
      width: clamp(width / imageBounds.width),
      height: clamp(height / imageBounds.height),
    };
    setDraftBox(normalized);
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (!draftBox) {
      setStartPoint(null);
      return;
    }
    if (!selectedRange || selectedRange.start === selectedRange.end) {
      setMsg("Select a snippet of text before linking a bounding box.");
      setDraftBox(null);
      setStartPoint(null);
      return;
    }
    const newPair: GroundingPair = {
      id: generateBoxId(),
      text: selectedRange.text,
      span_start: selectedRange.start,
      span_end: selectedRange.end,
      x: draftBox.x,
      y: draftBox.y,
      width: draftBox.width,
      height: draftBox.height,
      color: pickColor(pairs.length),
    };
    setPairs((prev) => [...prev, newPair]);
    setSelectedPairId(newPair.id);
    setMsg("");
    setDraftBox(null);
    setStartPoint(null);
  };

  const applySelectionToPair = (pairId: string) => {
    if (!selectedRange) {
      setMsg("Select text to assign to the chosen bounding box.");
      return;
    }
    setPairs((prev) =>
      prev.map((pair) =>
        pair.id === pairId
          ? {
            ...pair,
            text: selectedRange.text,
            span_start: selectedRange.start,
            span_end: selectedRange.end,
          }
          : pair
      )
    );
    setMsg("");
  };

  const removePair = (pairId: string) => {
    setPairs((prev) => prev.filter((pair) => pair.id !== pairId));
    if (selectedPairId === pairId) {
      setSelectedPairId(null);
    }
  };

  const save = async (nextIndex?: number) => {
    if (!currentPath) return;
    setMsg("");
    try {
      await api.post(`/datasets/${datasetId}/annotations/grounding`, {
        path: currentPath,
        caption: caption.trim(),
        pairs,
        status: pairs.length > 0 ? "labeled" : "unlabeled",
      });
      setItemStatus(pairs.length > 0 ? "labeled" : "unlabeled");
      await loadSummary();
      if (typeof nextIndex === "number") {
        setIndex(nextIndex);
      }
    } catch (e: any) {
      setMsg(e?.response?.data?.detail ?? e?.message ?? "Save failed");
    }
  };

  const skip = async () => {
    if (!currentPath) return;
    try {
      await api.post(`/datasets/${datasetId}/annotations/grounding`, {
        path: currentPath,
        caption: "",
        pairs: [],
        status: "skipped",
      });
      setCaption("");
      setPairs([]);
      setItemStatus("skipped");
      setSelectedPairId(null);
      setSelectedRange(null);
      setMsg("");
      await loadSummary();
      setIndex((prev) => {
        if (!filteredFiles.length) return 0;
        return Math.min(prev + 1, filteredFiles.length - 1);
      });
    } catch (e: any) {
      setMsg(e?.response?.data?.detail ?? e?.message ?? "Skip failed");
    }
  };

  const progressStyle = {
    width: `${progressPct}%`,
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

  const toolbarButton =
    "text-sm px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm text-slate-700 hover:bg-gray-50";
  const toolbarButtonActive =
    "text-sm px-3 py-1.5 rounded-lg border border-slate-900 bg-slate-900 text-white shadow-sm";

  return (
    <div className="space-y-5">
      <div className="bg-white border rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Visual grounding
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Link text spans to bounding boxes.
            </p>
            {rootPath && (
              <p className="text-xs text-gray-500 mt-1">Root: {rootPath}</p>
            )}
            <div className="flex gap-2 text-xs text-blue-600 mt-2 flex-wrap">
              <Link href={`/datasets/${datasetId}/explore/`} className="underline">
                Explore
              </Link>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500">Summary</span>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 text-right md:w-1/2">
            <div>
              <div className="text-sm font-semibold text-slate-600">
                Labeled {summary?.labeled ?? 0} / {summary?.total ?? files.length}
              </div>
              <div className="mt-2 w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button className={toolbarButton} onClick={() => setInstructionsOpen(true)}>
                Instructions
              </button>
              <button
                className={onlyUnlabeled ? toolbarButtonActive : toolbarButton}
                onClick={() => setOnlyUnlabeled((prev) => !prev)}
              >
                {onlyUnlabeled ? "Showing unlabeled" : "Unlabeled Only"}
              </button>
              <Link
                href={`/datasets/${datasetId}/annotations/grounding/summary`}
                className={`${toolbarButton} text-center`}
              >
                View summary
              </Link>
              <button className={toolbarButton} onClick={() => setJumpOpen(true)}>
                Jump to…
              </button>
              <button className={toolbarButton} onClick={skip}>
                Skip
              </button>
              <button
                className="text-sm px-3 py-1.5 rounded-lg bg-slate-900 text-white shadow-sm hover:bg-slate-900/90"
                onClick={() => save(Math.min(filteredFiles.length - 1, index + 1))}
              >
                Save &amp; Next
              </button>
            </div>
          </div>
        </div>
        {instructions && (
          <p className="text-xs text-gray-500 mt-2">{instructions}</p>
        )}
      </div>

      <div className="grid md:grid-cols-[1.2fr_0.8fr] gap-4">
        <div className="bg-white border rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>{fileName}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setIndex((prev) => Math.max(prev - 1, 0))}
                disabled={!filteredFiles.length}
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={() =>
                  setIndex((prev) =>
                    Math.min(prev + 1, Math.max(filteredFiles.length - 1, 0))
                  )
                }
                disabled={!filteredFiles.length}
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
          <div
            ref={overlayRef}
            className="relative w-full min-h-[300px] bg-black/5 overflow-hidden"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {viewUrl ? (
              <img
                ref={imageRef}
                src={viewUrl}
                alt="Current image"
                className="w-full max-h-[480px] object-contain select-none pointer-events-none"
              />
            ) : (
              <div className="h-[320px] flex items-center justify-center text-sm text-gray-500">
                No image selected
              </div>
            )}
            {pairs.map((pair, idx) => {
              const color = pair.color || pickColor(idx);
              return (
                <div
                  key={pair.id}
                  style={{
                    left: `${pair.x * 100}%`,
                    top: `${pair.y * 100}%`,
                    width: `${pair.width * 100}%`,
                    height: `${pair.height * 100}%`,
                    borderColor: color,
                  }}
                  className={`absolute border-2 pointer-events-auto transition ${selectedPairId === pair.id
                      ? "border-black/80"
                      : "border-opacity-80"
                    }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPairId(pair.id);
                  }}
                />
              );
            })}
            {draftBox && (
              <div
                style={{
                  left: `${draftBox.x * 100}%`,
                  top: `${draftBox.y * 100}%`,
                  width: `${draftBox.width * 100}%`,
                  height: `${draftBox.height * 100}%`,
                }}
                className="absolute border border-dashed border-gray-500 pointer-events-none"
              />
            )}
          </div>
          <div className="text-xs text-gray-500">
            Select a text snippet, then drag on the image to link a box. Each box
            receives a colored highlight.
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border rounded-2xl p-4 space-y-2">
            <label className="text-sm font-medium">Caption / Description</label>
            <textarea
              ref={captionRef}
              className="w-full border rounded-lg px-3 py-2 text-sm min-h-[120px] resize-none overflow-hidden focus:outline-none focus:ring-2 focus:ring-black/30"
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value);
                setSelectedRange(null);
              }}
              onSelect={handleTextSelect}
            />
            <div className="text-xs text-gray-500">
              {selectedRange ? (
                <>
                  Selected text:{" "}
                  <span className="font-medium">{selectedRange.text}</span> (
                  {selectedRange.start}-{selectedRange.end})
                </>
              ) : (
                "Highlight text above to assign it to a box."
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* <button
                onClick={save}
                disabled={!currentPath}
                className="bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={skip}
                disabled={!currentPath}
                className="px-4 py-2 rounded-lg border text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Skip
              </button> */}
              <div className="text-xs text-gray-500 flex-1 text-right">
                {msg}
              </div>
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-4 space-y-2">
            <label className="text-sm font-medium">Caption preview</label>
            <div className="text-sm text-gray-700 leading-relaxed space-y-1">
              {highlightSegments.map((segment, idx) => (
                <span
                  key={`${idx}-${segment.text}`}
                  className="inline-block"
                  style={
                    segment.color
                      ? {
                        backgroundColor: segment.color,
                        color: "#0f172a",
                      }
                      : undefined
                  }
                >
                  {segment.text}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Linked regions</h2>
              <span className="text-xs text-gray-500">
                {pairs.length} pair{pairs.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="space-y-3 max-h-[240px] overflow-y-auto">
              {pairs.map((pair, idx) => (
                <div
                  key={pair.id}
                  className={`border rounded-lg p-2 text-sm space-y-1 ${selectedPairId === pair.id ? "border-black/60" : "border-gray-200"
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[13px]">
                      {pair.text || "No text assigned"}
                    </span>
                    <span
                      className="w-4 h-4 rounded-full border"
                      style={{ backgroundColor: pair.color || pickColor(idx) }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-2">
                    <span>
                      Span: {pair.span_start}-{pair.span_end}
                    </span>
                    <span>
                      Box: {pair.x.toFixed(2)}, {pair.y.toFixed(2)} ↗{" "}
                      {pair.width.toFixed(2)} x {pair.height.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => applySelectionToPair(pair.id)}
                      className="text-xs px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
                      disabled={!selectedRange}
                    >
                      Apply selection
                    </button>
                    <button
                      onClick={() => {
                        setSelectedPairId(pair.id);
                      }}
                      className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                    >
                      Select
                    </button>
                    <button
                      onClick={() => removePair(pair.id)}
                      className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {!pairs.length && (
                <p className="text-xs text-gray-500">
                  No bounding boxes yet. Select text and draw on the image to
                  create one.
                </p>
              )}
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-4 space-y-2">
            <label className="text-sm font-medium">Search images</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Filter by filename..."
            />
            <p className="text-xs text-gray-500">
              Showing {filteredFiles.length || 0} images.
            </p>
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
                    <div className="w-full h-24 bg-gray-100 flex items-center justify-center relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbUrlFor(p)}
                        alt={p}
                        className="w-full h-full object-cover"
                        loading="lazy"
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
          </div>
        </div>
      )}

      {instructionsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-center items-start py-12 px-4">
          <div className="bg-white max-w-2xl w-full rounded-2xl shadow-xl border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">Instructions</h2>
              <button
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
                onClick={() => setInstructionsOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="text-sm text-gray-700">
              {instructions || "No instructions provided for this dataset."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
