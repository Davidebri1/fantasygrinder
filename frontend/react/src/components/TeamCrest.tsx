/**
 * A team's crest.
 *
 * The real logo from ESPN's CDN, on a glass disc. If the logo is missing the
 * crest falls back to the team's monogram on the team's own colour, so a
 * team is never reduced to grey.
 */
import { useState } from "react";

import { cn } from "@/lib/utils";
import { crestUrl, teamColor } from "@/lib/team-colors";

interface Props {
  sport: "nba" | "nfl" | "mma" | "golf";
  /** Team abbreviation, exactly as the feed gives it. */
  abbr?: string | null;
  size?: number;
  className?: string;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  /**
   * Whether the fallback monogram carries the team's letters. Turn it off
   * when the abbreviation is written next to the crest, or the same two
   * letters get read twice.
   */
  showFallbackText?: boolean;
}

export function TeamCrest({
  sport,
  abbr,
  size = 18,
  className,
  title,
  onClick,
  showFallbackText = false,
}: Props) {
  const [failed, setFailed] = useState(false);
  const url = crestUrl(sport, abbr);
  const label = (abbr ?? "").trim().toUpperCase();

  /**
   * A fighter has no team and a golfer has no team. Drawing a crest for
   * them would be a coloured disc pretending to mean something, so there
   * is nothing to draw.
   */
  if (sport !== "nba" && sport !== "nfl") return null;

  const base = cn(
    "inline-flex items-center justify-center shrink-0 rounded-full overflow-hidden",
    onClick && "cursor-pointer",
    className,
  );

  const style = {
    width: size,
    height: size,
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
  };

  if (url && !failed) {
    return (
      <span
        className={base}
        style={style}
        title={title ?? label}
        aria-label={title ?? (label ? `${label} crest` : "team crest")}
        role={onClick ? "button" : "img"}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick(e as unknown as React.MouseEvent);
                }
              }
            : undefined
        }
      >
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            width: Math.round(size * 0.78),
            height: Math.round(size * 0.78),
            objectFit: "contain",
            display: "block",
          }}
        />
      </span>
    );
  }

  return (
    <span
      className={base}
      style={{
        ...style,
        background: teamColor(sport, abbr),
        fontSize: Math.max(8, Math.round(size * 0.42)),
        fontWeight: 700,
        letterSpacing: "-0.02em",
        color: "#fff",
        textShadow: "0 1px 2px rgba(0,0,0,0.4)",
      }}
      title={title ?? label}
      aria-label={title ?? (label ? `${label} crest` : "team crest")}
      onClick={onClick}
      role={onClick ? "button" : "img"}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(e as unknown as React.MouseEvent);
              }
            }
          : undefined
      }
    >
      {showFallbackText ? label.slice(0, 3) : ""}
    </span>
  );
}
