/**
 * Text classification summary page (text datasets).
 */
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import api from "../../../../../../lib/api";

type Summary = {
  total: number;
  labeled: number;
  skipped: number;
  unlabeled: number;
  by_user: Record<string, number>;
};

export default function TextClassificationSummaryPage() {
  const { id } = useParams<{ id: string }>();
  const datasetId = id || "";
  const { status, data: session } = useSession();
  const [ds, setDs] = useState<any | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | "json" | "csv">(null);

  useEffect(() => {
    if (status !== "authenticated" || !datasetId) return;
    setError(null);
    (async () => {
      try {
        const [datasetRes, summaryRes] = await Promise.all([
          api.get(`/datasets/${datasetId}`),
          api.get(`/datasets/${datasetId}/annotations/text-classification/summary`),
        ]);
        setDs(datasetRes.data);
        setSummary(summaryRes.data);
      } catch (err) {
        console.error(err);
        setError("Failed to load summary.");
      }
    })();
  }, [status, datasetId]);

  const handleExport = async (format: "json" | "csv") => {
    if (!datasetId) return;
    setExporting(format);
    try {
      const res = await api.get(
        `/datasets/${datasetId}/annotations/text-classification/export`,
        {
          params: format === "csv" ? { format: "csv" } : {},
          responseType: format === "csv" ? "blob" : "json",
        }
      );
      const blob =
        format === "csv"
          ? (res.data as Blob)
          : new Blob([JSON.stringify(res.data, null, 2)], {
              type: "application/json",
            });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = (ds?.name || "annotations").replace(/\s+/g, "_");
      a.href = url;
      a.download =
        format === "csv"
          ? `${safeName}_annotations.csv`
          : `${safeName}_annotations.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Failed to export annotations. Please try again.");
    } finally {
      setExporting(null);
    }
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

  if (!ds || !summary) {
    return (
      <div className="bg-white border rounded-2xl p-6 shadow-sm text-sm text-gray-600">
        {error ?? "Loading summary…"}
      </div>
    );
  }

  const progressPct = summary.total
    ? summary.labeled >= summary.total
      ? 100
      : Math.floor((summary.labeled / summary.total) * 100)
    : 0;

  const canAnnotate = ds?.access_level === "editor";
  const canExport = session?.role === "owner" || session?.role === "admin";

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-gray-500">Dataset</div>
            <div className="text-xl font-semibold">{ds.name}</div>
            <div className="text-sm text-gray-500 mt-1">
              {ds.modality?.toUpperCase()} • {ds.task_type ?? "text_classification"}
            </div>
          </div>

          <div className="text-right">
            <div className="text-sm text-gray-600">
              {summary.labeled} / {summary.total} labeled ({progressPct}%)
            </div>
            <div className="w-48 h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-green-600"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-blue-600 mt-4">
          <Link href={`/text-datasets/${datasetId}`} className="underline">
            Dataset Details
          </Link>
          <span className="text-gray-400">·</span>
          <Link href={`/text-datasets/${datasetId}/explore/`} className="underline">
            Explore Rows
          </Link>
          {canAnnotate && (
            <>
              <span className="text-gray-400">·</span>
              <Link
                href={`/text-datasets/${datasetId}/annotate/text-classification`}
                className="underline"
              >
                Open Annotator
              </Link>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {canExport && (
            <>
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
                onClick={() => handleExport("json")}
                disabled={exporting === "json"}
              >
                {exporting === "json" ? "Exporting JSON…" : "Export JSON"}
              </button>
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50 disabled:opacity-50"
                onClick={() => handleExport("csv")}
                disabled={exporting === "csv"}
              >
                {exporting === "csv" ? "Exporting CSV…" : "Export CSV"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-gray-500">Labeled</div>
          <div className="text-2xl font-semibold text-green-600">
            {summary.labeled}
          </div>
        </div>
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-gray-500">Skipped</div>
          <div className="text-2xl font-semibold text-yellow-600">
            {summary.skipped}
          </div>
        </div>
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-gray-500">Unlabeled</div>
          <div className="text-2xl font-semibold text-gray-800">
            {summary.unlabeled}
          </div>
        </div>
      </div>

      <div className="bg-white border rounded-2xl p-4 shadow-sm">
        <div className="font-semibold text-sm">Contributions</div>
        {Object.keys(summary.by_user).length === 0 ? (
          <div className="text-xs text-gray-500 mt-2">
            No manual annotations yet.
          </div>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {Object.entries(summary.by_user).map(([user, count]) => (
              <li key={user} className="flex items-center justify-between">
                <span>{user}</span>
                <span className="text-gray-600">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
