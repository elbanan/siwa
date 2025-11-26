/**
 * Text dataset details page (separate workflow from image datasets).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import api from "../../../lib/api";
import { TEXT_TASK_OPTIONS } from "../../../lib/datasetOptions";

type ValidateReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: Record<string, any>;
};

export default function TextDatasetDetailsPage() {
  const { status, data: session } = useSession();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const datasetId = id || "";

  const [ds, setDs] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<ValidateReport | null>(null);

  const [name, setName] = useState("");
  const [projectName, setProjectName] = useState("default");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [taskType, setTaskType] = useState("");
  const [classNamesText, setClassNamesText] = useState("");
  const [metadataText, setMetadataText] = useState("{}");
  const [splitText, setSplitText] = useState("");
  const [annotationInstructions, setAnnotationInstructions] = useState("");

  const [textDataPath, setTextDataPath] = useState("");
  const [textDataTextColumn, setTextDataTextColumn] = useState("");
  const [textDataLabelColumn, setTextDataLabelColumn] = useState("");
  const [textDataIdColumn, setTextDataIdColumn] = useState("");
  const [customIndexEnabled, setCustomIndexEnabled] = useState(false);
  const [textCsvColumns, setTextCsvColumns] = useState<string[]>([]);
  const [textCsvColumnsError, setTextCsvColumnsError] = useState("");
  const [loadingTextColumns, setLoadingTextColumns] = useState(false);

  const [hasAnnotations, setHasAnnotations] = useState(false);
  const [extraColumns, setExtraColumns] = useState<string[]>([]);

  const parseJson = (text: string, label: string) => {
    if (!text.trim()) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label} must be valid JSON`);
    }
  };

  const isSummarization = taskType === "text_summarization";

  const tags = useMemo(() => {
    return tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }, [tagsText]);

  const classNames = useMemo(() => {
    if (isSummarization) return [];
    return classNamesText
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
  }, [classNamesText, isSummarization]);
  const annotationColumnLabel = isSummarization
    ? "Reference summary column"
    : "Label column";
  const annotationColumnPlaceholder = isSummarization ? "reference_summary" : "label";
  const annotationColumnError = isSummarization
    ? "Select which column contains the reference summary."
    : "Select which column contains the annotation label.";

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
        setTextCsvColumnsError("No header columns detected in the CSV.");
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

  useEffect(() => {
    setTextCsvColumns([]);
    setTextCsvColumnsError("");
  }, [textDataPath]);

  const fetchDataset = useCallback(async () => {
    setError("");
    try {
      if (!datasetId) return;
      const res = await api.get(`/datasets/${datasetId}`);
      const d = res.data;
      if ((d.modality ?? "").toLowerCase() !== "text") {
        router.replace(`/datasets/${datasetId}`);
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
      const incomingExtraColumns = Array.isArray(meta.extra_text_columns)
        ? meta.extra_text_columns.map(String)
        : [];
      delete meta.extra_text_columns;
      setAnnotationInstructions(incomingInstructions);
      setExtraColumns(incomingExtraColumns);
      setMetadataText(JSON.stringify(meta, null, 2));
      setSplitText(d.split ? JSON.stringify(d.split, null, 2) : "");

      const source = d.data_source ?? {};
      const cfg = source.config ?? {};
      setTextDataPath(cfg.path ?? "");
      setTextDataTextColumn(cfg.text_column ?? "");
      setTextDataLabelColumn(cfg.label_column ?? "");
      const incomingId = cfg.id_column ?? "";
      setTextDataIdColumn(incomingId);
      setCustomIndexEnabled(Boolean(incomingId));

      setHasAnnotations(Boolean(d.has_annotations));
      setTextCsvColumns([]);
      setTextCsvColumnsError("");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Failed to load dataset");
    }
  }, [datasetId, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetchDataset();
  }, [status, fetchDataset]);

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
      if (!textDataPath.trim()) {
        throw new Error("Provide the CSV path for your text dataset.");
      }
      if (!textDataTextColumn.trim()) {
        throw new Error("Select which column contains the text.");
      }
      if (hasAnnotations && !textDataLabelColumn.trim()) {
        throw new Error(annotationColumnError);
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
      if (extraColumns.length) {
        ds_metadata.extra_text_columns = extraColumns;
      } else {
        delete ds_metadata.extra_text_columns;
      }
      const split = parseJson(splitText, "Split") ?? null;

      const payload: any = {
        name,
        project_name: projectName,
        description,
        tags,
        task_type: taskType,
        class_names: classNames,
        ds_metadata,
        split,
        data_source: {
          type: "local_csv",
          config: {
            path: textDataPath,
            text_column: textDataTextColumn,
            label_column: hasAnnotations ? textDataLabelColumn : "",
            id_column: customIndexEnabled ? textDataIdColumn : "",
          },
        },
        annotation_source: null,
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
                Rows:{" "}
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
              href={`/text-datasets/${datasetId}/explore/`}
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

      {report && (
        <div
          className={`border rounded-xl p-4 text-sm ${
            report.ok ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
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
                {TEXT_TASK_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {!isSummarization && (
              <div>
                <label className="text-sm font-medium">
                  Class names (one per line)
                </label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-1 min-h-[160px] font-mono"
                  placeholder={"e.g.\npositive\nnegative"}
                  value={classNamesText}
                  onChange={(e) => setClassNamesText(e.target.value)}
                />
              </div>
            )}
          </section>

          <section className="lg:col-span-2 bg-white border rounded-2xl p-5 shadow-sm space-y-3">
            <h2 className="font-semibold">Data source</h2>

            <div>
              <label className="text-sm font-medium">CSV file path</label>
              <div className="flex gap-2 mt-1">
                <input
                  className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
                  value={textDataPath}
                  onChange={(e) => setTextDataPath(e.target.value)}
                />
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
                      Load CSV columns to choose or change the index column.
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    Used as the dataset index when set.
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
              I already have annotations
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
              <label className="text-sm font-medium">
                Additional columns to display
              </label>
              {textCsvColumns.length > 0 ? (
                <div className="flex flex-wrap gap-2 text-sm">
                  {textCsvColumns.map((col) => (
                    <label
                      key={col}
                      className="inline-flex items-center gap-1 border rounded-full px-3 py-1"
                    >
                      <input
                        type="checkbox"
                        checked={extraColumns.includes(col)}
                        onChange={(e) =>
                          setExtraColumns((prev) =>
                            e.target.checked
                              ? [...prev, col]
                              : prev.filter((c) => c !== col)
                          )
                        }
                      />
                      {col}
                    </label>
                  ))}
                </div>
              ) : extraColumns.length > 0 ? (
                <p className="text-xs text-gray-500">
                  Currently showing: {extraColumns.join(", ")}. Load CSV columns to change the selection.
                </p>
              ) : (
                <p className="text-xs text-gray-500">
                  Load CSV columns to choose which extra fields appear in the annotator and explore view.
                </p>
              )}
            </div>
          </section>

          <section className="lg:col-span-2 bg-white border rounded-2xl p-5 shadow-sm space-y-3">
            <h2 className="font-semibold">Metadata (JSON)</h2>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1 min-h-[180px] font-mono"
              value={metadataText}
              onChange={(e) => setMetadataText(e.target.value)}
            />
          </section>

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
