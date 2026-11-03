/**
 * Player headshot component.
 *
 * Resolution order (fastest first):
 *   1. `photoUrl` prop — supplied directly by the data (sample roster).
 *   2. localStorage cache — name → ESPN CDN URL, seeded or previously fetched.
 *   3. ESPN search API — resolves any name (imported rosters, MMA, golf).
 *   4. Initials badge — instant, always works, never empty.
 *
 * The same component is used in the player pool, lineup results, and any
 * other surface, so a player's face is identical everywhere.
 */
import { useEffect, useState } from "react";

interface Props {
  playerId: string;
  name: string;
  sport: "nba" | "nfl" | "mma" | "golf";
  /** Optional direct URL — when present, no lookup is needed. */
  photoUrl?: string | null;
  size?: number;
  className?: string;
}

export const HEADSHOT_CACHE_KEY = "fantasy_grinder_headshots_v2";

export function loadHeadshotCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(HEADSHOT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function seedHeadshotCache(entries: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    const cache = loadHeadshotCache();
    let changed = false;
    for (const [name, url] of Object.entries(entries)) {
      const key = name.trim().toLowerCase();
      if (key && url && !cache[key]) {
        cache[key] = url;
        changed = true;
      }
    }
    if (changed) localStorage.setItem(HEADSHOT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable — resolution still works in-memory */
  }
}

/**
 * Resolve headshots for a batch of names in one pass and cache them, so
 * avatars appear already-loaded instead of popping in row by row.
 * Bounded concurrency keeps us polite to ESPN's API.
 */
export async function prefetchHeadshots(names: string[]): Promise<void> {
  const cache = loadHeadshotCache();
  const todo = [...new Set(names.map((n) => n.trim()).filter(Boolean))].filter(
    (n) => !cache[n.toLowerCase()],
  );
  const CONCURRENCY = 6;
  let idx = 0;

  async function worker() {
    while (idx < todo.length) {
      const name = todo[idx++];
      const url = await lookupEspnHeadshot(name);
      if (url) {
        try {
          const c = loadHeadshotCache();
          c[name.toLowerCase()] = url;
          localStorage.setItem(HEADSHOT_CACHE_KEY, JSON.stringify(c));
        } catch {
          /* ignore quota errors */
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
}

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 48%, 38%)`;
}

const inflight = new Map<string, Promise<string | null>>();

async function lookupEspnHeadshot(name: string): Promise<string | null> {
  const key = normalizeKey(name);
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<string | null> => {
    try {
      const qs = new URLSearchParams({ query: name, limit: "4", region: "us", lang: "en" });
      const res = await fetch(`https://site.web.api.espn.com/apis/search/v2?${qs}`);
      if (!res.ok) return null;
      const data = await res.json();
      for (const section of data.results ?? []) {
        if (section.type !== "player") continue;
        for (const item of section.contents ?? []) {
          const url: string | undefined = item?.image?.default;
          if (url) return url;
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

export function PlayerAvatar({ playerId, name, sport, photoUrl, size = 32, className = "" }: Props) {
  void playerId;
  const key = normalizeKey(name);
  const [src, setSrc] = useState<string | null>(
    photoUrl ?? loadHeadshotCache()[key] ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (photoUrl) {
      setSrc(photoUrl);
      setFailed(false);
      return;
    }
    const cached = loadHeadshotCache()[key];
    if (cached) {
      setSrc(cached);
      setFailed(false);
      return;
    }
    let alive = true;
    lookupEspnHeadshot(name).then((url) => {
      if (!alive || !url) return;
      try {
        const cache = loadHeadshotCache();
        cache[key] = url;
        localStorage.setItem(HEADSHOT_CACHE_KEY, JSON.stringify(cache));
      } catch {
        /* ignore quota errors */
      }
      setSrc(url);
      setFailed(false);
    });
    return () => {
      alive = false;
    };
  }, [name, key, photoUrl]);

  const showImage = src && !failed;

  // A headshot is a headshot: no initials, no disc, no background. ESPN is
  // both the primary and the only source. If a photo isn't available the
  // slot simply stays empty — the player's name sits right beside it.
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
      title={name}
    >
      {showImage && (
        <img
          src={src!}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            width: size,
            height: size,
            objectFit: "contain",
            objectPosition: "center bottom",
            display: "block",
            background: "transparent",
          }}
        />
      )}
    </span>
  );
}

/** Fallback used by non-React callers (e.g. tests). */
export { initials as _initials, colorFor as _colorFor };
