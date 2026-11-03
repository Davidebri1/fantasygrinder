/**
 * Browse — ESPN data inside the app.
 *
 * Scores & schedule from ESPN's public scoreboard, and a player search
 * backed by ESPN's search API (with headshots). Read-only; nothing here
 * touches the optimizer. CORS is open on these ESPN hosts.
 */
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Card } from "@/components/Card";

type Sport = "nba" | "nfl" | "mma" | "golf";

const ESPN_PATH: Record<Sport, string> = {
  nba: "basketball/nba",
  nfl: "football/nfl",
  mma: "mma/ufc",
  golf: "golf/pga",
};

const LABEL: Record<Sport, string> = { nba: "NBA", nfl: "NFL", mma: "UFC", golf: "PGA" };

interface Competitor {
  name: string;
  score?: string;
  logo?: string;
}

interface EventRow {
  id: string;
  name: string;
  date?: string;
  status?: string;
  competitors: Competitor[];
}

interface SearchHit {
  name: string;
  team?: string;
  headshot?: string;
}

const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports";

function fmtDate(s?: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function fetchScores(sport: Sport): Promise<EventRow[]> {
  const res = await fetch(`${ESPN}/${ESPN_PATH[sport]}/scoreboard`);
  if (!res.ok) return [];
  const data = await res.json();
  const events: EventRow[] = [];
  for (const ev of data.events ?? []) {
    const competitors: Competitor[] = [];
    let status: string | undefined;
    for (const comp of ev.competitions ?? []) {
      status = comp.status?.type?.detail ?? status;
      for (const side of comp.competitors ?? []) {
        const athlete = side.athlete ?? {};
        const team = side.team ?? {};
        const name = athlete.displayName || team.displayName || team.shortDisplayName || "";
        if (!name) continue;
        competitors.push({
          name,
          score: side.score != null ? String(side.score) : undefined,
          logo: (team.logos?.[0]?.href) || (athlete.headshot?.href) || undefined,
        });
      }
    }
    events.push({ id: String(ev.id), name: ev.name ?? "", date: ev.date, status, competitors });
  }
  return events;
}

async function searchPlayers(query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const qs = new URLSearchParams({ query, limit: "12", region: "us", lang: "en" });
  const res = await fetch(`https://site.web.api.espn.com/apis/search/v2?${qs}`);
  if (!res.ok) return [];
  const data = await res.json();
  const hits: SearchHit[] = [];
  for (const section of data.results ?? []) {
    if (section.type !== "player") continue;
    for (const item of section.contents ?? []) {
      hits.push({
        name: item.displayName ?? "",
        team: item.subtitle ?? "",
        headshot: item.image?.default,
      });
    }
  }
  return hits;
}

export function BrowseScreen() {
  const [sport, setSport] = useState<Sport>("nba");
  const [scores, setScores] = useState<EventRow[]>([]);
  const [loadingScores, setLoadingScores] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadingScores(true);
    fetchScores(sport)
      .then((rows) => {
        if (alive) setScores(rows);
      })
      .finally(() => {
        if (alive) setLoadingScores(false);
      });
    return () => {
      alive = false;
    };
  }, [sport]);

  const runSearch = async (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setHits([]);
      return;
    }
    setSearching(true);
    const found = await searchPlayers(q);
    setHits(found);
    setSearching(false);
  };

  const subtitle = useMemo(
    () => ({ nba: "Games & players", nfl: "Games & players", mma: "Cards & fighters", golf: "Events & field" })[sport],
    [sport],
  );

  return (
    <div>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Browse</h1>
          <p className="text-sm text-ink-muted mt-1">
            {LABEL[sport]} — {subtitle} (live from ESPN)
          </p>
        </div>
        <div className="flex gap-1">
          {(["nba", "nfl", "mma", "golf"] as Sport[]).map((s) => (
            <button
              key={s}
              onClick={() => setSport(s)}
              className={
                "px-3 py-1.5 text-sm rounded-2 border " +
                (sport === s ? "border-brand bg-brand-wash text-ink" : "border-line text-ink-muted hover:border-line-strong")
              }
            >
              {LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <Card className="p-0" title="Scores & Schedule">
          <div className="p-4">
            {loadingScores ? (
              <p className="text-sm text-ink-subtle">Loading…</p>
            ) : scores.length === 0 ? (
              <p className="text-sm text-ink-subtle">No events on the board right now.</p>
            ) : (
              <ul className="space-y-2">
                {scores.map((ev) => (
                  <li key={ev.id} className="border border-line rounded-2 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-surface-2 border-b border-line">
                      <span className="text-sm font-medium text-ink truncate">{ev.name}</span>
                      <span className="text-xs text-ink-subtle shrink-0">
                        {ev.status || fmtDate(ev.date)}
                      </span>
                    </div>
                    <div className="px-3 py-2">
                      {ev.competitors.length === 0 ? (
                        <span className="text-xs text-ink-subtle">{fmtDate(ev.date)}</span>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {ev.competitors.map((c, i) => (
                            <div key={i} className="flex items-center gap-2 min-w-0">
                              {c.logo ? (
                                <img src={c.logo} alt="" width={22} height={22} style={{ objectFit: "contain" }} />
                              ) : null}
                              <span className="text-sm truncate">{c.name}</span>
                              {c.score && <span className="ml-auto text-sm tabular-nums text-ink-muted">{c.score}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="p-0" title="Player Search">
          <div className="p-4">
            <div className="flex items-center gap-2 border border-line rounded-2 bg-inset px-2 py-1.5 mb-3">
              <Search className="w-4 h-4 text-ink-subtle" />
              <input
                value={query}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="Search players…"
                className="w-full text-sm text-ink bg-transparent focus:border-brand"
              />
            </div>
            {searching ? (
              <p className="text-sm text-ink-subtle">Searching…</p>
            ) : hits.length === 0 ? (
              <p className="text-sm text-ink-subtle">
                {query ? "No matches." : "Type a name to find a player."}
              </p>
            ) : (
              <ul className="space-y-2">
                {hits.map((h, i) => (
                  <li key={i} className="flex items-center gap-2.5">
                    {h.headshot ? (
                      <img src={h.headshot} alt="" width={32} height={32} style={{ objectFit: "contain" }} />
                    ) : (
                      <span style={{ width: 32, height: 32 }} />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{h.name}</div>
                      {h.team && <div className="text-[11px] text-ink-subtle truncate">{h.team}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
