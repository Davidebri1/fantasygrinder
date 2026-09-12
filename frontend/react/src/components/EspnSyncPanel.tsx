/**
 * ESPN sync — fetches injury + news from the backend.
 *
 * Talks to `/api/feed/espn/`. The backend hits the ESPN public API and
 * persists rows to Postgres (NBA injury + news tables). The front-end
 * calls this endpoint, displays what came back, and badges any player
 * in the active pool who has an "OUT" status.
 *
 * The endpoint requires the backend to be deployed. If the backend
 * is unreachable we show a clear message instead of pretending it worked.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Card } from "./Card";
import { apiBase } from "@/lib/api-base";

export interface InjuryRow {
  player_id: string;
  name: string;
  team: string;
  status: string;
  severity: string;
  short_comment: string;
}

export interface NewsRow {
  player_id?: string;
  title: string;
  published: string;
  link: string;
}

export function useEspnSync(sport: "nba" | "mma" | "golf") {
  const qc = useQueryClient();
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const sync = useMutation({
    mutationFn: async (): Promise<{ injuries_synced: number; news_synced: number; warnings: string[] }> => {
      const base = apiBase();
      if (!base) {
        throw new Error(
          "Backend not configured. Set VITE_API_URL or run `pwsh bin/dev.ps1` to start Django locally.",
        );
      }
      const res = await fetch(`${base}/api/feed/espn/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ESPN sync failed: ${res.status} ${text}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setLastSyncAt(new Date().toISOString());
      qc.invalidateQueries({ queryKey: ["espn-injuries", sport] });
    },
  });

  const injuries = useQuery({
    queryKey: ["espn-injuries", sport],
    queryFn: async (): Promise<InjuryRow[]> => {
      const base = apiBase();
      if (!base) return [];
      const res = await fetch(`${base}/api/nba/injuries/`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: sport === "nba",
    refetchInterval: 5 * 60 * 1000, // 5 min
  });

  const news = useQuery({
    queryKey: ["espn-news", sport],
    queryFn: async (): Promise<NewsRow[]> => {
      const base = apiBase();
      if (!base) return [];
      const res = await fetch(`${base}/api/nba/news/`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: sport === "nba",
    refetchInterval: 10 * 60 * 1000, // 10 min
  });

  return { sync, injuries, news, lastSyncAt };
}

interface Props {
  sport: "nba" | "mma" | "golf";
  /** Players currently in the pool — for OUT-badging. */
  playerNames?: string[];
}

export function EspnSyncPanel({ sport, playerNames = [] }: Props) {
  const { sync, injuries, news, lastSyncAt } = useEspnSync(sport);
  const backendConfigured = !!apiBase();

  if (sport !== "nba") {
    return (
      <Card className="p-4" title="Injury & News Sync">
        <p className="text-sm text-ink-muted">
          ESPN sync is currently NBA-only. MMA and Golf news feeds coming soon.
        </p>
      </Card>
    );
  }

  const myInjuries = (injuries.data ?? []).filter((row) =>
    playerNames.some((n) => n.toLowerCase() === row.name.toLowerCase()),
  );

  return (
    <Card
      className="p-4"
      title="ESPN Injury & News"
      actions={
        <button
          onClick={() => sync.mutate()}
          disabled={!backendConfigured || sync.isPending}
          className="text-xs px-3 py-1.5 bg-brand text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
        >
          {sync.isPending ? "Syncing…" : "Sync now"}
        </button>
      }
    >
      {!backendConfigured && (
        <p className="text-sm text-accent-warning mb-3">
          Backend not configured. Set <code>VITE_API_URL</code> to enable ESPN
          sync. The optimizer still works in offline mode.
        </p>
      )}

      {myInjuries.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
            Your roster is affected
          </h4>
          <ul className="space-y-1">
            {myInjuries.map((row) => (
              <li
                key={row.player_id + row.name}
                className="text-sm border border-accent-danger/30 bg-accent-danger/5 rounded px-2 py-1.5 flex items-center gap-2"
              >
                <span className="font-semibold text-accent-danger">
                  {row.status?.toUpperCase() || "INJ"}
                </span>
                <span className="font-medium">{row.name}</span>
                <span className="text-ink-subtle text-xs">{row.team}</span>
                {row.short_comment && (
                  <span className="text-ink-muted text-xs truncate">
                    — {row.short_comment}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {news.data && news.data.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
            Latest news
          </h4>
          <ul className="space-y-1.5">
            {news.data.slice(0, 5).map((row, idx) => (
              <li key={idx} className="text-sm">
                {row.link ? (
                  <a
                    href={row.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand hover:underline"
                  >
                    {row.title}
                  </a>
                ) : (
                  <span className="text-ink">{row.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sync.isSuccess && (
        <p className="text-[11px] text-ink-subtle mt-3">
          Synced {sync.data?.injuries_synced ?? 0} injury rows and{" "}
          {sync.data?.news_synced ?? 0} news rows
          {lastSyncAt && ` at ${new Date(lastSyncAt).toLocaleTimeString()}`}.
        </p>
      )}

      {sync.isError && (
        <p className="text-[11px] text-accent-danger mt-3">
          {String((sync.error as Error)?.message ?? "ESPN sync failed.")}
        </p>
      )}
    </Card>
  );
}
