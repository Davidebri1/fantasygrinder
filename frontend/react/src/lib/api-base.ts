/**
 * Returns the backend base URL, or `null` if not configured.
 *
 * The front-end runs the in-browser optimizer by default, but talks
 * to the Django backend for ESPN sync, Odds API, server-side audit, etc.
 * when one is reachable.
 *
 * Set `VITE_API_URL=https://your-api.example.com` in the deploy env
 * (Netlify / Render / Vercel) to wire it up.
 */
export function apiBase(): string | null {
  const raw = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  if (!raw) return null;
  return raw.replace(/\/+$/, ""); // trim trailing slash
}
