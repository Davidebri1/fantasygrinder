# Projection accuracy history: 2023-2026 (mavis, 2026-11-06)

Backtest of the projection model against past seasons of real DraftKings-point actuals. Built by mavis.

| Season | Players | Validations | His model 90% hit rate | Baseline 90% hit rate | Welch t (his vs actual) | Welch t (baseline vs actual) | His avg miss | Baseline avg miss |
|---|---|---|---|---|---|---|---|---|
| 2023 | 8 | 63 | 44.4% | 52.4% | 0.37 | -0.29 | 6.63 | 5.47 |
| 2024 | 10 | 104 | 42.3% | 46.2% | -0.58 | -0.84 | 7.45 | 6.75 |
| 2025 | 18 | 149 | 55% | 56.4% | -0.44 | -1.09 | 5.3 | 4.7 |
| 2026 | 20 | 42 | 47.6% | 54.8% | 0.96 | 0.39 | 5.81 | 4.73 |

A 90% hit rate near 90% is the ideal: it means the range is honest about its own uncertainty, not that the projections are perfectly right. The average miss is how far off the projection was, in DraftKings points, on an ordinary game.

## Method, in plain terms

We took all 32 players available across QB, RB, WR and TE in the current DraftKings file (it covers a two-team slate, Baltimore and Jacksonville) and rebuilt every one of their game logs for the 2023, 2024, 2025 and (to date) 2026 seasons from public box scores, scoring each game with DraftKings' own points rubric. Each game is predicted only from the games before it that season — no peeking at the future. His model splits a player's earlier games into a good half and a bad half and projects the next game from those two halves, with a range around it. The baseline for older seasons is simply the player's own average of the games before it, given the same range width; for 2026 the baseline is DraftKings' published per-player FPPG number.

## Honest caveats

- DK per-game projections are not publicly available for past seasons. For 2023-2025 the comparison is the same DK scoring rubric applied to the player's own prior-games average in that season (the season-average projection). For 2026 the real DK FPPG from the draftables file is used.
- The comparison interval is the same machinery: Dave's model's 90% half-width for that game, centred on the comparison number. DK publishes no interval of its own.
- Factors fed to the model are pre-game-known only: home/road and month. In-game factors would fabricate knowledge.
- ESPN's per-athlete gamelog endpoints return 404 in the current API; game logs are rebuilt from team schedules and event summaries. A player's past-season games only appear if one of the chosen teams played in them, so per-season coverage varies (reported honestly per season).
- Actual DK points come from ESPN box scores with DraftKings' published scoring rubric, including the 300/100-yard bonuses.
- The model and Welch math are a deliberate plain-Node re-implementation of src/lib/dave-projection.ts (same math, no app imports).

## Coverage, honestly

- 2023: 8 of the 32 sampled players had enough games that season to validate (12 appeared in any fetched box score; the rest were not on Baltimore or Jacksonville that season, or did not play). Nothing was fabricated — a player without a complete log simply is not counted.
- 2024: 10 of the 32 sampled players had enough games that season to validate (15 appeared in any fetched box score; the rest were not on Baltimore or Jacksonville that season, or did not play). Nothing was fabricated — a player without a complete log simply is not counted.
- 2025: 18 of the 32 sampled players had enough games that season to validate (20 appeared in any fetched box score; the rest were not on Baltimore or Jacksonville that season, or did not play). Nothing was fabricated — a player without a complete log simply is not counted.
- 2026: 20 of the 32 sampled players had enough games that season to validate (32 appeared in any fetched box score; the rest were not on Baltimore or Jacksonville that season, or did not play). Nothing was fabricated — a player without a complete log simply is not counted.

## Verdict, per season

- **2023**: His model's interval held actuals WORSE than the season-average baseline interval (44.4% vs 52.4%). His model's average miss was 6.63 points vs 5.47 for the baseline.
- **2024**: His model's interval held actuals WORSE than the season-average baseline interval (42.3% vs 46.2%). His model's average miss was 7.45 points vs 6.75 for the baseline.
- **2025**: His model's interval held actuals WORSE than the season-average baseline interval (55% vs 56.4%). His model's average miss was 5.3 points vs 4.7 for the baseline.
- **2026**: His model's interval held actuals WORSE than the DK FPPG interval (47.6% vs 54.8%). His model's average miss was 5.81 points vs 4.73 for the baseline.

Per-game detail is in .tmp-audit/mavis-accuracy-history.json (git-ignored, under frontend/react). Rebuild with: node scripts/mavis-accuracy-history.mjs
