/**
 * Dataset Details (Open) page.
 *
 * Added in this version:
 * - Editable data source path + pattern (local_folder)
 * - Editable annotation source (format + path)
 * - "Check configs" button to validate server-side before saving
 *
 * Notes:
 * - tags = comma separated
 * - class_names = newline separated
 * - ds_metadata/split = JSON textareas
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import api from "../../../lib/api";
import Link from "next/link";
import {
  FILE_PATTERN_PRESETS,
  IMAGE_TASK_OPTIONS,
  SEGMENTATION_FORMATS,
} from "../../../lib/datasetOptions";
import { PROJECT_NAME } from "../../../lib/systemInfo";

const REPRESENTATION_HINTS: Record<string, string> = {
  mask: "Binary PNG mask aligned with each image.",
  rle: "COCO-style run-length encoded string.",
  polygon: "Polygon points listed as x1,y1,x2,y2,…",
  bounding_box: "Normalized bounding boxes (x_center y_center width height).",
  points: "Keypoints listed as normalized x,y pairs.",
  other: "Custom layout defined by your workflow.",
};

const normalizePatternValue = (value: string) =>
  (value || "").replace(/\s+/g, "").toLowerCase();

const detectPatternPreset = (value: string): "images" | "dicom" | "custom" => {
  const normalized = normalizePatternValue(value);
  const imagePreset = normalizePatternValue(FILE_PATTERN_PRESETS[0].value);
  const dicomPreset = normalizePatternValue(FILE_PATTERN_PRESETS[1].value);
  if (normalized === dicomPreset) return "dicom";
  if (normalized === imagePreset) return "images";
  return "custom";
};

type ValidateReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: Record<string, any>;
};

type PatternPreset = "images" | "dicom" | "custom";

export default function DatasetDetailsPage() {
  const { status, data: session } = useSession();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const datasetId = id || "";

  const [ds, setDs] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // validation report
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<ValidateReport | null>(null);

  // rescan state
  const [rescanning, setRescanning] = useState(false);
  const [rescanMessage, setRescanMessage] = useState("");

  // form fields
  const [name, setName] = useState("");
  const [projectName, setProjectName] = useState("default");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [taskType, setTaskType] = useState("");
  const [classNamesText, setClassNamesText] = useState("");
  const [metadataText, setMetadataText] = useState("{}");
  const [splitText, setSplitText] = useState("");
  const [annotationInstructions, setAnnotationInstructions] = useState("");
  const [multiLabelEnabled, setMultiLabelEnabled] = useState(false);

  // NEW: data source edit
  const [dataPath, setDataPath] = useState("");
  const defaultPatternValue = FILE_PATTERN_PRESETS[0].value;
  const [filePattern, setFilePattern] = useState(defaultPatternValue);
  const [patternPreset, setPatternPreset] = useState<PatternPreset>("images");
  const [customPattern, setCustomPattern] = useState("");
  const [includeSubfolders, setIncludeSubfolders] = useState(false);

  // NEW: annotation source edit
  const [hasAnnotations, setHasAnnotations] = useState(false);
  const [annFormat, setAnnFormat] = useState<"csv" | "folder" | "json">("csv");
  const [annPath, setAnnPath] = useState("");
  const [annImageColumn, setAnnImageColumn] = useState("");
  const [annLabelColumn, setAnnLabelColumn] = useState("");
  const [annAnnotationColumn, setAnnAnnotationColumn] = useState("");
  const [annRepresentation, setAnnRepresentation] = useState("");
  const [annotationFolderLabelMapText, setAnnotationFolderLabelMapText] = useState("");
  const [annotationFolderExtension, setAnnotationFolderExtension] = useState(".txt");

  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [loadingCsvColumns, setLoadingCsvColumns] = useState(false);
  const [csvColumnsError, setCsvColumnsError] = useState("");

  const syncPatternPresetFromValue = useCallback((patternValue: string) => {
    const preset = detectPatternPreset(patternValue);
    setPatternPreset(preset);
    if (preset === "custom") {
      setCustomPattern(patternValue);
    } else {
      setCustomPattern("");
    }
  }, []);

  const handlePatternPresetChange = (preset: PatternPreset) => {
    setPatternPreset(preset);
    if (preset === "custom") {
      setFilePattern(customPattern || "");
    } else {
      const presetValue = FILE_PATTERN_PRESETS.find((p) => p.id === preset)?.value ?? defaultPatternValue;
      setFilePattern(presetValue);
    }
  };

  const fetchDataset = useCallback(async () => {
    setError("");
    try {
      if (!datasetId) return;
      const res = await api.get(`/datasets/${datasetId}`);
      const d = res.data;
      if ((d.modality ?? "").toLowerCase() === "text") {
        router.replace(`/text-datasets/${datasetId}`);
        return;
      }
      setDs(d);

      setName(d.name ?? "");
      setProjectName(d.project_name ?? "default");
      setDescription(d.description ?? "");
      setTagsText((d.tags ?? []).join(", "));
      setTaskType(d.task_type ?? "");
      setClassNamesText((d.class_names ?? []).join("\n"));
      const meta = { ...(d.ds_metadata ?? {}) };
      const incomingInstructions =
        typeof meta.annotation_instructions === "string"
          ? meta.annotation_instructions
          : "";
      delete meta.annotation_instructions;
      const incomingMultiLabel =
        typeof meta.multi_label === "boolean"
          ? meta.multi_label
          : d.task_type === "multiclassification";
      delete meta.multi_label;
      setMultiLabelEnabled(incomingMultiLabel);
      setAnnotationInstructions(incomingInstructions);
      setMetadataText(JSON.stringify(meta, null, 2));
      setSplitText(d.split ? JSON.stringify(d.split, null, 2) : "");

      const source = d.data_source ?? {};
      const cfg = source.config ?? {};
      setDataPath(cfg.path ?? "");
      const incomingPattern = cfg.pattern ?? defaultPatternValue;
      setFilePattern(incomingPattern);
      syncPatternPresetFromValue(incomingPattern);
      setIncludeSubfolders(Boolean(cfg.recursive));

      if (d.annotation_source) {
        setHasAnnotations(true);
        setAnnFormat(d.annotation_source.format ?? "csv");
        const annCfg = d.annotation_source.config ?? {};
        setAnnPath(annCfg.path ?? "");
        setAnnImageColumn(annCfg.image_column ?? "");
        setAnnLabelColumn(annCfg.label_column ?? "");
        setAnnAnnotationColumn(annCfg.annotation_column ?? "");
        setAnnRepresentation(annCfg.annotation_representation ?? "");
        const incomingMap = annCfg.label_map ?? {};
        const mapText = Object.keys(incomingMap).length
          ? Object.entries(incomingMap)
            .map(([idx, label]) => `${idx} ${label}`)
            .join("\n")
          : "";
        setAnnotationFolderLabelMapText(mapText);
        setAnnotationFolderExtension(annCfg.file_extension ?? ".txt");
        if (!(d.class_names || []).length && mapText) {
          setClassNamesText(
            mapText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => line.replace(/[:=]/g, " ").split(/\s+/).slice(1).join(" "))
              .filter(Boolean)
              .join("\n")
          );
        }
      } else {
        setHasAnnotations(false);
        setAnnFormat("csv");
        setAnnPath("");
        setAnnImageColumn("");
        setAnnLabelColumn("");
        setAnnAnnotationColumn("");
        setAnnRepresentation("");
        setAnnotationFolderLabelMapText("");
        setAnnotationFolderExtension(".txt");
      }
      setCsvColumns([]);
      setCsvColumnsError("");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Failed to load dataset");
    }
  }, [datasetId, defaultPatternValue, syncPatternPresetFromValue, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetchDataset();
  }, [status, fetchDataset]);

  const tags = useMemo(() => {
    return tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }, [tagsText]);

  const classNames = useMemo(() => {
    return classNamesText
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
  }, [classNamesText]);

  const parseJson = (text: string, label: string) => {
    if (!text.trim()) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label} must be valid JSON`);
    }
  };

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
        const labelValue = rest.join(" ").trim();
        if (!idx || !labelValue) return;
        map[idx] = labelValue;
      });
    return map;
  }, []);

  useEffect(() => {
    setCsvColumns([]);
    setCsvColumnsError("");
  }, [annFormat, annPath]);

  const taskOptions = IMAGE_TASK_OPTIONS;
  const isClassification =
    taskType === "classification" ||
    taskType === "multiclassification" ||
    taskType === "multi_label_classification";
  const isSegmentation = taskType === "segmentation";
  const isDetection = taskType === "detection";
  const isCaptioning = taskType === "captioning";
  const isGrounding = taskType === "grounding";
  const requiresCsvAnnotations = hasAnnotations && annFormat === "csv";
  const needsLabelColumn = requiresCsvAnnotations && isClassification;
  const needsAnnotationColumn = requiresCsvAnnotations && (isSegmentation || isDetection);
  const needsAnnotationRepresentation =
    hasAnnotations && (isSegmentation || (isDetection && annFormat !== "json"));

  const loadCsvColumns = async () => {
    if (!annPath.trim()) {
      setCsvColumnsError("Provide the CSV path first.");
      return;
    }
    setLoadingCsvColumns(true);
    setCsvColumnsError("");
    try {
      const res = await api.post("/datasets/inspect/csv", { path: annPath });
      const cols = res.data?.columns ?? [];
      setCsvColumns(cols);
      if (!cols.length) {
        setCsvColumnsError("No header columns detected in the CSV.");
      }
    } catch (e: any) {
      setCsvColumns([]);
      setCsvColumnsError(
        e?.response?.data?.detail ?? e?.message ?? "Failed to read CSV."
      );
    } finally {
      setLoadingCsvColumns(false);
    }
  };

  const onCheckConfigs = async () => {
    setMsg("");
    setReport(null);
    setChecking(true);
    try {
      if (!datasetId) throw new Error("Dataset id missing.");
      const res = await api.post(`/datasets/${datasetId}/validate/check`);
      setReport(res.data);
      if (res.data.ok) {
        setMsg("Config check passed.");
      } else {
        setMsg("Config check failed. Review errors.");
      }
      await fetchDataset();
    } catch (e: any) {
      const detail =
        e?.response?.data?.detail ||
        e?.response?.data ||
        e?.message ||
        "Validation failed";
      setMsg(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
    } finally {
      setChecking(false);
    }
  };

  const onSave = async () => {
    setMsg("");
    setSaving(true);
    try {
      if (!datasetId) {
        throw new Error("Dataset id missing.");
      }
      if (!taskType) {
        throw new Error("Task type is required.");
      }
      let folderLabelMap: Record<string, string> = {};
      if (!dataPath.trim()) {
        throw new Error("Provide the dataset folder path.");
      }
      if (hasAnnotations) {
        if (!annPath.trim()) {
          throw new Error("Annotation path is required when annotations are enabled.");
        }
        if (annFormat === "csv" && !annImageColumn.trim()) {
          throw new Error("Select which CSV column contains the image identifier.");
        }
        if (needsLabelColumn && !annLabelColumn.trim()) {
          throw new Error("Select which CSV column contains the class/label.");
        }
        if (needsAnnotationColumn && !annAnnotationColumn.trim()) {
          throw new Error("Select which CSV column contains the annotation geometry.");
        }
        if (needsAnnotationRepresentation && !annRepresentation.trim()) {
          throw new Error("Select the annotation representation.");
        }
        if (annFormat === "folder" && isDetection) {
          folderLabelMap = parseFolderLabelMap(annotationFolderLabelMapText);
          if (!Object.keys(folderLabelMap).length) {
            throw new Error(
              "Provide label indices and names for folder-based detection annotations."
            );
          }
        }
      }

      const ds_metadata = (parseJson(metadataText, "Metadata") ?? {}) as Record<
        string,
        any
      >;
      if (annotationInstructions.trim()) {
        ds_metadata.annotation_instructions = annotationInstructions.trim();
      } else {
        delete ds_metadata.annotation_instructions;
      }

      if (multiLabelEnabled) {
        ds_metadata.multi_label = true;
      } else {
        delete ds_metadata.multi_label;
      }
      const split = parseJson(splitText, "Split") ?? null;

      const labelNamesFromMap = Object.entries(folderLabelMap)
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
      const effectiveClassNames =
        classNames.length > 0 ? classNames : labelNamesFromMap;

      const updatedDataSource = {
        type: "local_folder",
        config: {
          path: dataPath,
          pattern: (filePattern && filePattern.trim()) || defaultPatternValue,
          recursive: includeSubfolders,
        },
      };

      const payload: any = {
        name,
        project_name: projectName,
        description,
        tags,
        task_type: taskType,
        class_names: effectiveClassNames,
        ds_metadata,
        split,

        // update the data source config
        data_source: updatedDataSource,

        // update annotation source if enabled
        annotation_source: hasAnnotations
          ? {
            format: annFormat,
            config: (() => {
              const config: Record<string, any> = { path: annPath };
              if (annFormat === "csv") {
                config.image_column = annImageColumn;
                if (needsLabelColumn) config.label_column = annLabelColumn;
                if (needsAnnotationColumn) {
                  config.annotation_column = annAnnotationColumn;
                }
              }
              if (annFormat === "folder") {
                if (isDetection && Object.keys(folderLabelMap).length) {
                  config.label_map = folderLabelMap;
                }
                if (annotationFolderExtension.trim()) {
                  config.file_extension = annotationFolderExtension.trim();
                }
              }
              if (needsAnnotationRepresentation) {
                config.annotation_representation = annRepresentation;
              }
              return config;
            })(),
          }
          : null,
        has_annotations: hasAnnotations,
      };

      const res = await api.patch(`/datasets/${datasetId}`, payload);
      setDs(res.data);
      setMsg("Saved.");
      setReport(null);
    } catch (e: any) {
      setMsg(e?.response?.data?.detail ?? e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onRescan = async () => {
    setRescanMessage("");
    setRescanning(true);
    try {
      if (!datasetId) throw new Error("Dataset id missing.");
      const res = await api.post(`/datasets/${datasetId}/rescan`);
      setRescanMessage(res.data.message || "Rescan complete");
      // Refresh dataset to get updated counts
      await fetchDataset();
    } catch (e: any) {
      setRescanMessage(
        e?.response?.data?.detail ?? e?.message ?? "Rescan failed"
      );
    } finally {
      setRescanning(false);
    }
  };

  const isOwnerAdmin =
    session?.role === "owner" || session?.role === "admin";
  const readonly = !isOwnerAdmin;

  if (status === "unauthenticated") {
    return (
      <div className="bg-white border rounded-2xl p-10 text-center">
        <h1 className="text-xl font-semibold">Sign in required</h1>
        <Link href="/login" className="underline text-sm">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Dataset details
          </h1>
          {ds && (
            <p className="text-sm text-gray-600 mt-1 flex flex-wrap gap-2">
              <span>
                Status: <span className="font-medium">{ds.status}</span>
              </span>
              <span>
                Annotation:{" "}
                <span className="font-medium">{ds.annotation_status}</span>
              </span>
              <span>
                Images found:{" "}
                <span className="font-medium">
                  {ds.asset_count ?? report?.stats?.file_count ?? 0}
                </span>
              </span>
            </p>
          )}
        </div>

        {ds && (
          <div className="flex gap-2">
            <Link
              href={`/datasets/${datasetId}/explore/`}
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
            >
              Explore
            </Link>
            <button
              onClick={onCheckConfigs}
              disabled={checking || readonly}
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-60"
            >
              {checking ? "Checking..." : "Check configs"}
            </button>
            <button
              onClick={onRescan}
              disabled={rescanning}
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-60"
            >
              {rescanning ? "Rescanning..." : "Rescan"}
            </button>
            <button
              onClick={onSave}
              disabled={saving || readonly}
              className="text-sm px-3 py-1.5 rounded-md bg-black text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        )}
        {ds && !isOwnerAdmin && (
          <p className="text-sm text-gray-500">
            Read-only access: dataset fields cannot be modified with your current permissions.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!ds && !error && <p className="text-sm text-gray-600">Loading…</p>}

      {/* Rescan message */}
      {rescanMessage && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
          <div className="font-medium text-blue-900">Rescan Result</div>
          <p className="text-blue-800 mt-1">{rescanMessage}</p>
        </div>
      )}

      {/* Validation report */}
      {report && (
        <div
          className={`border rounded-xl p-4 text-sm ${report.ok ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
            }`}
        >
          <div className="font-semibold">
            {report.ok ? "Validation passed" : "Validation failed"}
          </div>

          {report.errors?.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">Errors</div>
              <ul className="list-disc ml-5">
                {report.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {report.warnings?.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">Warnings</div>
              <ul className="list-disc ml-5">
                {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {Object.keys(report.stats || {}).length > 0 && (
            <div className="mt-2">
              <div className="font-medium">Stats</div>
              <pre className="bg-white/60 rounded p-2 mt-1 text-xs overflow-auto">
                {JSON.stringify(report.stats, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {ds && (
        <fieldset disabled={readonly} className="grid lg:grid-cols-3 gap-4 border-0 p-0">
          {/* Identity */}
          <section className="lg:col-span-2 bg-white border rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="font-semibold">Identity</h2>

            <div>
              <label className="text-sm font-medium">Dataset name</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Project name</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 min-h-[90px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Annotation instructions</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 min-h-[120px]"
                placeholder="Guidelines shown to annotators in the Instructions modal."
                value={annotationInstructions}
                onChange={(e) => setAnnotationInstructions(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                These instructions appear in the annotation UI to guide labelers.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium">Tags (comma separated)</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
              />
            </div>
          </section>

          {/* Task & schema */}
          <section className="bg-white border rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="font-semibold">Task & schema</h2>

            <div>
              <label className="text-sm font-medium">Modality</label>
              <div className="text-sm text-gray-700 mt-1">
                {String(ds.modality).toUpperCase()}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Task type</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
              >
                <option value="">Select task type</option>
                {taskOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">
                Class names (one per line)
              </label>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 min-h-[160px] font-mono"
                placeholder={"e.g.\npneumothorax\nnormal"}
                value={classNamesText}
                onChange={(e) => setClassNamesText(e.target.value)}
              />
            </div>

            {isClassification && (
              <div className="flex items-start gap-3">
                <input
                  id="multi-label"
                  type="checkbox"
                  className="mt-1"
                  checked={multiLabelEnabled}
                  onChange={(e) => setMultiLabelEnabled(e.target.checked)}
                />
                <label htmlFor="multi-label" className="text-sm">
                  <span className="font-medium">Enable multi-label annotation</span>
                  <span className="block text-gray-500">
                    Allows annotators to choose more than one class per item.
                  </span>
                </label>
              </div>
            )}
          </section>

          {/* Data source */}
          <section className="lg:col-span-2 bg-white border rounded-2xl p-5 shadow-sm space-y-3">
            <h2 className="font-semibold">Data source</h2>

            <div>
              <label className="text-sm font-medium">Local folder path</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 font-mono"
                value={dataPath}
                onChange={(e) => setDataPath(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div>
                <label className="text-sm font-medium">File types</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  value={patternPreset}
                  onChange={(e) =>
                    handlePatternPresetChange(e.target.value as PatternPreset)
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
                  placeholder="e.g. *.tif or *.nii"
                  value={customPattern}
                  onChange={(e) => {
                    setCustomPattern(e.target.value);
                    setFilePattern(e.target.value);
                  }}
                />
              )}
              <p className="text-xs text-gray-500">
                Supports comma-separated globs (e.g. *.png,*.jpg). Enable subfolder scanning below for nested studies.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeSubfolders}
                onChange={(e) => setIncludeSubfolders(e.target.checked)}
              />
              Scan nested subfolders for images
            </label>
            <p className="text-xs text-gray-500 -mt-2">
              Enable if each study/image lives inside its own folder.
            </p>
          </section>

          <section className="bg-white border rounded-2xl p-5 shadow-sm space-y-3">
            <h2 className="font-semibold">Annotations</h2>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasAnnotations}
                onChange={(e) => setHasAnnotations(e.target.checked)}
              />
              I already have annotations
            </label>

            {hasAnnotations && (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Annotation format</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                    value={annFormat}
                    onChange={(e) => setAnnFormat(e.target.value as any)}
                  >
                    <option value="csv">CSV file</option>
                    <option value="folder">Folder structure</option>
                    <option value="json">JSON export</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    CSV = supply mappings. Folder = infer classes/masks from directories.
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium">Annotation path</label>
                  <div className="flex flex-col gap-2 mt-1">
                    <div className="flex gap-2">
                      <input
                        className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
                        value={annPath}
                        onChange={(e) => setAnnPath(e.target.value)}
                      />
                      {annFormat === "csv" && (
                        <button
                          type="button"
                          className="text-sm px-3 py-2 rounded-lg border hover:bg-gray-50"
                          onClick={loadCsvColumns}
                          disabled={loadingCsvColumns}
                        >
                          {loadingCsvColumns ? "Loading…" : "Load columns"}
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
                  </div>
                </div>

                {annFormat === "csv" && (
                  <div>
                    <label className="text-sm font-medium">Image ID column</label>
                    {csvColumns.length > 0 ? (
                      <select
                        className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                        value={annImageColumn}
                        onChange={(e) => setAnnImageColumn(e.target.value)}
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
                        value={annImageColumn}
                        onChange={(e) => setAnnImageColumn(e.target.value)}
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
                        value={annLabelColumn}
                        onChange={(e) => setAnnLabelColumn(e.target.value)}
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
                        value={annLabelColumn}
                        onChange={(e) => setAnnLabelColumn(e.target.value)}
                      />
                    )}
                  </div>
                )}

                {needsAnnotationColumn && (
                  <div>
                    <label className="text-sm font-medium">Annotation column</label>
                    {csvColumns.length > 0 ? (
                      <select
                        className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                        value={annAnnotationColumn}
                        onChange={(e) => setAnnAnnotationColumn(e.target.value)}
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
                        value={annAnnotationColumn}
                        onChange={(e) => setAnnAnnotationColumn(e.target.value)}
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
                      value={annRepresentation}
                      onChange={(e) => setAnnRepresentation(e.target.value)}
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

                {annFormat === "folder" && isClassification && (
                  <p className="text-xs text-gray-500">
                    Classes will be inferred from subfolder names.
                  </p>
                )}

                {annFormat === "folder" && isDetection && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium">
                        Label map (index and label per line)
                      </label>
                      <textarea
                        className="w-full border rounded-lg px-3 py-2 text-sm mt-1 font-mono min-h-[120px]"
                        placeholder={"0 lungs\n1 bone"}
                        value={annotationFolderLabelMapText}
                        onChange={(e) =>
                          setAnnotationFolderLabelMapText(e.target.value)
                        }
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Format: `0 lungs`. The index corresponds to the value stored at
                        the start of each annotation line.
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">
                        Annotation file extension
                      </label>
                      <input
                        className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                        value={annotationFolderExtension}
                        onChange={(e) => setAnnotationFolderExtension(e.target.value)}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Defaults to .txt. Annotation files must mirror image filenames.
                      </p>
                    </div>
                  </div>
                )}

                {annFormat === "folder" && (isCaptioning || isGrounding) && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium">
                        Annotation file extension
                      </label>
                      <input
                        className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                        value={annotationFolderExtension}
                        onChange={(e) => setAnnotationFolderExtension(e.target.value)}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Defaults to .txt. Files must share the same base name as each image.
                      </p>
                    </div>
                  </div>
                )}

                {annFormat === "json" && isDetection && (
                  <div className="text-xs text-gray-500 space-y-2">
                    <p>
                      Point to the JSON file exported from {PROJECT_NAME} (`path`,
                      `status`, `boxes`). Boxes will be loaded automatically for matching
                      files.
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

                {annFormat === "folder" && (isSegmentation || isDetection) && (
                  <p className="text-xs text-gray-500">
                    Provide masks/labels in mirrored subfolders; specify the representation above.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ds_metadata */}
          <section className="lg:col-span-2 bg-white border rounded-2xl p-5 shadow-sm space-y-3">
            <h2 className="font-semibold">Metadata (JSON)</h2>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1 min-h-[180px] font-mono"
              value={metadataText}
              onChange={(e) => setMetadataText(e.target.value)}
            />
          </section>

          {/* Split */}
          <section className="bg-white border rounded-2xl p-5 shadow-sm space-y-3">
            <h2 className="font-semibold">Split (JSON, optional)</h2>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1 min-h-[180px] font-mono"
              placeholder={`{\n  "train": 0.8,\n  "val": 0.1,\n  "test": 0.1\n}`}
              value={splitText}
              onChange={(e) => setSplitText(e.target.value)}
            />
          </section>
        </fieldset>
      )}

      {msg && (
        <p className={`text-sm ${msg === "Saved." ? "text-green-700" : "text-red-600"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}
