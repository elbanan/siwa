/**
 * Drawer to inspect/edit a single model entry.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { ModelEntry } from "../types/model";

type Props = {
  modelId: string;
  initialModel: ModelEntry | null;
  onClose: () => void;
  onUpdated: (entry: ModelEntry) => void;
  onDeleted: (modelId: string) => void;
};

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "ready", label: "Ready" },
  { value: "error", label: "Error" },
];

export default function ModelDetailsDrawer({
  modelId,
  initialModel,
  onClose,
  onUpdated,
  onDeleted,
}: Props) {
  const [model, setModel] = useState<ModelEntry | null>(initialModel);
  const [loading, setLoading] = useState(!initialModel);
  const [error, setError] = useState("");
  const [formName, setFormName] = useState(initialModel?.name ?? "");
  const [formStatus, setFormStatus] = useState(initialModel?.status ?? "pending");
  const [formArchitecture, setFormArchitecture] = useState(
    initialModel?.source_config?.architecture ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setModel(initialModel);
    setFormName(initialModel?.name ?? "");
    setFormStatus(initialModel?.status ?? "pending");
    setFormArchitecture(initialModel?.source_config?.architecture ?? "");
  }, [initialModel]);

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .get<ModelEntry>(`/models/${modelId}`)
      .then((res) => {
        setModel(res.data);
        setFormName(res.data.name);
        setFormStatus(res.data.status);
        setFormArchitecture(res.data.source_config?.architecture ?? "");
      })
      .catch((e) => {
        const detail = e?.response?.data?.detail ?? "Failed to load model";
        setError(detail);
      })
      .finally(() => setLoading(false));
  }, [modelId]);

  const handleSave = async (override?: { status?: string }) => {
    if (!model) return;
    const payload: Record<string, any> = {};
    const nextStatus = override?.status ?? formStatus;
    if (formName !== model.name) payload.name = formName;
    if (nextStatus !== model.status) payload.status = nextStatus;
    if ((model.source_config?.architecture ?? "") !== formArchitecture) {
      payload.architecture = formArchitecture;
    }
    if (!Object.keys(payload).length) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.patch<ModelEntry>(`/models/${modelId}`, payload);
      setModel(res.data);
      onUpdated(res.data);
      setFormName(res.data.name);
      setFormStatus(res.data.status);
      setFormArchitecture(res.data.source_config?.architecture ?? "");
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? "Failed to update model";
      setError(detail);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this model? This cannot be undone.")) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/models/${modelId}`);
      onDeleted(modelId);
      onClose();
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? "Failed to delete model";
      setError(detail);
    } finally {
      setDeleting(false);
    }
  };

  const sourceSummary = useMemo(() => {
    if (!model) return "Unknown";
    if (model.source_type === "ollama") {
      return `Ollama • ${model.source_config?.model_name ?? "unnamed"}`;
    }
    return `Local PyTorch • ${model.source_config?.original_filename ?? model.source_config?.path}`;
  }, [model]);

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end">
      <div className="bg-white w-full max-w-md h-full shadow-xl flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wider">Model details</p>
            <h2 className="text-lg font-semibold">{model?.name ?? "Loading…"}</h2>
          </div>
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-black">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && <p className="text-sm text-gray-500">Loading model…</p>}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
              {error}
            </p>
          )}

          {model && (
            <>
              <section className="space-y-2">
                <p className="text-xs font-semibold text-gray-500">Overview</p>
                <p className="text-sm text-gray-700">{sourceSummary}</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-gray-500">Status</p>
                    <p className="font-medium">{model.status}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Checksum</p>
                    <p className="font-mono text-xs break-all">{model.checksum ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Created</p>
                    <p className="font-medium">
                      {new Date(model.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Updated</p>
                    <p className="font-medium">
                      {model.updated_at ? new Date(model.updated_at).toLocaleString() : "—"}
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <p className="text-xs font-semibold text-gray-500">Edit</p>
                <label className="text-sm text-gray-600">Display name</label>
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />

                <label className="text-sm text-gray-600">Status</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value)}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {model.source_type === "torch_file" && (
                  <>
                    <label className="text-sm text-gray-600">Architecture hint</label>
                    <input
                      type="text"
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={formArchitecture}
                      onChange={(e) => setFormArchitecture(e.target.value)}
                      placeholder="e.g. MyNet, LlamaForCausalLM…"
                    />
                  </>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleSave()}
                    disabled={saving}
                    className="flex-1 bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSave({ status: "ready" })}
                    disabled={saving}
                    className="flex-1 border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    Mark ready
                  </button>
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-semibold text-gray-500">Source config</p>
                <pre className="bg-gray-100 rounded-lg p-3 text-xs overflow-x-auto">
                  {JSON.stringify(model.source_config ?? {}, null, 2)}
                </pre>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-semibold text-gray-500">Details</p>
                <pre className="bg-gray-100 rounded-lg p-3 text-xs overflow-x-auto">
                  {JSON.stringify(model.details ?? {}, null, 2)}
                </pre>
              </section>
            </>
          )}
        </div>

        <div className="border-t p-4 flex justify-between">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm text-red-600 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete model"}
          </button>
          <button
            onClick={onClose}
            className="text-sm border px-4 py-2 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
