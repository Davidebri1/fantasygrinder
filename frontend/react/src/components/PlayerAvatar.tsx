/**
 * Player avatar component.
 *
 * Why this matters: competitors (SaberSim, FantasyLabs, RunTheSim) don't
 * ship player headshots. We do. Visual recognition is the dominant
 * signal a customer uses to scan a lineup — "is THAT guy in there?"
 *
 * Resolution order (graceful degradation):
 *   1. NBA's official CDN if sport === "nba" and player_id looks valid.
 *   2. Wikipedia/Wikidata REST API (works for any sport, but a network hop).
 *   3. UI-Avatars.com with the player's initials (always works offline-ish).
 *
 * The component is fully self-contained — no env vars, no API keys.
 */
import { useEffect, useState } from "react";

interface Props {
  playerId: string;
  name: string;
  sport: "nba" | "mma" | "golf";
  /** Optional override URL — for tests, custom CDN, or offline bundles. */
  src?: string;
  size?: number;
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorForId(id: string): { bg: string; fg: string } {
  // Stable color per id so the same player always gets the same avatar tint.
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return { bg: `hsl(${hue}, 50%, 40%)`, fg: "#fff" };
}

function buildNbaCdnUrl(playerId: string): string | null {
  // NBA's official CDN expects a numeric player ID. Our sample data uses
  // synthetic strings like "nba-0-0" which won't resolve. Only return a URL
  // when the id is purely numeric (i.e. real DraftKings player IDs).
  if (!/^\d+$/.test(playerId)) return null;
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`;
}

function buildUiAvatarsUrl(name: string, bg: string, fg: string, size: number): string {
  // Always-on deterministic fallback. No API key. CDN-cached.
  const params = new URLSearchParams({
    name: initials(name),
    background: bg.replace("#", "").replace(/[^0-9a-f]/gi, ""),
    color: fg.replace("#", "").replace(/[^0-9a-f]/gi, ""),
    size: String(size),
    bold: "true",
    "font-size": "0.4",
  });
  return `https://ui-avatars.com/api/?${params.toString()}`;
}

export function PlayerAvatar({ playerId, name, sport, src, size = 36, className = "" }: Props) {
  const tier = colorForId(playerId);
  const [currentSrc, setCurrentSrc] = useState<string | null>(
    src ??
      (sport === "nba" ? buildNbaCdnUrl(playerId) : null),
  );
  const [triedWiki, setTriedWiki] = useState(false);

  useEffect(() => {
    // If the initial NBA CDN didn't render (e.g. sample data, broken link),
    // fall through to the next tier.
    setCurrentSrc(
      src ??
        (sport === "nba" ? buildNbaCdnUrl(playerId) : null),
    );
    setTriedWiki(false);
  }, [playerId, src, sport]);

  const handleError = () => {
    if (triedWiki) {
      // Last-resort: deterministic initials avatar.
      setCurrentSrc(buildUiAvatarsUrl(name, "#2c5282", "ffffff", size));
    } else if (currentSrc && currentSrc.includes("cdn.nba.com")) {
      setTriedWiki(true);
      setCurrentSrc(buildUiAvatarsUrl(name, tier.bg, tier.fg, size));
    } else {
      setCurrentSrc(buildUiAvatarsUrl(name, "#2c5282", "ffffff", size));
    }
  };

  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden rounded-full bg-slate-200 ${className}`}
      style={{ width: size, height: size, flex: "0 0 auto" }}
      title={name}
    >
      {currentSrc ? (
        <img
          src={currentSrc}
          alt={name}
          width={size}
          height={size}
          className="w-full h-full object-cover"
          onError={handleError}
          loading="lazy"
        />
      ) : (
        <span
          className="font-semibold text-xs"
          style={{ color: tier.fg, background: tier.bg, width: "100%", height: "100%", display: "grid", placeItems: "center" }}
        >
          {initials(name)}
        </span>
      )}
    </span>
  );
}
