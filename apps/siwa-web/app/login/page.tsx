/**
 * Login page using NextAuth credentials provider.
 * Note: Registration is done via a simple inline form calling /auth/register.
 */

"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import api from "../../lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("user@local.dev");
  const [password, setPassword] = useState("password");
  const [name, setName] = useState("Local User");
  const [isRegister, setIsRegister] = useState(false);
  const [msg, setMsg] = useState("");

  const onSubmit = async (e: any) => {
    e.preventDefault();
    setMsg("");

    try {
      if (isRegister) {
        await api.post("/auth/register", { email, password, name });
      }
      await signIn("credentials", {
        email, password, callbackUrl: "/datasets"
      });
    } catch (err: any) {
      setMsg(err?.response?.data?.detail ?? "Auth error");
    }
  };

  return (
    <div className="max-w-md bg-white p-6 rounded-xl shadow-sm border">
      <h1 className="text-xl font-semibold mb-4">
        {isRegister ? "Register" : "Sign in"}
      </h1>

      <form onSubmit={onSubmit} className="space-y-3">
        {isRegister && (
          <input
            className="w-full border rounded p-2"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <input
          className="w-full border rounded p-2"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full border rounded p-2"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {msg && <p className="text-sm text-red-600">{msg}</p>}

        <button className="w-full bg-black text-white rounded p-2">
          {isRegister ? "Create account" : "Sign in"}
        </button>
      </form>

      <button
        className="text-sm underline mt-3"
        onClick={() => setIsRegister(!isRegister)}
      >
        {isRegister ? "Already have an account? Sign in" : "New user? Register"}
      </button>
    </div>
  );
}
