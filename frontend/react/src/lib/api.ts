/// <reference types="vite/client" />

/**
 * Typed Axios client. All API calls go through this module so we have
 * a single place to handle errors, retries, and base URL.
 */
import axios, { AxiosError } from "axios";

const baseURL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

export const api = axios.create({
  baseURL,
  timeout: 120_000,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 429) {
      console.warn("[api] hit /optimize rate limit");
    }
    return Promise.reject(err);
  },
);
