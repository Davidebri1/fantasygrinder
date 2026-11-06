/**
 * Player detail sheet.
 *
 * A player is the smallest unit a DFS decision is made about, so the app
 * has to be able to show you one properly: who he is, what he is playing
 * against, what he is projected to score, what he costs, what share of
 * your portfolio he already owns, and the three things you can decide
 * about him — lock, like, exclude.
 *
 * It slides in from the right over a scrim. It is a dialog: Escape closes
 * it, a click outside closes it, Tab stays inside it, and the focus goes
 * back to whatever opened it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Heart, Lock, Unlock, X } from "lucide-react";

import { cn, fmtDecimal, fmtMoney } from "@/lib/utils";
import {
  FAMILY_COLOR,
  positionFamily,
  positionLabel,
  type PositionFamily,
} from "@/lib/positions";
import type { Player, Sport } from "@/types";
import { PlayerAvatar } from "./PlayerAvatar";
import { TeamCrest } from "./TeamCrest";

export interface PlayerDrawerProps {
  player: Player | null;
  onClose: () => void;
  sport: Sport;
  /** Portfolio exposure, percent of lineups containing this player. */
  exposure?: number;
  /** Best projected points available at the player's position (for Roto Score). */
  bestByPosition?: Map<string, number>;
  /** Slot the player occupies, when the drawer was opened from a lineup. */
  slot?: string;
  /** Lock / like / exclude, applied through the store. */
  onToggleLock?: (id: string) => void;
  onToggleLike?: (id: string) => void;
  onToggleExclude?: (id: string) => void;
}

/**
 * A position badge, coloured by family.
 *
 * Exported because the pool table and the exposure report need the same
 * badge, and it has to be the same badge everywhere.
 */
export function PositionBadge({
  label,
  family,
  size = 20,
}: {
  label: string;
  family: PositionFamily;
  size?: number;
}) {
  const color = FAMILY_COLOR[family] ?? FAMILY_COLOR.unknown;
  const wide = label.length > 2;
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center justify-center rounded-1 font-semibold",
        wide && "px-1.5",
      )}
      style={{
        height: size,
        minWidth: size,
        fontSize: Math.round(size * (wide ? 0.44 : 0.55)),
        letterSpacing: "-0.02em",
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 34%, transparent)`,
      }}
      title={label}
    >
      {label}
    </span>
  );
}

/**
 * The badge for a player, or null when there is nothing to show.
 *
 * MMA fighters and golfers have no roster position, but they do have a
 * role, and the colour families for both already exist in the design
 * system.
 */
export function positionBadgeFor(
  player: Player,
): { label: string; family: PositionFamily } | null {
  if (player.sport === "mma") return { label: "Fighter", family: "fighter" };
  if (player.sport === "golf") return { label: "Golfer", family: "golfer" };
  const label = positionLabel(
    player.sport,
    player.roster_positions ?? player.positions,
  );
  if (!label) return null;
  return { label, family: positionFamily(player.sport, label) };
}

/**
 * Roto Score: projected points against the best projected points available
 * at this player's position on this slate. 100 means he is the best of his
 * position. It is this app's own measure, and it is labelled as such.
 */
export function rotoScoreFor(
  player: Player,
  bestByPosition?: Map<string, number>,
): number | null {
  if (!bestByPosition) return null;
  const positions = player.roster_positions ?? player.positions ?? [];
  let best = 0;
  for (const pos of positions) {
    const v = bestByPosition.get(pos) ?? 0;
    if (v > best) best = v;
  }
  if (best <= 0) return null;
  return (player.projection / best) * 100;
}

function formatKickoff(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The word this sport uses for the moment the player plays. */
function timeLabel(sport: Sport): string {
  if (sport === "mma") return "Fight time";
  if (sport === "golf") return "Start time";
  return "Tip time";
}

export function PlayerDrawer({
  player,
  onClose,
  sport,
  exposure,
  bestByPosition,
  slot,
  onToggleLock,
  onToggleLike,
  onToggleExclude,
}: PlayerDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);

  // The close handler is read through a ref so that an inline arrow from
  // the parent cannot restart the focus cycle on every render.
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const [entered, setEntered] = useState(false);
  const playerId = player?.id ?? null;

  // Slide in. Transform only — the sheet never animates its size.
  useEffect(() => {
    if (!playerId) return;
    setEntered(false);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [playerId]);

  // Focus moves into the sheet when it opens and back to the control that
  // opened it when it closes.
  //
  // This is keyed on the player's id, not the object, because locking or
  // liking a player rebuilds the player object. Keyed on the object, every
  // flag toggle would yank focus out of the button you just pressed.
  useEffect(() => {
    if (!playerId) return;
    if (!triggerRef.current) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      const trigger = triggerRef.current;
      triggerRef.current = null;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [playerId]);

  const close = useCallback(() => closeRef.current(), []);

  /**
   * Tab stays inside the sheet while it is open.
   */
  const onPanelKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === panel) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const badge = useMemo(
    () => (player ? positionBadgeFor(player) : null),
    [player],
  );
  const roto = useMemo(
    () => (player ? rotoScoreFor(player, bestByPosition) : null),
    [player, bestByPosition],
  );

  if (!player) return null;

  const opponentName = player.opponent?.trim() || "";
  const showCrestOpponent = sport === "nba" || sport === "nfl";
  const injury = (player.injury_status ?? "").trim();

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 scrim"
        style={{
          opacity: entered ? 1 : 0,
          transition: "opacity 220ms ease",
        }}
        onClick={close}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={player.name}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className="absolute inset-y-0 right-0 w-full sm:w-[440px] flex flex-col floating rounded-l-3"
        style={{
          transform: entered
            ? "translate3d(0, 0, 0)"
            : "translate3d(100%, 0, 0)",
          transition: "transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        }}
      >
        {/* Identity */}
        <header className="flex items-start gap-3 p-4 border-b border-line">
          <PlayerAvatar
            playerId={player.id}
            name={player.name}
            sport={sport}
            photoUrl={player.photo_url}
            size={64}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-lg font-semibold truncate">{player.name}</h2>
              {slot ? <span className="chip shrink-0">{slot}</span> : null}
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {badge ? (
                <PositionBadge label={badge.label} family={badge.family} />
              ) : null}
              {player.team ? (
                <>
                  <TeamCrest sport={sport} abbr={player.team} size={18} />
                  <span className="label">{player.team}</span>
                </>
              ) : null}
              {player.jersey ? (
                <span className="num text-xs text-ink-subtle">
                  #{player.jersey}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close player details"
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-2 text-ink-muted hover:bg-surface-3 hover:text-ink transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Facts */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label={player.salary_source === "dk" ? "Salary" : "Salary (est.)"} value={fmtMoney(player.salary)} />
            <Fact
              label="Projected points (est.)"
              value={fmtDecimal(player.projection)}
            />
            <Fact
              label="Projected ownership (est.)"
              value={
                player.projected_ownership !== undefined
                  ? `${fmtDecimal(player.projected_ownership)}%`
                  : "Not on the board"
              }
            />
            <Fact
              label="Portfolio exposure"
              value={
                exposure !== undefined
                  ? `${fmtDecimal(exposure)}%`
                  : "Not in the portfolio"
              }
            />
          </div>

          <div className="well p-3 space-y-3">
            <div>
              <div className="label-quiet">Roto Score</div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="num text-2xl font-semibold">
                  {roto !== null ? `${fmtDecimal(roto)}%` : "—"}
                </span>
              </div>
              <p className="label-quiet mt-1">
                This app&apos;s own measure: projected points against the best
                projected points available at his position on this slate. 100
                means he is the best of his position.
              </p>
            </div>
          </div>

          <div className="well p-3 space-y-3">
            <Fact
              label="Opponent"
              value={opponentName || "No opponent on the board"}
              crest={
                showCrestOpponent && opponentName ? (
                  <TeamCrest sport={sport} abbr={opponentName} size={18} />
                ) : null
              }
            />
            <Fact
              label="Game"
              value={player.game_info?.trim() || "Not on the board"}
            />
            <Fact
              label={timeLabel(sport)}
              value={formatKickoff(player.game_time) || "Not scheduled"}
            />
          </div>

          {injury ? (
            <div className="well p-3 border-l-2 border-l-warn">
              <div className="label-quiet">Injury note</div>
              <p className="label text-warn mt-0.5">{injury}</p>
            </div>
          ) : null}
        </div>

        {/* Decisions */}
        <footer className="border-t border-line p-4 flex gap-2">
          <Action
            active={!!player.is_locked}
            onClick={() => onToggleLock?.(player.id)}
            disabled={!onToggleLock}
          >
            {player.is_locked ? (
              <Lock className="w-4 h-4" />
            ) : (
              <Unlock className="w-4 h-4" />
            )}
            {player.is_locked ? "Locked" : "Lock"}
          </Action>
          <Action
            active={!!player.is_liked}
            tone="good"
            onClick={() => onToggleLike?.(player.id)}
            disabled={!onToggleLike}
          >
            <Heart
              className={cn("w-4 h-4", player.is_liked && "fill-current")}
            />
            {player.is_liked ? "Liked" : "Like"}
          </Action>
          <Action
            active={!!player.is_excluded}
            tone="danger"
            onClick={() => onToggleExclude?.(player.id)}
            disabled={!onToggleExclude}
          >
            <Ban className="w-4 h-4" />
            {player.is_excluded ? "Excluded" : "Exclude"}
          </Action>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Fact({
  label,
  value,
  crest,
}: {
  label: string;
  value: string;
  crest?: React.ReactNode;
}) {
  return (
    <div>
      <div className="label-quiet">{label}</div>
      <div className="flex items-center gap-1.5 mt-0.5 text-sm">
        {crest}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

function Action({
  children,
  active,
  tone = "warn",
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  active: boolean;
  tone?: "warn" | "good" | "danger";
  onClick: () => void;
  disabled?: boolean;
}) {
  const activeClass =
    tone === "good"
      ? "bg-good-wash text-good"
      : tone === "danger"
        ? "bg-danger-wash text-danger"
        : "bg-warn-wash text-warn";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-2 text-sm rounded-2 border transition-colors",
        active
          ? activeClass
          : "bg-surface-1 text-ink-muted border-line-strong hover:bg-surface-3 hover:text-ink",
        disabled && "opacity-45 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
