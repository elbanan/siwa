/**
 * DATA Home / Dataset list (auth-aware).
 *
 * Fix:
 * NextAuth session loads asynchronously. If we fetch immediately on mount,
 * the request goes without a bearer token and FastAPI returns 401.
 * So we wait for status === "authenticated".
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import api from "../../lib/api";
import DatasetCard from "../../components/DatasetCard";
import Link from "next/link";
import { useSession } from "next-auth/react";

export default function DatasetsPage() {
  const { status } = useSession(); // "loading" | "authenticated" | "unauthenticated"

  const [datasets, setDatasets] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  useEffect(() => {
    // Wait until session is ready and authenticated
    if (status !== "authenticated") return;

    setError("");
    api.get("/datasets")
      .then((res) => setDatasets(res.data))
      .catch((e) =>
        setError(e?.response?.data?.detail ?? "Failed to load datasets")
      );
  }, [status]);

  const filtered = useMemo(() => {
    let out = datasets;
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((d) =>
        d.name.toLowerCase().includes(q) ||
        (d.tags || []).some((t: string) => t.toLowerCase().includes(q))
      );
    }
    if (filterStatus !== "all") {
      out = out.filter((d) => d.status === filterStatus);
    }
    return out;
  }, [datasets, query, filterStatus]);

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((d) => d.id)));
    }
  };

  const handleDelete = async (datasetId: string) => {
    if (!confirm("Delete this dataset? This cannot be undone.")) return;
    setError("");
    setDeletingId(datasetId);
    try {
      await api.delete(`/datasets/${datasetId}`);
      setDatasets((prev) => prev.filter((d) => d.id !== datasetId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(datasetId);
        return next;
      });
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? "Failed to delete dataset";
      setError(detail);
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} datasets? This cannot be undone.`)) return;
    setError("");
    setIsBulkDeleting(true);

    // We'll try to delete all, and report errors if any
    const ids = Array.from(selectedIds);
    const failures: string[] = [];

    for (const id of ids) {
      try {
        await api.delete(`/datasets/${id}`);
        setDatasets((prev) => prev.filter((d) => d.id !== id));
      } catch (e: any) {
        console.error(`Failed to delete ${id}`, e);
        failures.push(id);
      }
    }

    if (failures.length > 0) {
      setError(`Failed to delete ${failures.length} datasets.`);
      // Keep failed ones selected
      setSelectedIds(new Set(failures));
    } else {
      setSelectedIds(new Set());
    }
    setIsBulkDeleting(false);
  };

  // If user is not logged in, don't call API; show CTA
  if (status === "unauthenticated") {
    return (
      <div className="bg-white border rounded-2xl p-10 text-center">
        <h1 className="text-xl font-semibold">Sign in required</h1>
        <p className="text-sm text-gray-600 mt-2">
          You need to sign in to view and manage datasets.
        </p>
        <Link
          href="/login"
          className="inline-block mt-4 bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 text-sm"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Data</p>
            <h1 className="text-3xl font-semibold text-gray-900 mt-1">Datasets</h1>
            <p className="text-gray-600 mt-2 max-w-2xl">
              Manage, explore, and share local datasets. Streamline your workflow from raw data to training and evaluation.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/datasets/new"
              className="px-4 py-2 rounded-lg bg-black text-white font-semibold text-sm shadow-sm transition hover:bg-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              + New image dataset
            </Link>
            <Link
              href="/text-datasets/new"
              className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-semibold text-sm transition hover:border-gray-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500"
            >
              + New text dataset
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white border rounded-xl p-3 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex items-center gap-2 pl-2">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={filtered.length > 0 && selectedIds.size === filtered.length}
            onChange={handleSelectAll}
            disabled={filtered.length === 0}
          />
          <span className="text-sm text-gray-500 whitespace-nowrap">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
          </span>
        </div>

        <div className="h-6 w-px bg-gray-200 hidden md:block mx-2"></div>

        <input
          className="w-full md:flex-1 border rounded-xl px-3 py-2 text-sm"
          placeholder="Search datasets by name or tag..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <select
          className="border rounded-xl px-3 py-2 text-sm md:w-48"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="ready">Ready</option>
          <option value="configured">Configured</option>
          <option value="invalid_config">Invalid config</option>
        </select>

        {selectedIds.size > 0 && (
          <button
            onClick={handleBulkDelete}
            disabled={isBulkDeleting}
            className="px-4 py-2 rounded-lg bg-red-50 text-red-600 border border-red-100 text-sm font-medium hover:bg-red-100 whitespace-nowrap"
          >
            {isBulkDeleting ? "Deleting..." : `Delete (${selectedIds.size})`}
          </button>
        )}
      </section>

      {status === "loading" && (
        <p className="text-sm text-gray-600">Loading session…</p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {filtered.length === 0 && !error ? (
        <div className="bg-white border rounded-2xl p-10 text-center">
          <p className="text-gray-700 font-medium">
            No datasets accessible yet.
          </p>
          <p className="text-sm text-gray-600 mt-1">
            Request access from an admin or create one to get started.
          </p>
          <Link
            href="/datasets/new"
            className="inline-block mt-4 bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 text-sm"
          >
            Create dataset
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {filtered.map((ds) => (
            <DatasetCard
              key={ds.id}
              ds={ds}
              onDelete={handleDelete}
              isDeleting={deletingId === ds.id}
              selected={selectedIds.has(ds.id)}
              onToggleSelect={handleToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
