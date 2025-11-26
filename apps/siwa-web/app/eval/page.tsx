"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type EvaluationRunSummary = {
  id: string;
  dataset: string;
  metric: string;
  status: string;
  accuracy: number;
  evaluationType?: "classification" | "text";
  summaryLabel?: string;
  summaryValue?: number;
  selectedMetrics?: string[];
  metricParameters?: Record<string, Record<string, unknown>>;
  createdAt: string;
  completedAt?: string | null;
  truthColumn: string;
  predictionColumn: string;
  sourcePath?: string | null;
  description?: string | null;
  fileName?: string | null;
  mode?: string;
};

const badgeTone = (status: string) => {
  const normalized = status?.toLowerCase() ?? "";
  if (normalized === "completed") return "bg-emerald-50 text-emerald-700";
  if (normalized === "running") return "bg-sky-50 text-sky-600";
  return "bg-gray-50 text-gray-600";
};

export default function EvalPage() {
  const [runs, setRuns] = useState<EvaluationRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { status, data: session } = useSession();
  const hasEvalAccess = Boolean(
    session &&
      (session.role === "owner" ||
        session.role === "admin" ||
        session.canAccessEval)
  );

  const fetchHeaders = useMemo(() => {
    if (!session?.accessToken) return undefined;
    return { Authorization: `Bearer ${session.accessToken}` };
  }, [session?.accessToken]);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
    const response = await fetch(`${API_BASE}/evaluations/runs`, {
      headers: fetchHeaders,
    });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail ?? "Unable to load runs.");
      }
      setRuns(payload);
    } catch (err) {
      console.error(err);
      setError("Unable to load runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !hasEvalAccess) return;
    fetchRuns();
  }, [fetchRuns, hasEvalAccess, status]);

  const filteredRuns = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return runs;
    return runs.filter(
      (run) =>
        run.dataset.toLowerCase().includes(normalized) ||
        run.metric.toLowerCase().includes(normalized)
    );
  }, [query, runs]);

  if (status === "loading") {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center">
        <p className="text-sm text-gray-600">Checking authentication…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center space-y-2">
        <p className="text-base font-semibold">Sign in to use eval.</p>
        <p className="text-sm text-gray-500">
          Eval workflows are available only to authenticated accounts with admin-approved access.
        </p>
        <Link
          href="/login"
          className="inline-flex mt-2 px-4 py-2 rounded-lg bg-black text-white text-sm hover:bg-gray-900"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (!hasEvalAccess) {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center space-y-2">
        <p className="text-base font-semibold">Restricted</p>
        <p className="text-sm text-gray-500">
          Eval access requires admin approval. Please contact your administrator to enable the Eval tab.
        </p>
      </div>
    );
  }

  const handleDelete = async (runId: string) => {
    if (!confirm("Delete this run? This cannot be undone.")) return;
    setDeletingId(runId);
    try {
      const response = await fetch(`${API_BASE}/evaluations/runs/${runId}`, {
        method: "DELETE",
        headers: fetchHeaders,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.detail ?? "Failed to delete run.");
      }
      setRuns((prev) => prev.filter((run) => run.id !== runId));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to delete run.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="flex justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Evaluation</p>
            <h1 className="text-3xl font-semibold text-gray-900 mt-1">Run model assessments</h1>
            <p className="text-gray-600 mt-2 max-w-2xl">
              Schedule evaluation tasks on labeled datasets, watch the progress stream in the UI,
              and review helpful metrics as soon as the run completes.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
          <div className="flex flex-wrap gap-2">
              <Link
                href="/eval/runs/new"
                className="px-4 py-2 rounded-lg bg-black text-white font-semibold text-sm"
              >
                + Create classification run
              </Link>
              <Link
                href="/eval/text"
                className="px-4 py-2 rounded-lg bg-white border border-black text-black font-semibold text-sm"
              >
                + Create text run
              </Link>
              <Link
                href="/eval/tasks"
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-semibold"
              >
                View tasks
              </Link>
              <button
                type="button"
                onClick={fetchRuns}
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm"
              >
                Refresh runs
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white border rounded-xl p-3 flex flex-col md:flex-row gap-3 md:items-center">
        <input
          className="w-full md:flex-1 border rounded-xl px-3 py-2 text-sm"
          placeholder="Search runs by dataset or metric..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          onClick={() => setQuery("")}
          className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm"
        >
          Clear
        </button>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Past runs</h2>
            <p className="text-sm text-gray-500">Latest runs appear first.</p>
          </div>
          <span className="text-xs uppercase tracking-[0.4em] text-gray-400">{runs.length} total</span>
        </div>

        {loading && <p className="text-sm text-gray-500">Loading runs…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && runs.length === 0 && (
          <p className="text-sm text-gray-500">Create a run to see evaluation results.</p>
        )}
        {!loading && runs.length > 0 && filteredRuns.length === 0 && (
          <p className="text-sm text-gray-500">No runs match that query.</p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {filteredRuns.map((run) => {
            const summaryValue = run.summaryValue ?? run.accuracy ?? 0;
            const summaryLabel = run.summaryLabel ?? "Accuracy";
            return (
              <div key={run.id} className="rounded-2xl border border-gray-100 bg-white p-4 space-y-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{run.dataset}</p>
                    <p className="text-xs text-gray-500 truncate">{run.metric}</p>
                  </div>
                  <span className={`text-[0.65rem] font-semibold uppercase tracking-[0.35em] px-3 py-1 rounded-full ${badgeTone(run.status)}`}>
                    {run.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                  <div>
                    <p className="text-[0.6rem] uppercase tracking-[0.4em] text-gray-400">{summaryLabel}</p>
              <p className="text-sm font-semibold text-gray-900">{(summaryValue * 100).toFixed(4)}%</p>
                  </div>
                  <div>
                    <p className="text-[0.6rem] uppercase tracking-[0.4em] text-gray-400">Run at</p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{new Date(run.completedAt ?? run.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Columns: {run.truthColumn} vs {run.predictionColumn}
                </p>
                {run.fileName && (
                  <p className="text-[0.65rem] text-gray-500 truncate">CSV: {run.fileName}</p>
                )}
                {run.description && (
                  <p className="text-[0.65rem] text-gray-500 italic">
                    {run.description}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <Link
                    href={`/eval/runs/${run.id}`}
                    className="text-sm font-semibold text-gray-900"
                  >
                    View run ↗
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(run.id)}
                    disabled={deletingId === run.id}
                    className="text-xs text-red-600 active:text-red-700"
                  >
                    {deletingId === run.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
