/**
 * A player, as an identity.
 *
 * Photo, name, position, team and number — the five things you need to
 * recognise a player at a glance in a dense table. The position badge is
 * coloured by family so the shape of a roster reads instantly, and the
 * crest carries the team.
 *
 * The whole chip is one control: clicking it opens the player's detail
 * sheet.
 */
import { cn, fmtDecimal } from "@/lib/utils";
import { FAMILY_COLOR, positionFamily, positionLabel } from "@/lib/positions";
import type { Player } from "@/types";
import { PlayerAvatar } from "./PlayerAvatar";
import { TeamCrest } from "./TeamCrest";

export type ChipSize = "sm" | "md" | "lg";

const SIZES: Record<ChipSize, { avatar: number; crest: number; badge: number }> = {
  sm: { avatar: 26, crest: 16, badge: 17 },
  md: { avatar: 34, crest: 20, badge: 20 },
  lg: { avatar: 46, crest: 26, badge: 24 },
};

export function PlayerChip({
  player,
  size = "md",
  slot,
  exposure,
  onClick,
  className,
}: {
  player: Player;
  size?: ChipSize;
  /** The roster slot this player fills in a lineup, when there is one. */
  slot?: string;
  /** Share of the portfolio that contains this player, in percent. */
  exposure?: number;
  onClick?: () => void;
  className?: string;
}) {
  const dims = SIZES[size];
  const label = positionLabel(player.sport, player.roster_positions ?? player.positions);
  const family = positionFamily(player.sport, label);
  const color = FAMILY_COLOR[family];
  const jersey = player.jersey;
  /** Only team sports have a team to put a crest on. */
  const hasTeam = player.sport === "nba" || player.sport === "nfl";
  /**
   * The roster slot only earns its place when it says something the
   * position badge does not. A quarterback in the quarterback slot is one
   * piece of information shown twice.
   */
  const slotText = slot && slot.trim().toUpperCase() !== label ? slot : "";

  const body = (
    <>
      <PlayerAvatar
        playerId={player.id}
        name={player.name}
        sport={player.sport}
        photoUrl={player.photo_url}
        size={dims.avatar}
      />

      <span className="flex flex-col min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <span
            className={cn(
              "font-medium truncate",
              size === "sm" ? "text-[13px]" : size === "lg" ? "text-base" : "text-sm",
            )}
          >
            {player.name}
          </span>
          {slotText && <span className="label-quiet shrink-0">{slotText}</span>}
        </span>
        {size === "lg" && player.opponent ? (
          <span className="label-quiet truncate">vs {player.opponent}</span>
        ) : null}
      </span>

      {label && (
        <span
          className="shrink-0 grid place-items-center rounded-1 font-semibold"
          style={{
            width: dims.badge,
            height: dims.badge,
            fontSize: Math.round(dims.badge * 0.55),
            letterSpacing: "-0.02em",
            color,
            background: `color-mix(in srgb, ${color} 16%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 34%, transparent)`,
          }}
          title={label}
        >
          {label}
        </span>
      )}

      {/*
        A crest means a team. A fighter has no team and a golfer has no
        team, so showing one of them would be decoration pretending to be
        information.
      */}
      {hasTeam && (
        <TeamCrest
          sport={player.sport}
          abbr={player.team}
          size={dims.crest}
          showFallbackText
        />
      )}

      {jersey && (
        <span className="num text-ink-subtle shrink-0" style={{ fontSize: 11 }}>
          #{jersey}
        </span>
      )}

      {exposure !== undefined && (
        <span
          className={cn(
            "num shrink-0",
            exposure > 60 ? "text-danger" : "text-ink-subtle",
          )}
          style={{ fontSize: 11 }}
          title={`${fmtDecimal(exposure)}% of the portfolio contains this player`}
        >
          {fmtDecimal(exposure, 0)}%
        </span>
      )}
    </>
  );

  const shell = cn(
    "flex items-center gap-2 min-w-0",
    onClick && "cursor-pointer",
    className,
  );

  if (!onClick) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        shell,
        "text-left rounded-2 px-1.5 py-1 -mx-1.5 transition-colors",
        "hover:bg-surface-3 focus-visible:bg-surface-3",
      )}
    >
      {body}
    </button>
  );
}
