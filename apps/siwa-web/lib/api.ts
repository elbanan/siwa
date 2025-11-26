/**
 * Axios API client configured for local backend.
 * Automatically attaches JWT from NextAuth session when available.
 */

import axios from "axios";
import { getSession } from "next-auth/react";

const isServer = typeof window === "undefined";
const baseURL = isServer
  ? process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL
  : process.env.NEXT_PUBLIC_API_URL;

const api = axios.create({
  baseURL,
});

api.interceptors.request.use(async (config) => {
  const session = await getSession();
  const token = (session as any)?.accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
