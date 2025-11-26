"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useSession } from "next-auth/react";

import api from "../../../lib/api";

export default function AccountPasswordPage() {
  const { status } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (status === "loading") {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center">
        <p className="text-sm text-gray-600">Checking your session…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center">
        <p className="text-base font-semibold">Sign in required</p>
        <p className="text-sm text-gray-600 mt-1">
          Log in to manage your account password.
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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (newPassword !== confirmPassword) {
      setError("New passwords must match");
      return;
    }
    setLoading(true);
    try {
      await api.patch("/auth/password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setMessage("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border rounded-2xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Account</h1>
      <p className="text-sm text-gray-600">
        Keep your credentials up to date by rotating passwords regularly.
      </p>
      {message && <p className="text-sm text-green-600">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold tracking-wide text-gray-600">
            Current password
          </label>
          <input
            type="password"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold tracking-wide text-gray-600">
            New password
          </label>
          <input
            type="password"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold tracking-wide text-gray-600">
            Confirm new password
          </label>
          <input
            type="password"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 rounded-lg bg-black text-white text-sm hover:bg-gray-800 disabled:opacity-60"
        >
          {loading ? "Saving…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
