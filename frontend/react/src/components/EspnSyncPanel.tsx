/**
 * Live panel — ESPN injury notes and news for the roster on screen.
 *
 * Injury notes come from the live slate itself (ESPN's roster feed), news
 * from ESPN's public news endpoint. Both are fetched from the browser, so
 * this works on the deployed static site with no backend and no API key.
 */
import { useQuery } from "@tanstack/react-query";

import { Card } from "./Card";
import { TeamCrest } from "./TeamCrest";
import { fetchLiveNews, type LiveNewsRow } from "@/lib/espn-live";
import { useAppStore } from "@/store";
import type { Sport } from "@/types";

export function useEspnSync(sport: Sport) {
  const news = useQuery({
    queryKey: ["espn-news", sport],
    queryFn: async (): Promise<LiveNewsRow[]> => {
      if (sport !== "nba") return [];
      return fetchLiveNews();
    },
    enabled: sport === "nba",
    refetchInterval: 10 * 60 * 1000,
    staleTime: 9 * 60 * 1000,
  });

  return { news };
}

interface Props {
  sport: Sport;
}

export function EspnSyncPanel({ sport }: Props) {
  const { news } = useEspnSync(sport);
  const liveStatus = useAppStore((s) => s.liveStatus[sport] ?? "idle");
  const liveGames = useAppStore((s) => s.liveGames[sport] ?? []);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt[sport] ?? null);
  const players = useAppStore((s) => s.players[sport] ?? []);

  const synced = lastSyncedAt ? new Date(lastSyncedAt) : null;

  if (sport !== "nba") {
    const event = liveGames[0];
    const title =
      sport === "mma"
        ? "Live Card"
        : sport === "golf"
          ? "Live Leaderboard"
          : "Live board";
    return (
      <Card className="p-4" title={title}>
        {sport === "nfl" && liveGames.length > 0 ? (
          <ul className="space-y-1">
            {liveGames.map((g) => (
              <li key={g.id} className="text-sm flex items-center gap-3">
                <span className="text-ink">{g.label}</span>
                {g.detail && (
                  <span className="label-quiet ml-auto truncate max-w-[12rem]">
                    {g.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            {event
              ? `${event.label}${event.detail ? ` · ${event.detail}` : ""}`
              : "Waiting for the live feed."}
          </p>
        )}
        <p className="text-[11px] text-ink-subtle mt-2">
          {synced ? `Updated ${synced.toLocaleTimeString()}` : "Not synced yet"} ·{" "}
          {liveStatus === "live" ? "live" : liveStatus}
        </p>
      </Card>
    );
  }

  const flagged = players.filter((p) => !!p.injury_status);

  return (
    <Card
      className="p-4"
      title="ESPN Injury & News"
      actions={
        <span className="text-[11px] text-ink-subtle">
          {synced ? `Synced ${synced.toLocaleTimeString()}` : "Live"}
        </span>
      }
    >
      {flagged.length > 0 && (
        <div className="mb-4">
          <h4 className="label font-medium text-ink mb-2">Injury report</h4>
          <ul className="space-y-1">
            {flagged.slice(0, 12).map((p) => (
              <li
                key={p.id}
                className="text-sm border border-danger/30 bg-danger-wash rounded-1 px-2 py-1.5 flex items-center gap-2"
              >
                <span className="font-semibold text-danger">
                  {(p.injury_status ?? "").toUpperCase()}
                </span>
                <span className="font-medium">{p.name}</span>
                <TeamCrest sport={p.sport} abbr={p.team} size={16} showFallbackText />
              </li>
            ))}
          </ul>
        </div>
      )}

      {news.data && news.data.length > 0 && (
        <div>
          <h4 className="label font-medium text-ink mb-2">Latest news</h4>
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

      {news.isError && (
        <p className="text-xs text-ink-subtle">The news feed is unavailable right now.</p>
      )}
      {!news.data?.length && !news.isError && (
        <p className="text-sm text-ink-subtle">No injury notes or news on this roster.</p>
      )}
    </Card>
  );
}
