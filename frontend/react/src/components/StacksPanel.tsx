/**
 * Daily lineup stacks — the panel that finds groups worth building around.
 *
 * A stack is a set of players who play in the same place: two teammates, the
 * best players on both sides of one game, or two fighters in one bout. When
 * one of them has a big night, the others usually do too, so putting them
 * together in one lineup tends to score more than spreading them out.
 *
 * The panel never builds anything itself. It proposes stacks and hands the
 * chosen one back to the caller, which writes it into the optimizer.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Layers, X } from "lucide-react";

import { cn, fmtDecimal, fmtMoney } from "@/lib/utils";
import { generateStacks, type StackCandidate } from "@/optimizer/stacks";
import type { StackRule } from "@/optimizer/types";
import type { Player, Sport } from "@/types";

export interface StacksPanelProps {
  /** The sport on screen. Golf has no stacks. */
  sport: Sport;
  /** The player pool to scan. */
  players: Player[];
  /** The stack currently in force, if any. */
  activeRule?: StackRule | null;
  /**
   * Called when the user picks a stack, and again with null when they remove
   * the one in force.
   */
  onUseStack?: (candidate: StackCandidate | null) => void;
  /** MMA only: allow both fighters from one fight to be stacked. */
  allowOpponents?: boolean;
}

/** Position badge for a player — first roster position, else first position. */
function positionOf(p: Player): string {
  return p.roster_positions?.[0] ?? p.positions?.[0] ?? "";
}

/** The label that says what kind of stack this is, in plain words. */
function kindLabel(candidate: StackCandidate): string {
  if (candidate.variant === "team") return "Team stack";
  if (candidate.variant === "game") return "Game stack";
  if (candidate.variant === "bout") return "Fight pair";
  return "Card stack";
}

/** Two rules are the same rule when they constrain the same group the same way. */
function sameRule(a: StackRule, b: StackRule): boolean {
  return a.scope === b.scope && a.id === b.id && a.min === b.min && a.max === b.max;
}

export function StacksPanel({
  sport,
  players,
  activeRule = null,
  onUseStack,
  allowOpponents = false,
}: StacksPanelProps) {
  const [stacks, setStacks] = useState<StackCandidate[]>([]);
  /**
   * The row the user last picked. Two rows can carry the same rule — a fight
   * pair and a card stack on the same card both ask for two players from that
   * card — so we remember the pick rather than guess from the rule alone.
   */
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Scan whenever the slate changes. The button below re-runs the same scan
  // on demand, for when the user wants to look at it again.
  useEffect(() => {
    setStacks(
      sport === "golf" ? [] : generateStacks(players, sport, { allowOpponents }),
    );
  }, [players, sport, allowOpponents]);

  /**
   * The row that is in force. The rule in force is what the optimizer holds,
   * so that is what we match on — but two rows can share a rule (a fight pair
   * and a card stack on the same card), so we keep the one the user picked
   * last rather than lighting up both.
   */
  const activeId = useMemo(() => {
    if (!activeRule) return null;
    const matches = stacks.filter((s) => sameRule(s.rule, activeRule));
    if (matches.length === 0) return null;
    const picked = matches.find((s) => s.id === pickedId);
    return (picked ?? matches[0]).id;
  }, [activeRule, stacks, pickedId]);

  const rescan = () => {
    setStacks(
      sport === "golf" ? [] : generateStacks(players, sport, { allowOpponents }),
    );
  };

  // Golf genuinely has nothing to stack: every golfer is on their own hole.
  if (sport === "golf") {
    return (
      <section className="panel p-5">
        <h2 className="text-lg font-semibold">Daily lineup stacks</h2>
        <p className="label mt-1 max-w-[62ch]">
          Stacks are for sports where players share a team or a game. Golf has
          neither, so there is nothing to stack here.
        </p>
        <p className="label-quiet mt-3">
          Build your golf lineup from the tournament leaderboard instead, and
          let the optimizer price it against your cap.
        </p>
      </section>
    );
  }

  const hasPlayers = players.length > 0;

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Daily lineup stacks</h2>
          <p className="label mt-1 max-w-[62ch]">
            Players who play together tend to have good nights together, so
            building a lineup around one of these groups usually scores more
            than spreading the same picks across the slate.
          </p>
        </div>
        <button
          type="button"
          onClick={rescan}
          disabled={!hasPlayers}
          className="control shrink-0 inline-flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-45"
        >
          <Layers size={16} aria-hidden="true" />
          Generate stacks
        </button>
      </div>

      {!hasPlayers ? (
        <div className="well mt-4 p-4">
          <p className="label">
            There are no players on the slate yet, so there is nothing to
            stack. Load the slate first and the stacks will appear here.
          </p>
        </div>
      ) : stacks.length === 0 ? (
        <div className="well mt-4 p-4">
          <p className="label">
            No stacks came back from this slate. That usually means there are
            not enough players from one team or one game yet.
          </p>
          <p className="label-quiet mt-1">
            Try again once more of the slate is loaded, or build your lineup
            without a stack.
          </p>
        </div>
      ) : (
        <>
          <p className="label-quiet mt-4">
            {stacks.length} {stacks.length === 1 ? "stack" : "stacks"}, ranked
            by projected points. Pick one and the optimizer builds around it.
          </p>
          <ul className="mt-3 space-y-2">
            {stacks.map((stack, index) => {
              const isActive = activeId === stack.id;
              return (
                <li
                  key={stack.id}
                  className={cn(
                    "well p-3 transition-colors",
                    isActive && "border-brand bg-brand-wash",
                  )}
                >
                  {/* The content stacks above the controls on a phone, so the
                      button is never squeezed into a sliver at 360px. */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="label-quiet num w-5 shrink-0">
                          {index + 1}
                        </span>
                        <span className="text-sm font-medium text-ink">
                          {stack.name}
                        </span>
                        <span className="chip">{kindLabel(stack)}</span>
                      </div>

                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {stack.players.map((p) => {
                          const pos = positionOf(p);
                          return (
                            <li key={p.id}>
                              <span className="inline-flex items-center gap-1.5 rounded-1 bg-surface-3 px-2 py-0.5 text-xs">
                                {pos ? <span className="chip">{pos}</span> : null}
                                <span className="text-ink">{p.name}</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>

                      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <div className="flex gap-1.5">
                          <dt className="label-quiet">{stack.salary > 0 ? "Salary" : "Salary — import a DraftKings file for real prices"}</dt>
                          <dd className="num text-ink">{fmtMoney(stack.salary)}</dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt className="label-quiet">Projected</dt>
                          <dd className="num text-ink">
                            {fmtDecimal(stack.projection, 1)}
                          </dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt className="label-quiet">Value</dt>
                          <dd className="num text-ink">
                            {fmtDecimal(stack.value, 2)} per $100
                          </dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt className="label-quiet">Roster</dt>
                          <dd className="num text-ink">
                            {stack.ownershipKnown
                              ? `${fmtDecimal(stack.ownership, 1)}%`
                              : "Unknown"}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                      {isActive ? (
                        <>
                          <span className="chip chip-good">
                            <Check size={13} aria-hidden="true" />
                            In use
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                            setPickedId(null);
                            onUseStack?.(null);
                          }}
                            className="control inline-flex items-center gap-1.5 px-3 py-2 text-sm"
                            aria-label={`Remove stack ${stack.name}`}
                          >
                            <X size={15} aria-hidden="true" />
                            Remove
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setPickedId(stack.id);
                            onUseStack?.(stack);
                          }}
                          className="control inline-flex items-center gap-1.5 px-3 py-2 text-sm"
                          aria-label={`Use stack ${stack.name}`}
                        >
                          <Check size={15} aria-hidden="true" />
                          Use stack
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {activeRule && stacks.length > 0 ? (
        <p className="label-quiet mt-3">
          A stack is in force: the optimizer is building with at least{" "}
          {activeRule.min}{" "}
          {activeRule.scope === "team"
            ? `players from ${activeRule.id}`
            : `players in the ${activeRule.id} game`}
          . Press Remove to drop it.
        </p>
      ) : null}

      <p className="label-quiet mt-3">
        Stacks are a suggestion. The optimizer still decides who makes the
        lineup.
      </p>
    </section>
  );
}
