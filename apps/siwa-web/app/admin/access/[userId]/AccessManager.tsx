"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

import api from "../../../../lib/api";

type AccessLevel = "view" | "editor";

type DatasetAccess = {
  id: string;
  name: string;
  access_level: AccessLevel;
};

type DatasetRef = {
  id: string;
  name: string;
};

type UserDetail = {
  id: string;
  name: string;
  email: string;
  role: string;
  dataset_access: DatasetAccess[];
};

type AssignmentsMap = Record<string, DatasetAccess>;

const accessLevelLabels: Record<AccessLevel, string> = {
  view: "View",
  editor: "Editor",
};

export default function AccessManager({ userId }: { userId: string }) {
  const { status } = useSession();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [datasets, setDatasets] = useState<DatasetRef[]>([]);
  const [assignments, setAssignments] = useState<AssignmentsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [userRes, datasetsRes] = await Promise.all([
        api.get(`/admin/users/${userId}`),
        api.get("/datasets"),
      ]);
      const userData: UserDetail = userRes.data;
      setUser(userData);
      setAssignments(
        Object.fromEntries(
          userData.dataset_access.map((access: DatasetAccess) => [
            access.id,
            access,
          ])
        )
      );
      setDatasets(
        datasetsRes.data.map((ds: { id: string; name: string }) => ({
          id: ds.id,
          name: ds.name,
        }))
      );
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to load dataset access");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const assignedIds = useMemo(() => new Set(Object.keys(assignments)), [
    assignments,
  ]);

  const availableDatasets = useMemo(
    () => datasets.filter((ds) => !assignedIds.has(ds.id)),
    [datasets, assignedIds]
  );

  const handleAdd = (dataset: DatasetRef, level: AccessLevel) => {
    setAssignments((prev) => ({
      ...prev,
      [dataset.id]: {
        id: dataset.id,
        name: dataset.name,
        access_level: level,
      },
    }));
  };

  const handleLevelChange = (id: string, level: AccessLevel) => {
    setAssignments((prev) => ({
      ...prev,
      [id]: { ...prev[id], access_level: level },
    }));
  };

  const handleRemove = (id: string) => {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setStatusMessage("");
    const payload = Object.values(assignments).map((access) => ({
      dataset_id: access.id,
      access_level: access.access_level,
    }));
    try {
      const res = await api.patch(`/admin/users/${userId}/datasets`, {
        assignments: payload,
      });
      const updated: UserDetail = res.data;
      setUser(updated);
      setAssignments(
        Object.fromEntries(
          updated.dataset_access.map((access: DatasetAccess) => [
            access.id,
            access,
          ])
        )
      );
      setStatusMessage("Dataset access saved");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to save dataset access");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center">
        <p className="text-sm text-gray-600">Checking authentication…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center">
        <p className="text-base font-semibold">Sign in required</p>
        <p className="text-sm text-gray-600 mt-1">
          Admin access requires authentication.
        </p>
        <Link
          href="/login"
          className="inline-flex mt-3 px-4 py-2 rounded-lg bg-black text-white text-sm hover:bg-gray-800"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/admin"
          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          ← Back to admin
        </Link>
        <h1 className="text-2xl font-semibold">Dataset access</h1>
        <p className="text-sm text-gray-600">
          Manage dataset access levels for{" "}
          <span className="font-medium text-gray-900">
            {user?.name || userId}
          </span>
          .
        </p>
        {statusMessage && (
          <p className="text-sm text-green-600">{statusMessage}</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {loading ? (
        <div className="bg-white border rounded-2xl p-6 text-center">
          <p className="text-sm text-gray-600">Loading access details…</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="bg-white border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">All datasets</h2>
              <span className="text-xs text-gray-500">
                {availableDatasets.length} available
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Click a button to grant access with the chosen role.
            </p>
            <div className="space-y-3">
              {availableDatasets.map((dataset) => (
                <div
                  key={dataset.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2"
                >
                  <span className="text-sm font-medium">{dataset.name}</span>
                  <div className="flex gap-2">
                    {(["view", "editor"] as AccessLevel[]).map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => handleAdd(dataset, level)}
                        className={`px-3 py-1 text-xs rounded-full border ${
                          level === "editor"
                            ? "bg-black text-white border-black"
                            : "border-gray-200 text-gray-600 hover:border-gray-400"
                        }`}
                      >
                        Grant {accessLevelLabels[level]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {availableDatasets.length === 0 && (
                <p className="text-xs text-gray-500">No datasets available.</p>
              )}
            </div>
          </section>

          <section className="bg-white border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Access granted</h2>
              <span className="text-xs text-gray-500">
                {Object.keys(assignments).length} assigned
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Adjust the level or remove access altogether.
            </p>
            <div className="space-y-3">
              {Object.values(assignments).map((access) => (
                <div
                  key={access.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b pb-2"
                >
                  <div>
                    <p className="text-sm font-medium">{access.name}</p>
                    <p className="text-xs text-gray-500">
                      {accessLevelLabels[access.access_level]} access
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={access.access_level}
                      onChange={(event) =>
                        handleLevelChange(
                          access.id,
                          event.target.value as AccessLevel
                        )
                      }
                      className="text-xs border rounded-lg px-2 py-1"
                    >
                      {(["view", "editor"] as AccessLevel[]).map((level) => (
                        <option key={level} value={level}>
                          {accessLevelLabels[level]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleRemove(access.id)}
                      className="text-xs px-3 py-1 rounded-lg border border-gray-200 hover:border-gray-400"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {Object.values(assignments).length === 0 && (
                <p className="text-xs text-gray-500">
                  No dataset access assigned yet.
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-black text-white text-sm hover:bg-gray-800 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save assignments"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
