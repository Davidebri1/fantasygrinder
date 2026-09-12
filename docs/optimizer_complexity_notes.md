# Optimizer: the exponential detour, and the fix

A short record of a real performance/correctness bug, kept as a worked
example of the scientific method applied to code.

## Symptom the customer saw

Asked for **20 lineups** with the Max Projection strategy. Got **3**.

Rerunning gave *different* lineups. Compute time grew super-linearly:
fine at 30 players; a 150-lineup run took well under a second, but it was
still doing wasted work and larger pools stalled.

## Root causes (two, stacked)

1. **The no-duplicate rule was wrong in the Python engine and absent in the
   browser engine.** In the Python MILP the no-good cut was written as
   `sum(x over the lineup) <= 1` — "at most one of those players" — which
   bans almost the entire previous lineup instead of just the exact
   combination. In the TypeScript browser solver the constraint was passed
   in but never applied at all, so every solve returned the *same* optimal
   lineup. The final list was de-duplicated, so 20 solves surfaced as 3
   unique survivors.

   Correct form: `sum(x over the lineup) <= |lineup| - 1` — exclude the
   exact set, allow every subset.

2. **Random projection jitter (±5%) was layered on top.**
   Intended to create variety, it instead made *deterministic* strategies
   stochastic — the same input produced different output across runs. If
   the answer only changes by rerunning, the model is guessing, not solving.

## Silent de-duplication (an observability failure)

The repeats were thrown away at the end with no record — no count of
duplicates, no shortfall warning, nothing in the output. You cannot reason
about uniqueness you never see. The fix: the run now reports its counts —
requested, solves, unique found, duplicates dropped, infeasible, short-by —
in the result telemetry and in the UI, and warns when it can't reach the
requested count.

## Why it was slow (the "quadratic" the eye catches)

The browser solver is a hand-rolled branch-and-bound whose bound is a
greedy knapsack approximation — **not** a true LP relaxation. Its worst
case is exponential in the number of players (≈ 2^n). With the forbidden
rule skipped, the search also re-explored the entire space on every
iteration for no new answer: cost without benefit.

A real LP relaxation (Excel Solver, PuLP/CBC, OR-Tools CP-SAT) prunes in
polynomial time and returns one provable optimum per solve — which is why
the Python backend uses those and stays fast.

## The fix

- **Enforce forbidden sets as hard constraints.** A branch that has already
  completed a previously-returned lineup is pruned; a forbidden lineup may
  never seed the incumbent.
- **Remove jitter.** Deterministic objectives now return byte-identical
  output on every run (verified run1 === run2).
- **Loop `numLineups` times**, each solve producing the next-best *distinct*
  lineup.
- **Add an explicit toggle.** *Unique lineups* on = N distinct combinations
  (portfolio diversity); off = the single optimum repeated N times.

## Old vs new

| | Before | After |
|---|---|---|
| Lineups for `numLineups=20` | 3 (deduped from repeats) | 20 distinct |
| Determinism (fixed input) | varies run to run | identical every run |
| Forbidden/no-duplicate rule | wrong formula (Py) / ignored (TS) | enforced as a hard no-good cut |
| 150 lineups | big wasted re-search, stalls at scale | <1 s |
| Solver bound | greedy, worst case 2^n | pruned by the exclusion constraint |
| De-dup | silent, unlogged | reported: solves / dropped / unique / short-by |

## The numbers that settle the strategy question

A 150-lineup run:

```
Top lineup projected:  124.0
Avg portfolio projected: 123.0
```

The distinct optima are statistical equivalents — not "1st place" and
"2nd place." Diversifying across them is **free robustness**: many
different lineups, each essentially as strong as the single best, each a
backup for the others. There is no cost to diversity here, so there is no
reason to "play 2nd."

## Lesson

A constraint that is skipped or guessed forces the solver to re-search the
same space — combinatorial cost for zero benefit. Encoding the constraint
directly (a no-good cut per returned lineup) keeps each solve cheap and
turns the set of optima into a portfolio of equivalent, robust options.
