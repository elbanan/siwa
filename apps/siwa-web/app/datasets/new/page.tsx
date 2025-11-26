/**
 * New image dataset form (image-only workflow).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "../../../lib/api";
import {
  FILE_PATTERN_PRESETS,
  IMAGE_TASK_OPTIONS,
  SEGMENTATION_FORMATS,
} from "../../../lib/datasetOptions";
import { PROJECT_NAME } from "../../../lib/systemInfo";
import FileBrowser from "../../../components/FileBrowser";

type PatternPreset = "images" | "dicom" | "custom";
const REPRESENTATION_HINTS: Record<string, string> = {
  mask: "Binary PNG mask aligned with each image.",
  rle: "COCO-style run-length encoded string.",
  polygon: "Polygon points listed as x1,y1,x2,y2,…",
  bounding_box: "Normalized bounding boxes (x_center y_center width height).",
  points: "Keypoints listed as normalized x,y pairs.",
  other: "Custom layout defined by your workflow.",
};

export default function NewDatasetPage() {
  const router = useRouter();
  const [name, setName] = useState("New Image Dataset");
  const [nameEdited, setNameEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState("");

  const defaultPatternValue = FILE_PATTERN_PRESETS[0].value;
  const [folderPath, setFolderPath] = useState("");
  const [filePattern, setFilePattern] = useState(defaultPatternValue);
  const [patternPreset, setPatternPreset] = useState<PatternPreset>("images");
  const [customPattern, setCustomPattern] = useState("");
  const [includeSubfolders, setIncludeSubfolders] = useState(false);

  const [hasAnnotations, setHasAnnotations] = useState(false);
  const [annotationFormat, setAnnotationFormat] = useState<"csv" | "folder" | "json">("csv");
  const [annotationPath, setAnnotationPath] = useState("");
  const [annotationImageColumn, setAnnotationImageColumn] = useState("");
  const [annotationLabelColumn, setAnnotationLabelColumn] = useState("");
  const [annotationTextColumn, setAnnotationTextColumn] = useState("");
  const [annotationAnnotationColumn, setAnnotationAnnotationColumn] = useState("");
  const [annotationRepresentation, setAnnotationRepresentation] = useState("");
  const [annotationFolderLabelMapText, setAnnotationFolderLabelMapText] = useState("");
  const [annotationFolderExtension, setAnnotationFolderExtension] = useState(".txt");
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [csvColumnsError, setCsvColumnsError] = useState("");

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // File browser state
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [showAnnotationBrowser, setShowAnnotationBrowser] = useState(false);

  useEffect(() => {
    setCsvColumns([]);
    setCsvColumnsError("");
  }, [annotationFormat, annotationPath]);

  useEffect(() => {
    if (patternPreset === "custom") {
      setFilePattern(customPattern || "");
    } else {
      const presetValue = FILE_PATTERN_PRESETS.find((p) => p.id === patternPreset)?.value ?? defaultPatternValue;
      setFilePattern(presetValue);
    }
  }, [patternPreset, customPattern, defaultPatternValue]);

  const isClassification =
    taskType === "classification" ||
    taskType === "multiclassification" ||
    taskType === "multi_label_classification";
  const isSegmentation = taskType === "segmentation";
  const isDetection = taskType === "detection";
  const isCaptioning = taskType === "captioning";
  const isGrounding = taskType === "grounding";
  const requiresCsvAnnotations = hasAnnotations && annotationFormat === "csv";
  const needsLabelColumn = requiresCsvAnnotations && isClassification;
  const needsTextColumn =
    requiresCsvAnnotations && (isCaptioning || isGrounding);
  const needsAnnotationColumn = requiresCsvAnnotations && (isSegmentation || isDetection);
  const needsAnnotationRepresentation =
    hasAnnotations &&
    (isSegmentation || (isDetection && annotationFormat !== "json"));
  const textColumnLabel = isGrounding ? "Text column" : "Caption column";
  const textColumnPlaceholder = isGrounding ? "text" : "caption";
  const textColumnHint = isGrounding
    ? "This column should contain the text you want reviewers to ground."
    : "This column should contain the text you want reviewers to see alongside each image.";

  useEffect(() => {
    if (nameEdited) return;
    if (!taskType) {
      setName("New Image Dataset");
      return;
    }
    const option = IMAGE_TASK_OPTIONS.find((opt) => opt.value === taskType);
    const suffix = option?.label ? option.label.split(" (")[0] : taskType;
    setName(`New ${suffix} Dataset`);
  }, [taskType, nameEdited]);

  const parseFolderLabelMap = useCallback((text: string) => {
    const map: Record<string, string> = {};
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const normalized = line.replace(/[:=]/g, " ");
        const parts = normalized.split(/\s+/);
        if (parts.length < 2) return;
        const [idx, ...rest] = parts;
        const label = rest.join(" ").trim();
        if (!idx || !label) return;
        map[idx] = label;
      });
    return map;
  }, []);

  const loadCsvColumns = async () => {
    if (!annotationPath.trim()) {
      setCsvColumnsError("Provide the CSV path first.");
      return;
    }
    setLoadingColumns(true);
    setCsvColumnsError("");
    try {
      const res = await api.post("/datasets/inspect/csv", { path: annotationPath });
      const cols = res.data?.columns ?? [];
      setCsvColumns(cols);
      if (!cols.length) {
        setCsvColumnsError("No header columns detected in CSV.");
      }
    } catch (e: any) {
      setCsvColumns([]);
      setCsvColumnsError(
        e?.response?.data?.detail ?? e?.message ?? "Failed to read CSV."
      );
    } finally {
      setLoadingColumns(false);
    }
  };

  const onCreate = async () => {
    setMsg("");
    setLoading(true);
    try {
      if (!taskType) {
        throw new Error("Task type is required.");
      }
      if (!folderPath.trim()) {
        throw new Error("Dataset folder is required.");
      }
      if (hasAnnotations) {
        if (!annotationPath.trim()) {
          throw new Error("Annotation path is required when annotations are enabled.");
        }
        if (annotationFormat === "csv" && !annotationImageColumn.trim()) {
          throw new Error("CSV annotations need an image ID column.");
        }
        if (needsLabelColumn && !annotationLabelColumn.trim()) {
          throw new Error("CSV annotations need a label column.");
        }
        if (needsTextColumn && !annotationTextColumn.trim()) {
          throw new Error(
            isGrounding
              ? "CSV annotations need a text column."
              : "CSV annotations need a caption column."
          );
        }
        if (needsAnnotationColumn && !annotationAnnotationColumn.trim()) {
          throw new Error("CSV annotations need an annotation column.");
        }
        if (needsAnnotationRepresentation && !annotationRepresentation.trim()) {
          throw new Error("Select the annotation representation.");
        }
        if (annotationFormat === "folder" && isDetection) {
          const parsed = parseFolderLabelMap(annotationFolderLabelMapText);
          if (!Object.keys(parsed).length) {
            throw new Error(
              "Provide label indices and names for folder-based detection annotations."
            );
          }
        }
        if (annotationFormat === "folder" && taskType === "captioning" && !annotationFolderExtension.trim()) {
          throw new Error("Provide the caption file extension for folder annotations.");
        }
      }

      const folderLabelMap =
        annotationFormat === "folder" && isDetection
          ? parseFolderLabelMap(annotationFolderLabelMapText)
          : {};
      const folderLabelNames = Object.entries(folderLabelMap)
        .sort((a, b) => {
          const ai = Number(a[0]);
          const bi = Number(b[0]);
          if (!Number.isNaN(ai) && !Number.isNaN(bi)) {
            return ai - bi;
          }
          return a[0].localeCompare(b[0]);
        })
        .map(([, label]) => label)
        .filter(Boolean);

      const annotationConfig =
        hasAnnotations && annotationFormat
          ? (() => {
            const cfg: Record<string, any> = { path: annotationPath };
            if (annotationFormat === "csv") {
              cfg.image_column = annotationImageColumn;
              if (needsLabelColumn) cfg.label_column = annotationLabelColumn;
              if (needsTextColumn) cfg.caption_column = annotationTextColumn;
              if (needsAnnotationColumn) {
                cfg.annotation_column = annotationAnnotationColumn;
              }
            }
            if (annotationFormat === "folder") {
              if (isDetection && Object.keys(folderLabelMap).length) {
                cfg.label_map = folderLabelMap;
              }
              if (annotationFolderExtension.trim()) {
                cfg.file_extension = annotationFolderExtension.trim();
              }
            }
            if (needsAnnotationRepresentation) {
              cfg.annotation_representation = annotationRepresentation;
            }
            return cfg;
          })()
          : null;

      const dataSource = {
        type: "local_folder",
        config: {
          path: folderPath,
          pattern: (filePattern && filePattern.trim()) || defaultPatternValue,
          recursive: includeSubfolders,
        },
      };

      const res = await api.post("/datasets", {
        name,
        description,
        tags: [],
        modality: "image",
        task_type: taskType,
        data_source: dataSource,
        annotation_source: hasAnnotations
          ? { format: annotationFormat, config: annotationConfig }
          : null,
        has_annotations: hasAnnotations,
        class_names: folderLabelNames,
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
      {/* File browser modals */}
      {showFolderBrowser && (
        <FileBrowser
          onSelect={(path) => {
            setFolderPath(path);
            setShowFolderBrowser(false);
          }}
          onCancel={() => setShowFolderBrowser(false)}
          selectFiles={false}
        />
      )}
      {showAnnotationBrowser && (
        <FileBrowser
          onSelect={(path) => {
            setAnnotationPath(path);
            setShowAnnotationBrowser(false);
          }}
          onCancel={() => setShowAnnotationBrowser(false)}
          selectFiles={true}
        />
      )}

      <div className="max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New image dataset</h1>
          <p className="text-sm text-gray-600 mt-1">
            Create a local-first dataset configuration. Working with text?{" "}
            <button
              className="underline"
              onClick={() => router.push("/text-datasets/new")}
              type="button"
            >
              Go to text workflow.
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
              {IMAGE_TASK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div>
                <label className="text-sm font-medium">File types</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  value={patternPreset}
                  onChange={(e) =>
                    setPatternPreset(e.target.value as PatternPreset)
                  }
                >
                  {FILE_PATTERN_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
              {patternPreset === "custom" && (
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="e.g. *.tif,*.nii"
                  value={customPattern}
                  onChange={(e) => {
                    setCustomPattern(e.target.value);
                    setFilePattern(e.target.value);
                  }}
                />
              )}
              <p className="text-xs text-gray-500">
                Supports comma-separated globs (e.g. *.png,*.jpg). Enable recursion for nested folders.
              </p>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeSubfolders}
                  onChange={(e) => setIncludeSubfolders(e.target.checked)}
                />
                Scan nested subfolders
              </label>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Local folder path</label>
            <div className="flex gap-2 mt-1">
              <input
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
                placeholder="/Users/me/data/images"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
              />
              <button
                type="button"
                className="px-4 py-2 rounded-lg border hover:bg-gray-50 text-sm whitespace-nowrap"
                onClick={() => setShowFolderBrowser(true)}
              >
                Browse
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              We reference images in place unless you later choose to import.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasAnnotations}
              onChange={(e) => setHasAnnotations(e.target.checked)}
            />
            I already have annotations
          </label>

          {hasAnnotations && (
            <div className="space-y-3 border rounded-xl p-4">
              <div>
                <label className="text-sm font-medium">Annotation format</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  value={annotationFormat}
                  onChange={(e) => setAnnotationFormat(e.target.value as any)}
                >
                  <option value="csv">CSV file</option>
                  <option value="folder">Folder structure</option>
                  <option value="json">JSON export</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  CSV = point to a table, folder = infer from directories/files.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium">Annotation path</label>
                <div className="flex flex-col gap-2 mt-1">
                  <div className="flex gap-2">
                    <input
                      className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
                      value={annotationPath}
                      onChange={(e) => setAnnotationPath(e.target.value)}
                    />
                    <button
                      type="button"
                      className="text-sm px-3 py-2 rounded-lg border hover:bg-gray-50 whitespace-nowrap"
                      onClick={() => setShowAnnotationBrowser(true)}
                    >
                      Browse
                    </button>
                    {annotationFormat === "csv" && (
                      <button
                        type="button"
                        className="text-sm px-3 py-2 rounded-lg border hover:bg-gray-50"
                        onClick={loadCsvColumns}
                        disabled={loadingColumns}
                      >
                        {loadingColumns ? "Loading…" : "Load columns"}
                      </button>
                    )}
                  </div>
                  {csvColumnsError && (
                    <p className="text-xs text-red-600">{csvColumnsError}</p>
                  )}
                  {!csvColumnsError && csvColumns.length > 0 && (
                    <p className="text-xs text-gray-500">
                      Columns detected: {csvColumns.join(", ")}
                    </p>
                  )}
                  {annotationFormat === "folder" &&
                    (isCaptioning || isGrounding) && (
                      <p className="text-xs text-gray-500">
                        Points to a folder containing caption/text files whose basenames match each image.
                      </p>
                    )}
                </div>
              </div>

              {annotationFormat === "csv" && (
                <div>
                  <label className="text-sm font-medium">Image ID column</label>
                  {csvColumns.length > 0 ? (
                    <select
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      value={annotationImageColumn}
                      onChange={(e) => setAnnotationImageColumn(e.target.value)}
                    >
                      <option value="">Select column</option>
                      {csvColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      placeholder="image_id"
                      value={annotationImageColumn}
                      onChange={(e) => setAnnotationImageColumn(e.target.value)}
                    />
                  )}
                </div>
              )}

              {needsLabelColumn && (
                <div>
                  <label className="text-sm font-medium">Label/class column</label>
                  {csvColumns.length > 0 ? (
                    <select
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      value={annotationLabelColumn}
                      onChange={(e) => setAnnotationLabelColumn(e.target.value)}
                    >
                      <option value="">Select column</option>
                      {csvColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      placeholder="label"
                      value={annotationLabelColumn}
                      onChange={(e) => setAnnotationLabelColumn(e.target.value)}
                    />
                  )}
                </div>
              )}

              {needsTextColumn && (
                <div>
                  <label className="text-sm font-medium">{textColumnLabel}</label>
                  {csvColumns.length > 0 ? (
                    <select
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      value={annotationTextColumn}
                      onChange={(e) => setAnnotationTextColumn(e.target.value)}
                    >
                      <option value="">Select column</option>
                      {csvColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      placeholder={textColumnPlaceholder}
                      value={annotationTextColumn}
                      onChange={(e) => setAnnotationTextColumn(e.target.value)}
                    />
                  )}
                  <p className="text-xs text-gray-500 mt-1">{textColumnHint}</p>
                </div>
              )}

              {needsAnnotationColumn && (
                <div>
                  <label className="text-sm font-medium">Annotation column</label>
                  {csvColumns.length > 0 ? (
                    <select
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      value={annotationAnnotationColumn}
                      onChange={(e) => setAnnotationAnnotationColumn(e.target.value)}
                    >
                      <option value="">Select column</option>
                      {csvColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      placeholder="geometry / mask data column"
                      value={annotationAnnotationColumn}
                      onChange={(e) => setAnnotationAnnotationColumn(e.target.value)}
                    />
                  )}
                </div>
              )}

              {needsAnnotationRepresentation && (
                <div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">Annotation representation</label>
                    <span
                      className="text-xs w-5 h-5 rounded-full border border-gray-300 flex items-center justify-center cursor-help"
                      title="Choose the format that matches your annotation files (mask, RLE, polygons, bounding boxes, etc.)."
                    >
                      ?
                    </span>
                  </div>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    value={annotationRepresentation}
                    onChange={(e) => setAnnotationRepresentation(e.target.value)}
                  >
                    <option value="">Select format</option>
                    {SEGMENTATION_FORMATS.map((format) => (
                      <option
                        key={format.value}
                        value={format.value}
                        title={REPRESENTATION_HINTS[format.value] || ""}
                      >
                        {format.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {annotationFormat === "folder" && isClassification && (
                <p className="text-xs text-gray-500">
                  Classes will be inferred from subfolder names.
                </p>
              )}

              {annotationFormat === "folder" && isDetection && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">
                      Label map (index and label per line)
                    </label>
                    <textarea
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1 font-mono min-h-[120px]"
                      placeholder={"0 lungs\n1 bone"}
                      value={annotationFolderLabelMapText}
                      onChange={(e) => setAnnotationFolderLabelMapText(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Format: `0 lungs`. The index is the class ID from your annotation
                      files.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Annotation file extension</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      value={annotationFolderExtension}
                      onChange={(e) => setAnnotationFolderExtension(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Defaults to .txt. Files are matched to images by name.
                    </p>
                  </div>
                </div>
              )}

              {annotationFormat === "folder" && (isCaptioning || isGrounding) && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">
                    Provide a folder of caption/text files whose names mirror the image files (same basename with a different extension).
                  </p>
                  <div>
                    <label className="text-sm font-medium">Annotation file extension</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                      value={annotationFolderExtension}
                      onChange={(e) => setAnnotationFolderExtension(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Examples: <code>.txt</code>, <code>.captions</code>. Files must share the same base name as each image.
                    </p>
                  </div>
                </div>
              )}

              {annotationFormat === "json" && isDetection && (
                <div className="text-xs text-gray-500 space-y-2">
                  <p>
                    Provide the path to the JSON file exported from {PROJECT_NAME}. It
                    should be an array (or object with <code>annotations</code>) containing
                    items with <code>path</code>, <code>status</code>, and
                    <code>boxes</code>.
                  </p>
                  <pre className="bg-gray-50 border rounded-md p-2 text-[11px] overflow-x-auto">
                    {`[
  {
    "path": "/full/path/to/image.jpg",
    "status": "labeled",
    "boxes": [
      { "label": "pneumonia", "x": 0.5, "y": 0.2, "width": 0.3, "height": 0.4 }
    ]
  }
]`}
                  </pre>
                </div>
              )}

              {annotationFormat === "folder" && (isSegmentation || isDetection) && (
                <p className="text-xs text-gray-500">
                  Provide masks/labels in mirrored subfolders and select the representation above.
                </p>
              )}
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
                !folderPath.trim()
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
