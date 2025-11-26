/**
 * Models page - list + add new models (Ollama, PyTorch, HuggingFace).
 */

"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import api from "../../lib/api";
import ModelCard from "../../components/ModelCard";
import { ModelEntry } from "../../types/model";
import ModelDetailsDrawer from "../../components/ModelDetailsDrawer";

type OllamaInfo = {
  name: string;
  digest?: string;
  size?: number;
  modified_at?: string;
};

type HuggingFaceInfo = {
  name: string;
  repo_id: string;
  path: string;
  modified_at?: number;
  base_path: string;
};

export default function ModelsPage() {
  const { status } = useSession();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelEntry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const fetchModels = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .get<ModelEntry[]>("/models")
      .then((res) => setModels(res.data))
      .catch((e) => {
        const detail = e?.response?.data?.detail ?? "Failed to load models";
        setError(detail);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchModels();
    }
  }, [status, fetchModels]);

  const handleCreated = (entry: ModelEntry) => {
    setModels((prev) => [entry, ...prev]);
  };

  const handleUpdated = (entry: ModelEntry) => {
    setModels((prev) => prev.map((m) => (m.id === entry.id ? entry : m)));
    setSelectedModel(entry);
  };

  const handleDeleted = (id: string) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
    if (selectedModelId === id) {
      setSelectedModelId(null);
      setSelectedModel(null);
    }
  };

  const openDetails = (entry: ModelEntry) => {
    setSelectedModelId(entry.id);
    setSelectedModel(entry);
  };

  const handleMarkReady = async (entry: ModelEntry) => {
    setMarkingId(entry.id);
    setError("");
    try {
      const res = await api.patch<ModelEntry>(`/models/${entry.id}`, {
        status: "ready",
      });
      handleUpdated(res.data);
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? "Failed to mark model ready";
      setError(detail);
    } finally {
      setMarkingId(null);
    }
  };

  const handleDelete = async (entry: ModelEntry) => {
    if (!confirm("Delete this model? This cannot be undone.")) return;
    setDeletingId(entry.id);
    setError("");
    try {
      await api.delete(`/models/${entry.id}`);
      handleDeleted(entry.id);
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? "Failed to delete model";
      setError(detail);
    } finally {
      setDeletingId(null);
    }
  };

  if (status === "unauthenticated") {
    return (
      <div className="bg-white border rounded-2xl p-10 text-center">
        <h1 className="text-xl font-semibold">Sign in required</h1>
        <p className="text-sm text-gray-600 mt-2">
          Sign in to register and manage models.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
          <p className="text-sm text-gray-600 mt-1">
            Register Ollama endpoints, local PyTorch checkpoints, or cached HuggingFace models for TRAIN / GENERATE flows.
          </p>
        </div>
        <button
          onClick={fetchModels}
          className="px-4 py-2 rounded-lg border text-sm hover:bg-gray-50 w-fit"
        >
          Refresh
        </button>
      </div>

      <AddModelPanel onCreated={handleCreated} />

      {loading && <p className="text-sm text-gray-600">Loading models…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {models.length === 0 && !loading ? (
        <div className="bg-white border rounded-2xl p-10 text-center">
          <p className="text-gray-700 font-medium">No models registered yet.</p>
          <p className="text-sm text-gray-600 mt-1">
            Use the form above to link an Ollama model, upload a PyTorch checkpoint, or point to a local HuggingFace cache.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              onView={openDetails}
              onMarkReady={handleMarkReady}
              onDelete={handleDelete}
              isMarking={markingId === model.id}
              isDeleting={deletingId === model.id}
            />
          ))}
        </div>
      )}

      {selectedModelId && (
        <ModelDetailsDrawer
          modelId={selectedModelId}
          initialModel={selectedModel}
          onClose={() => {
            setSelectedModelId(null);
            setSelectedModel(null);
          }}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}

function AddModelPanel({ onCreated }: { onCreated: (entry: ModelEntry) => void }) {
  const [mode, setMode] = useState<"ollama" | "torch" | "huggingface">("ollama");

  // Ollama states
  const [ollamaOptions, setOllamaOptions] = useState<OllamaInfo[]>([]);
  const [ollamaError, setOllamaError] = useState("");
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [ollamaSelection, setOllamaSelection] = useState("");
  const [ollamaName, setOllamaName] = useState("");
  const [ollamaEndpoint, setOllamaEndpoint] = useState("http://127.0.0.1:11434");
  const [pullNow, setPullNow] = useState(true);
  const [submittingOllama, setSubmittingOllama] = useState(false);

  // Local Torch states
  const [localName, setLocalName] = useState("");
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localArchitecture, setLocalArchitecture] = useState("");
  const [localFormat, setLocalFormat] =
    useState<"auto" | "module" | "state_dict" | "state_bundle">("auto");
  const [localError, setLocalError] = useState("");
  const [submittingLocal, setSubmittingLocal] = useState(false);

  // HuggingFace states
  const [hfOptions, setHfOptions] = useState<HuggingFaceInfo[]>([]);
  const [hfSelection, setHfSelection] = useState("");
  const [hfName, setHfName] = useState("");
  const [hfMode, setHfMode] = useState<"default" | "custom">("default");
  const [hfCustomPath, setHfCustomPath] = useState("");
  const [hfError, setHfError] = useState("");
  const [hfLoading, setHfLoading] = useState(false);
  const [submittingHf, setSubmittingHf] = useState(false);

  const fetchOllama = useCallback(() => {
    setOllamaLoading(true);
    setOllamaError("");
    api
      .get<{ models: OllamaInfo[]; error?: string }>("/models/sources/ollama")
      .then((res) => {
        const models = res.data.models || [];
        setOllamaOptions(models);
        setOllamaError(res.data.error ?? "");
        const defaultName = models[0]?.name;
        if (defaultName) {
          setOllamaSelection((prev) => prev || defaultName);
          setOllamaName((prev) => prev || defaultName);
        }
      })
      .catch((e) => {
        const detail = e?.response?.data?.detail ?? "Unable to list Ollama models";
        setOllamaError(detail);
      })
      .finally(() => setOllamaLoading(false));
  }, []);

  useEffect(() => {
    fetchOllama();
  }, [fetchOllama]);

  const fetchHuggingFace = useCallback((customBase?: string) => {
    setHfLoading(true);
    setHfError("");
    api
      .get<{ models: HuggingFaceInfo[]; error?: string }>("/models/sources/huggingface", {
        params: customBase ? { base_path: customBase } : undefined,
      })
      .then((res) => {
        const list = res.data.models || [];
        setHfOptions(list);
        setHfError(res.data.error ?? "");
        if (list.length) {
          setHfSelection(list[0].path);
          setHfName((prev) => prev || list[0].name);
        } else {
          setHfSelection("");
        }
      })
      .catch((e) => {
        const detail = e?.response?.data?.detail ?? "Unable to list HuggingFace models";
        setHfError(detail);
      })
      .finally(() => setHfLoading(false));
  }, [hfSelection]);

  useEffect(() => {
    if (mode === "huggingface" && hfOptions.length === 0 && !hfLoading) {
      fetchHuggingFace();
    }
  }, [mode, hfOptions.length, hfLoading, fetchHuggingFace]);

  const handleOllamaSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ollamaSelection) {
      setOllamaError("Select an Ollama model.");
      return;
    }
    setSubmittingOllama(true);
    setOllamaError("");
    api
      .post<ModelEntry>("/models/ollama", {
        name: ollamaName || ollamaSelection,
        model_name: ollamaSelection,
        pull_now: pullNow,
        server_host: ollamaEndpoint,
      })
      .then((res) => {
        onCreated(res.data);
        setOllamaName("");
      })
      .catch((e) => {
        const detail = e?.response?.data?.detail ?? "Failed to register model";
        setOllamaError(detail);
      })
      .finally(() => setSubmittingOllama(false));
  };

  const handleLocalSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!localFile) {
      setLocalError("Choose a PyTorch file to upload.");
      return;
    }
    setSubmittingLocal(true);
    setLocalError("");
    const fd = new FormData();
    fd.append("name", localName || localFile.name);
    fd.append("artifact_format", localFormat);
    if (localArchitecture) {
      fd.append("architecture", localArchitecture);
    }
    fd.append("file", localFile);

    api
      .post<ModelEntry>("/models/local", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((res) => {
        onCreated(res.data);
        setLocalName("");
        setLocalFile(null);
        setLocalArchitecture("");
        setLocalFormat("auto");
      })
      .catch((e) => {
        const detail = e?.response?.data?.detail ?? "Failed to upload model";
        setLocalError(detail);
      })
      .finally(() => setSubmittingLocal(false));
  };

  return (
    <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`px-4 py-2 rounded-lg text-sm border ${
            mode === "ollama"
              ? "bg-black text-white border-black"
              : "hover:bg-gray-50"
          }`}
          onClick={() => setMode("ollama")}
        >
          Link Ollama model
        </button>
        <button
          type="button"
          className={`px-4 py-2 rounded-lg text-sm border ${
            mode === "torch"
              ? "bg-black text-white border-black"
              : "hover:bg-gray-50"
          }`}
          onClick={() => setMode("torch")}
        >
          Upload PyTorch file
        </button>
        <button
          type="button"
          className={`px-4 py-2 rounded-lg text-sm border ${
            mode === "huggingface"
              ? "bg-black text-white border-black"
              : "hover:bg-gray-50"
          }`}
          onClick={() => setMode("huggingface")}
        >
          Add HuggingFace model
        </button>
      </div>

      {mode === "ollama" ? (
        <form onSubmit={handleOllamaSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Model</label>
            <button
              type="button"
              onClick={fetchOllama}
              className="text-xs px-2 py-1 border rounded-md hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={ollamaSelection}
            onChange={(e) => {
              setOllamaSelection(e.target.value);
              if (!ollamaName) setOllamaName(e.target.value);
            }}
            disabled={ollamaLoading || !ollamaOptions.length}
          >
            {ollamaOptions.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
                {option.size ? ` (${(option.size / (1024 * 1024)).toFixed(1)} MB)` : ""}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Display name"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={ollamaName}
            onChange={(e) => setOllamaName(e.target.value)}
          />

          <input
            type="text"
            placeholder="Ollama endpoint (e.g. http://127.0.0.1:11434)"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={ollamaEndpoint}
            onChange={(e) => setOllamaEndpoint(e.target.value)}
          />

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={pullNow}
              onChange={(e) => setPullNow(e.target.checked)}
            />
            Mark as ready for immediate use
          </label>

          {ollamaError && <p className="text-sm text-red-600">{ollamaError}</p>}

          <button
            type="submit"
            disabled={submittingOllama}
            className="bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {submittingOllama ? "Linking…" : "Link model"}
          </button>
        </form>
      ) : mode === "torch" ? (
        <form onSubmit={handleLocalSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Model name"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
          />

          <input
            type="file"
            accept=".pt,.pth,.bin,.ckpt,.torch"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            onChange={(e) => setLocalFile(e.target.files?.[0] || null)}
          />

          <select
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={localFormat}
            onChange={(e) =>
              setLocalFormat(e.target.value as typeof localFormat)
            }
          >
            <option value="auto">Auto detect format</option>
            <option value="module">Full torch module</option>
            <option value="state_dict">State dict</option>
            <option value="state_bundle">State dict with config</option>
          </select>

          <input
            type="text"
            placeholder="Architecture / class name (optional)"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={localArchitecture}
            onChange={(e) => setLocalArchitecture(e.target.value)}
          />

          {localError && <p className="text-sm text-red-600">{localError}</p>}

          <button
            type="submit"
            disabled={submittingLocal}
            className="bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {submittingLocal ? "Uploading…" : "Upload model"}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!hfSelection) {
            setHfError("Select a model from the list.");
            return;
          }
          const selected = hfOptions.find((m) => m.path === hfSelection);
          setSubmittingHf(true);
          setHfError("");
          api
            .post<ModelEntry>("/models/huggingface", {
              name: hfName || selected?.name || "HF Model",
              path: selected?.path || hfSelection,
              repo_id: selected?.repo_id,
            })
            .then((res) => {
              onCreated(res.data);
              setHfName("");
              setHfSelection("");
            })
            .catch((e) => {
              const detail = e?.response?.data?.detail ?? "Failed to add model";
              setHfError(detail);
            })
            .finally(() => setSubmittingHf(false));
        }} className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              className={`px-3 py-1.5 rounded-md border text-sm ${
                hfMode === "default"
                  ? "bg-black text-white border-black"
                  : "hover:bg-gray-50"
              }`}
              onClick={() => {
                setHfMode("default");
                fetchHuggingFace();
              }}
            >
              Default HF cache
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 rounded-md border text-sm ${
                hfMode === "custom"
                  ? "bg-black text-white border-black"
                  : "hover:bg-gray-50"
              }`}
              onClick={() => setHfMode("custom")}
            >
              Custom directory
            </button>
          </div>

          {hfMode === "custom" && (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                className="border rounded-lg px-3 py-2 text-sm"
                placeholder="Path to HuggingFace cache (folder containing models--*)"
                value={hfCustomPath}
                onChange={(e) => setHfCustomPath(e.target.value)}
              />
              <button
                type="button"
                onClick={() => fetchHuggingFace(hfCustomPath)}
                className="px-3 py-1.5 rounded-md border text-sm hover:bg-gray-50 w-fit"
              >
                Load models
              </button>
            </div>
          )}

          <select
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={hfSelection}
            onChange={(e) => {
              setHfSelection(e.target.value);
              const selected = hfOptions.find((m) => m.path === e.target.value);
              if (selected && !hfName) setHfName(selected.name);
            }}
            disabled={hfLoading || !hfOptions.length}
          >
            <option value="">Select local HuggingFace model…</option>
            {hfOptions.map((option) => (
              <option key={option.path} value={option.path}>
                {option.name} ({option.base_path})
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Display name"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={hfName}
            onChange={(e) => setHfName(e.target.value)}
          />

          {hfError && <p className="text-sm text-red-600">{hfError}</p>}

          <button
            type="submit"
            disabled={submittingHf || hfLoading}
            className="bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {submittingHf ? "Linking…" : "Link HuggingFace model"}
          </button>
        </form>
      )}
    </div>
  );
}
