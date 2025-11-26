"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import api from "../../lib/api";

type DatasetRef = { id: string; name: string };
type DatasetAccess = {
  id: string;
  name: string;
  access_level: "view" | "editor";
};

type AdminUserApi = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  dataset_access: DatasetAccess[];
  dataset_ids: string[];
  group_ids: string[];
  group_names: string[];
  can_access_eval: boolean;
};

type EditableUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  datasetAccess: DatasetAccess[];
  groupNames: string[];
  canAccessEval: boolean;
  isUpdating?: boolean;
};

const roleOptions = ["owner", "admin", "editor", "viewer"];

const adaptUser = (user: AdminUserApi): EditableUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  active: user.active,
  datasetAccess: user.dataset_access,
  groupNames: user.group_names,
  canAccessEval: user.can_access_eval,
});

export default function AdminPage() {
  const { status } = useSession();
  const [users, setUsers] = useState<EditableUser[]>([]);
  const [datasets, setDatasets] = useState<DatasetRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newUserForm, setNewUserForm] = useState({
    email: "",
    name: "",
    role: "viewer",
    password: "",
    active: true,
  });
  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersRes, datasetsRes] = await Promise.all([
        api.get("/admin/users"),
        api.get("/datasets"),
      ]);
      setUsers(usersRes.data.map((user: AdminUserApi) => adaptUser(user)));
      setDatasets(
        datasetsRes.data.map((ds: { id: string; name: string }) => ({
          id: ds.id,
          name: ds.name,
        }))
      );
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    loadAdminData();
  }, [status, loadAdminData]);

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
        <p className="text-base font-semibold">Admin access requires sign in.</p>
        <p className="text-sm text-gray-600 mt-2">
          Please sign in with an account that has owner or admin role.
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

  const updateUserInState = (
    userId: string,
    updater: (prev: EditableUser) => EditableUser
  ) => {
    setUsers((prev) =>
      prev.map((user) => (user.id === userId ? updater(user) : user))
    );
  };

  const handleUserAttributeChange = async (
    userId: string,
    payload: { role?: string; active?: boolean; can_access_eval?: boolean },
    successMessage: string
  ) => {
    setError("");
    setStatusMessage("");
    updateUserInState(userId, (user) => ({ ...user, isUpdating: true }));
    try {
      const res = await api.patch(`/admin/users/${userId}`, payload);
      updateUserInState(userId, () => ({
        ...adaptUser(res.data),
        isUpdating: false,
      }));
      setStatusMessage(successMessage);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to update user");
      updateUserInState(userId, (user) => ({ ...user, isUpdating: false }));
    }
  };

  const handleResetPassword = async (user: EditableUser) => {
    const password = prompt(`New password for ${user.email}`);
    if (!password) return;
    setError("");
    setStatusMessage("");
    try {
      await api.patch(`/admin/users/${user.id}/password`, { password });
      setStatusMessage(`Password updated for ${user.email}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to reset password");
    }
  };

  const handleChangeEmail = async (user: EditableUser) => {
    const email = prompt(`New email for ${user.name || user.email}`, user.email);
    if (!email || email === user.email) return;
    setError("");
    setStatusMessage("");
    updateUserInState(user.id, (prev) => ({ ...prev, isUpdating: true }));
    try {
      const res = await api.patch(`/admin/users/${user.id}`, { email });
      updateUserInState(user.id, () => ({ ...adaptUser(res.data), isUpdating: false }));
      setStatusMessage(`Email updated for ${user.email}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to update email");
      updateUserInState(user.id, (prev) => ({ ...prev, isUpdating: false }));
    }
  };

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    setCreatingUser(true);
    setCreateError("");
    setStatusMessage("");
    try {
      const res = await api.post("/admin/users", {
        email: newUserForm.email,
        name: newUserForm.name,
        role: newUserForm.role,
        password: newUserForm.password,
        active: newUserForm.active,
      });
      setUsers((prev) => [adaptUser(res.data), ...prev]);
      setNewUserForm({
        email: "",
        name: "",
        role: "viewer",
        password: "",
        active: true,
      });
      setStatusMessage("User created");
    } catch (err: any) {
      setCreateError(err?.response?.data?.detail || "Failed to create user");
    } finally {
      setCreatingUser(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Admin console</h1>
        <p className="text-sm text-gray-600">
          Manage users and dataset access.
        </p>
        {statusMessage && (
          <p className="text-sm text-green-600">{statusMessage}</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <section className="bg-white border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Users</h2>
            <p className="text-xs text-gray-500">
              Create accounts, toggle active state, and manage roles.
            </p>
          </div>
          {loading && (
            <p className="text-xs text-gray-500">Reloading user list…</p>
          )}
        </div>

        {users.length === 0 && !loading ? (
          <div className="text-sm text-gray-600">
            No users yet. Create one below.
          </div>
        ) : (
          <div className="space-y-4">
            {users.map((user) => (
              <div
                key={user.id}
                className="border border-gray-100 rounded-2xl p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {user.name || user.email}
                    </p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={user.active}
                      disabled={user.isUpdating}
                      onChange={(event) =>
                        handleUserAttributeChange(
                          user.id,
                          { active: event.target.checked },
                          event.target.checked
                            ? "User activated"
                            : "User disabled"
                        )
                      }
                    />
                    Active
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={user.canAccessEval}
                      disabled={user.isUpdating}
                      onChange={(event) =>
                        handleUserAttributeChange(
                          user.id,
                          { can_access_eval: event.target.checked },
                          event.target.checked
                            ? "Eval access granted"
                            : "Eval access revoked"
                        )
                      }
                    />
                    Eval access
                  </label>
                  <select
                    value={user.role}
                    disabled={user.isUpdating}
                      onChange={(event) =>
                        handleUserAttributeChange(
                          user.id,
                          { role: event.target.value },
                          "Role updated"
                        )
                      }
                      className="border rounded-lg px-2 py-1 text-xs"
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Dataset access
                  </p>
                  {user.datasetAccess.length > 0 ? (
                    <div className="flex flex-wrap gap-2 text-xs text-gray-700">
                      {user.datasetAccess.map((access) => (
                        <span
                          key={access.id}
                          className="px-2 py-1 rounded-full border border-gray-200"
                        >
                          {access.name} (
                          {access.access_level === "editor" ? "Editor" : "View"})
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">
                      No dataset access yet.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/access/${user.id}`}
                      className="text-xs font-semibold text-black hover:underline"
                    >
                      Manage dataset access
                    </Link>
                    {user.groupNames.length > 0 && (
                      <span className="text-xs text-gray-500">
                        Via groups: {user.groupNames.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => handleResetPassword(user)}
                    className="px-3 py-1 rounded-lg border border-gray-200 hover:border-gray-400"
                  >
                    Reset password
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeEmail(user)}
                    className="px-3 py-1 rounded-lg border border-gray-200 hover:border-gray-400"
                  >
                    Change email
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={handleCreateUser}
          className="border border-dashed border-gray-200 rounded-2xl p-4 space-y-3"
        >
          <div>
            <p className="text-sm font-semibold">Create new user</p>
            <p className="text-xs text-gray-500">
              Set password, role, and activation for fresh accounts.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Email"
              value={newUserForm.email}
              onChange={(event) =>
                setNewUserForm((prev) => ({
                  ...prev,
                  email: event.target.value,
                }))
              }
              required
              type="email"
            />
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Full name"
              value={newUserForm.name}
              onChange={(event) =>
                setNewUserForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Password"
              type="password"
              value={newUserForm.password}
              onChange={(event) =>
                setNewUserForm((prev) => ({
                  ...prev,
                  password: event.target.value,
                }))
              }
              required
            />
            <select
              className="border rounded-lg px-3 py-2 text-sm"
              value={newUserForm.role}
              onChange={(event) =>
                setNewUserForm((prev) => ({
                  ...prev,
                  role: event.target.value,
                }))
              }
            >
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={newUserForm.active}
                onChange={(event) =>
                  setNewUserForm((prev) => ({
                    ...prev,
                    active: event.target.checked,
                  }))
                }
              />
              Active
            </label>
          </div>
          {createError && (
            <p className="text-xs text-red-600">{createError}</p>
          )}
          <button
            type="submit"
            disabled={creatingUser}
            className="px-4 py-2 rounded-lg bg-black text-white text-sm hover:bg-gray-800 disabled:opacity-60"
          >
            {creatingUser ? "Creating…" : "Create user"}
          </button>
        </form>
      </section>
    </div>
  );
}
