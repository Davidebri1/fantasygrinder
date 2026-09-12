# Parity Plan — Flutter → Python Optimizer

## Why we need parity tests

The Dart optimizer in `lib/services/{optimizer_service,nba_milp_solver,mma_milp_solver}.dart` and `lib/services/nba/nba_simulation_engine.dart` is the source of truth for what the customer sees today. The Python port must return **equivalent lineups** for the same inputs. Without a parity plan, the React + Django rewrite risks silently producing different lineups and the customer would notice.

## What "parity" means

For a single test vector (fixed players + fixed settings):
1. The Python port's `top_score` matches the Dart reference's `top_score` to **1e-9 absolute tolerance** when `solver_backend=pulp` (CBC).
2. The lineups in the Python port's `lineups` list **share the same multiset of player IDs** as the Dart reference. Ties may produce different lineup A vs lineup B; both are valid if both are optimal.
3. With `solver_backend=ortools` (CP-SAT), the parity bar softens to "any optimum within 1e-6 of reference". Document this in the strategy doc.

## Test vectors

15 canonical inputs, hand-built from Flutter reference runs (5 NBA, 5 MMA, 5 Golf). Frozen JSON files under `tests/parity/vectors/`:

```
tests/parity/vectors/
├── nba_classic_maxproj_5p.json      # small 5-player classic, sanity
├── nba_classic_balanced_8p.json     # 8 players exactly fills roster
├── nba_classic_bringback_12p.json   # bring-back enabled, 12 players
├── nba_classic_stack_min_20p.json   # team-stacking min-players rule
├── nba_showdown_cpt_6p.json         # 6 players, captain multiplier
├── mma_maxproj_6p.json              # 6 fighters, all fungible slots
├── mma_opponent_negcorr_8p.json     # negative correlation between bouts
├── mma_allow_opponents_false_8p.json  # opponent exclusion
├── mma_contrarian_12p.json          # leverage scoring
├── golf_maxproj_6p.json
├── golf_contrarian_20p.json
├── gold_cap_8p.json
├── …
```

Each vector file: `{ "sport": "nba", "settings": {...}, "players": [...], "expected": { "top_score": …, "lineup_ids": [...] } }`.

## Comparison pipeline (R6 owns)

```
$ pytest tests/parity -q
```

The runner:
1. Loads each vector JSON.
2. Calls `python -m optimizer.run --solver-backend pulp ...` to get the new port's output.
3. Calls a frozen Dart reference binary (kept under `tests/parity/dart_reference/`) to get the legacy output.
4. Asserts top_score parity and lineup multiset parity.

The Dart reference binary is generated once from the existing Flutter source: `dart compile exe lib/main.dart -o tests/parity/dart_reference/fantasy_grinder_legacy && tests/parity/dart_reference/fantasy_grinder_legacy optimize --vector …`. We commit the binary output JSON as `tests/parity/dart_reference/vectors/*.json` so R6's tests don't depend on running Dart in CI.

## What to do when parity fails

1. **Same score, different lineups**: Acceptable only if the difference is a tied optima. Flag in PR description.
2. **Different top_score within 1e-9**: Likely a rounding issue (Python `float` vs Dart `double`). Identify the lines using `np.testing.assert_allclose` with `atol=1e-9`.
3. **Different top_score > 1e-9**: Stop the release. This is a real drift. Compare the constraint matrix side-by-side, often it's a missing roster constraint.
4. **CP-SAT only**: expected — document as known divergence. Surface this in the API response under `run_metadata.warnings`.

## Non-parity items (explicitly allowed to differ)

- **Tie-breaking order**: Dart sorts by player ID on tie, PuLP does not. Both are valid.
- **Float determinism**: with `np.random.default_rng(seed)`, the simulation is reproducible across Python runs. Cross-language determinism is impossible for Monte Carlo; we accept this and document.
- **Late-swap outputs**: NBA late swap has special game-locked logic. We test parity on a frozen slate where no game has started.

## CI integration

The CI pipeline runs `pytest tests/parity -q` on every PR. Failures block merge. Once parity is locked for the canonical vectors, R6 expands coverage with property-based tests (hypothesis) over random slates to catch drift before ship.
