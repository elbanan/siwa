 "use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type TaskSummary = {
  taskId: string;
  taskType: string;
  dataset: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  runId?: string | null;
  currentMetric?: string | null;
  processedRows?: number | null;
  totalRows?: number | null;
};

export default function TasksPage() {
  const { status, data: session } = useSession();
  const hasEvalAccess = Boolean(
    session &&
      (session.role === "owner" || session.role === "admin" || session.canAccessEval)
  );
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHeaders = useMemo(() => {
    if (!session?.accessToken) return undefined;
    return { Authorization: `Bearer ${session.accessToken}` };
  }, [session?.accessToken]);

  const fetchTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/evaluations/tasks`, {
        headers: fetchHeaders,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail ?? "Unable to load tasks.");
      }
      setTasks(payload);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasEvalAccess || status !== "authenticated") return;
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [status, hasEvalAccess, fetchHeaders]);

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => (b.createdAt.localeCompare(a.createdAt))),
    [tasks]
  );

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
        <p className="text-base font-semibold">Sign in to view tasks.</p>
        <p className="text-sm text-gray-500">
          Task monitoring requires authenticated access.
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
        <p className="text-base font-semibold">Access denied</p>
        <p className="text-sm text-gray-500">
          Eval tasks require administrator permissions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="bg-white border rounded-2xl p-6 shadow-sm flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Background tasks</p>
          <h1 className="text-3xl font-semibold text-gray-900 mt-1">Active evaluations</h1>
          <p className="text-gray-600 mt-2 max-w-2xl">
            The queue keeps heavy evaluations out of the main thread. Refreshes every five seconds.
          </p>
        </div>
        <Link
          href="/eval"
          className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700"
        >
          Back to evaluations
        </Link>
      </section>
      <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
        {loading && <p className="text-sm text-gray-500">Loading tasks…</p>}
        {error && (
          <p className="text-sm text-red-600 border border-red-100 px-3 py-2 rounded-xl bg-red-50">
            {error}
          </p>
        )}
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-[0.3em] text-gray-500">Dataset</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-[0.3em] text-gray-500">Task</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-[0.3em] text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-[0.3em] text-gray-500">Progress</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-[0.3em] text-gray-500">Created</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-[0.3em] text-gray-500">Run</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-[0.3em] text-gray-500">Message</th>
                </tr>
              </thead>
              <tbody>
              {sortedTasks.map((task) => (
                <tr key={task.taskId} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-semibold text-gray-900">{task.dataset}</td>
                  <td className="px-3 py-2">{task.taskType}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-1 rounded-full text-[0.65rem] font-semibold uppercase tracking-[0.3em] ${
                        task.status === "running"
                          ? "bg-sky-50 text-sky-600"
                          : task.status === "completed"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-600"
                      }`}
                      >
                        {task.status}
                      </span>
                    </td>
                  <td className="px-3 py-2">
                    {task.currentMetric ? (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-gray-900">{task.currentMetric}</p>
                        {typeof task.processedRows === "number" &&
                          typeof task.totalRows === "number" &&
                          task.totalRows > 0 && (
                            <p className="text-[0.65rem] text-gray-500">
                              {task.processedRows}/{task.totalRows} rows
                            </p>
                          )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {new Date(task.createdAt).toLocaleString()}
                  </td>
                <td className="px-3 py-2">
                  {task.runId ? (
                      <Link
                        href={`/eval/runs/${task.runId}`}
                        className="text-xs font-semibold text-gray-900"
                      >
                        View run
                      </Link>
                  ) : (
                    <span className="text-xs text-gray-500">Queued</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {task.error ? (
                    <span className="text-xs text-red-600">{task.error}</span>
                  ) : (
                    <span>—</span>
                  )}
                </td>
              </tr>
              ))}
              {!sortedTasks.length && !loading && (
                <tr>
                  <td className="px-3 py-4 text-sm text-gray-500" colSpan={5}>
                    No background tasks currently running.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
