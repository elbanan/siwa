/**
 * Card showing a registered model's metadata.
 */

import Image from "next/image";
import { ModelEntry } from "../types/model";

const fmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const SOURCE_META: Record<
  string,
  { label: string; icon: string; badgeClass: string }
> = {
  ollama: {
    label: "Ollama",
    icon: "https://uxwing.com/wp-content/themes/uxwing/download/brands-and-social-media/ollama-icon.png",
    badgeClass: "bg-amber-100 text-amber-700",
  },
  torch_file: {
    label: "PyTorch",
    icon: "https://blog.christianperone.com/wp-content/uploads/2018/10/pytorch-logo.png",
    badgeClass: "bg-orange-100 text-orange-700",
  },
  huggingface: {
    label: "HuggingFace",
    icon: "https://registry.npmmirror.com/@lobehub/icons-static-png/1.74.0/files/dark/huggingface-color.png",
    badgeClass: "bg-yellow-100 text-yellow-700",
  },
};

type Props = {
  model: ModelEntry;
  onView: (model: ModelEntry) => void;
  onMarkReady?: (model: ModelEntry) => void;
  onDelete?: (model: ModelEntry) => void;
  isMarking?: boolean;
  isDeleting?: boolean;
};

export default function ModelCard({
  model,
  onView,
  onMarkReady,
  onDelete,
  isMarking,
  isDeleting,
}: Props) {
  const sourceMeta =
    SOURCE_META[model.source_type] ??
    { label: model.source_type, icon: "", badgeClass: "bg-gray-100 text-gray-700" };
  const source =
    model.source_type === "ollama"
      ? model.source_config?.model_name
      : model.source_type === "huggingface"
      ? model.source_config?.repo_id || model.source_config?.path
      : model.source_config?.original_filename || model.source_config?.path;

  const artifactType =
    model.details?.artifact_type ||
    model.details?.ollama?.raw?.model_family ||
    "unknown";

  const size = model.details?.file_size_bytes;
  const readableSize =
    typeof size === "number"
      ? `${(size / (1024 * 1024)).toFixed(2)} MB`
      : model.details?.ollama?.size
      ? `${(model.details.ollama.size / (1024 * 1024)).toFixed(2)} MB`
      : null;

  return (
    <div className="border rounded-xl p-4 bg-white shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-semibold text-lg">{model.name}</h3>
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${sourceMeta.badgeClass}`}
          >
            {sourceMeta.icon ? (
              <Image
                src={sourceMeta.icon}
                alt={sourceMeta.label}
                width={16}
                height={16}
                className="rounded"
              />
            ) : (
              <span className="w-4 h-4 rounded-full bg-gray-300 inline-block" />
            )}
            {sourceMeta.label}
          </span>
          <p className="text-sm text-gray-500">{source || "N/A"}</p>
        </div>
        <span
          className={`text-xs font-semibold px-2 py-1 rounded-full ${
            model.status === "ready"
              ? "bg-green-100 text-green-700"
              : model.status === "error"
              ? "bg-red-100 text-red-700"
              : "bg-yellow-100 text-yellow-700"
          }`}
        >
          {model.status.toUpperCase()}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-gray-500">Artifact</dt>
          <dd className="font-medium">{artifactType}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Size</dt>
          <dd className="font-medium">{readableSize ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Checksum</dt>
          <dd className="font-mono text-xs break-all">{model.checksum ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Created</dt>
          <dd className="font-medium">
            {model.created_at ? fmt.format(new Date(model.created_at)) : "—"}
          </dd>
        </div>
      </dl>

      {model.source_config?.architecture && (
        <p className="text-sm text-gray-600">
          Architecture hint: {model.source_config.architecture}
        </p>
      )}

      {model.error_message && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
          {model.error_message}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => onView(model)}
          className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
        >
          View details
        </button>

        {onMarkReady && model.status !== "ready" && (
          <button
            onClick={() => onMarkReady(model)}
            disabled={isMarking}
            className={`text-sm px-3 py-1.5 rounded-md border ${
              isMarking
                ? "bg-gray-50 text-gray-400 cursor-not-allowed"
                : "hover:bg-gray-50"
            }`}
          >
            {isMarking ? "Marking…" : "Mark ready"}
          </button>
        )}

        {onDelete && (
          <button
            onClick={() => onDelete(model)}
            disabled={isDeleting}
            className={`text-sm px-3 py-1.5 rounded-md border ${
              isDeleting
                ? "bg-red-50 border-red-100 text-red-300 cursor-not-allowed"
                : "border-red-200 text-red-600 hover:bg-red-50"
            }`}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}
