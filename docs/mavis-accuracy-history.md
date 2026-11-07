# Projection accuracy: career-to-date backtest (mavis, 2026-11-07)

Backtest of Dave's projection model (frontend/react/src/lib/dave-projection.ts) against real DraftKings-point actuals, rebuilt over the full history ESPN publishes. Built by mavis.

**What changed from the rejected run.** The old run used 2023-2026, needed only 5 prior games inside the current season, and led with mean absolute error. This run goes back to 2002, requires **30 prior games across the player's whole career**, and leads with scenario metrics. Mean absolute error is not a metric in this document.

## The headline numbers

| | Model | Baseline (plain prior-games average) |
|---|---|---|
| Target games | 5,343 | 5,343 |
| Boom games called HIGH | 49.2% | 90.3% |
| Bust games called LOW | 52.6% | 10.1% |
| Direction call matched the outcome | 50.9% | 50.7% |
| Upward-trend cases identified | 48.4% | 87.3% |
| Actual inside the 90% interval (supporting) | 51% | 56.8% |
| Welch t, projection vs actual (supporting) | -2.93 | -1.01 |

Chance is 50% on the first three rows. The baseline column is the plain prior-games average: it has no split and no factor, so the only half it can be said to call is the half its own average sits in. Paired tests on the same games (McNemar-style): direction z = 0.13, boom detection z = -30.3, bust detection z = 30.46, upward-trend identification z = -24.34. The model's direction call against a coin flip is z = 1.27.

## Method, in plain words

We rebuilt every game log we could from ESPN's public data: the completed regular-season schedule for 4 teams (ne, gb, pit, sf) from 2002 through 2026, then each game's box score, then scored every offensive player's game with DraftKings' own points rubric, including the 100-yard and 300-yard bonuses.

Then we walked forward through each player's career. For every game the only inputs are that player's **earlier games** (every completed game of theirs before this one, across all seasons, sorted by date) plus the two things about the upcoming game that are known before kickoff: home or road, and the month. A projection is issued **only when the player has at least 30 earlier games**; below that the harness records "insufficient sample" and issues nothing. 5,343 target games qualified and 19,638 were skipped.

The model splits the earlier games into a high half and a low half at the median, finds the one pre-game factor that separates them best, and projects the game as highMean x P + lowMean x (1 - P). The **baseline** is the plain prior-games average: no split, no factor, no weighting. That is what "nobody special" looks like, and the model only wins if it beats it on the scenario metrics above.

## Variables, defined

- **Earlier games** - that player's completed games whose date is *strictly before* the target game's date, drawn from every season in the dataset and sorted by date ascending. prior_games_n is how many there are.
- **Target game** - a completed game for a player. It *qualifies* when the player has 30 or more earlier games; otherwise it is *skipped* with the reason "insufficient sample" and no projection is issued.
- **High half / low half** - the model's own median split of the earlier games by DK points: the low half takes the first ceil(n/2) games, the high half the rest, so an odd count puts the middle game in the low half.
- **Cut (C)** - the largest DK point value in the low half. Everything at or below C is low, everything above is high. For an odd number of earlier games this is the median score; for an even number it is the lower median.
- **Boom game** - the target game landed in the player's high half: its actual DK points are greater than C.
- **Bust game** - the target game landed in the low half: its actual DK points are at or below C.
- **Factor** - the single pre-game-known condition (home/road, month) that separates the high half from the low half most strongly. Exactly one is used.
- **P** - the model's probability that the high half's factor condition holds in the target game: 1 if it holds, 0 if it does not, 0.5 when the condition is unknown, or when the two halves are statistically the same population.
- **Containment** - the actual DK points land inside the predictor's 90% interval.
- **Baseline** - the plain prior-games average: the arithmetic mean of all the earlier games, no split, no factor, no weighting, no outlier removal. Its scenario is simply which side of the cut that average falls on.
- **Upward-trend case** - a target game where the mean of the last 5 earlier games is greater than the mean of the first 5 earlier games *and* the actual landed high.

## Coverage

| Season | Players with games | Players that qualified | Target games | Boom games | Bust games | Model direction | Baseline direction |
|---|---|---|---|---|---|---|---|
| 2002 | 197 | 0 | 0 | 0 | 0 | n/a | n/a |
| 2003 | 189 | 3 | 5 | 2 | 3 | 80% | 20% |
| 2004 | 198 | 10 | 92 | 52 | 40 | 51.1% | 60.9% |
| 2005 | 194 | 15 | 109 | 50 | 59 | 49.5% | 48.6% |
| 2006 | 184 | 11 | 112 | 51 | 61 | 50.9% | 51.8% |
| 2007 | 194 | 12 | 116 | 66 | 50 | 52.6% | 56.9% |
| 2008 | 190 | 9 | 70 | 30 | 40 | 47.1% | 51.4% |
| 2009 | 357 | 16 | 182 | 93 | 89 | 50% | 45.6% |
| 2010 | 359 | 22 | 175 | 83 | 92 | 56.6% | 46.3% |
| 2011 | 402 | 27 | 309 | 161 | 148 | 46.6% | 50.2% |
| 2012 | 375 | 32 | 314 | 163 | 151 | 48.1% | 51.3% |
| 2013 | 366 | 35 | 262 | 147 | 115 | 48.5% | 57.3% |
| 2014 | 427 | 38 | 318 | 159 | 159 | 48.7% | 50% |
| 2015 | 409 | 38 | 284 | 141 | 143 | 48.6% | 54.2% |
| 2016 | 399 | 35 | 251 | 149 | 102 | 52.6% | 55.4% |
| 2017 | 429 | 36 | 252 | 131 | 121 | 54.8% | 50.8% |
| 2018 | 409 | 38 | 250 | 133 | 117 | 48.4% | 53.2% |
| 2019 | 409 | 37 | 272 | 134 | 138 | 50.4% | 50.7% |
| 2020 | 442 | 39 | 264 | 139 | 125 | 54.5% | 48.9% |
| 2021 | 420 | 46 | 305 | 155 | 150 | 50.2% | 48.5% |
| 2022 | 417 | 46 | 305 | 132 | 173 | 50.5% | 48.9% |
| 2023 | 425 | 43 | 269 | 124 | 145 | 49.8% | 47.6% |
| 2024 | 406 | 42 | 291 | 138 | 153 | 53.3% | 47.4% |
| 2025 | 413 | 44 | 374 | 188 | 186 | 52.1% | 49.7% |
| 2026 | 300 | 37 | 162 | 87 | 75 | 58% | 50.6% |
| **Total** | **2521** | **179** | **5343** | **2708** | **2635** | **50.9%** | **50.7%** |

- The series runs 2002 to 2026. **Where the data stops:** ESPN's public schedule and box-score endpoints still serve completed games for seasons before 2002 (checked back to 1995 during the build; the endpoints answered with full box scores), so the series is not truncated by ESPN. The floor is the 30-game sample gate and the sampled teams, not the data.
- 19,638 candidate games were skipped for insufficient sample (fewer than 30 earlier games). Nothing was projected for those.
- 1,532 of 1,532 planned game summaries were obtained; 0 requests failed after retries and are listed in the JSON.
- 1,811 HTTP requests this run in 19 seconds (1,532 game summaries fetched from ESPN, 0 served from the local cache, which lives in the OS temp directory). A cold run with an empty cache needs about 1,811 requests: 1,532 game summaries, 100 team schedules and 179 position lookups. There were 0 failed requests after retries.
- The per-season player column counts distinct players within that season; the total row is the distinct count across the whole run.
- Positions in the audited population: QB 1,064, RB 1,429, WR 1,796, FB 236, TE 818 (target games).

## Actionable metrics, model vs baseline

### The model's own scenario (from P)

| Metric | Model | Baseline | Winner |
|---|---|---|---|
| Boom games called HIGH | 49.2% | 90.3% | baseline |
| Bust games called LOW | 52.6% | 10.1% | model |
| Direction call matched the outcome | 50.9% | 50.7% | model |
| Upward-trend cases identified | 48.4% | 87.3% | baseline |

The model declined to call a side on 0% of target games (P = 0.5: the halves were one population, or nothing separated them). Those count as a miss in the rows above. When the model does call, it matched the outcome on 50.9% of its 5,343 calls.

### The same classifier on both sides

The model above is scored on its own scenario output. To compare like with like, both sides can be classified by one rule: where the forecast sits relative to the same cut C.

| Metric (same classifier) | Model | Baseline | Winner |
|---|---|---|---|
| Boom games called HIGH | 49.2% | 90.3% | baseline |
| Bust games called LOW | 52.6% | 10.1% | model |
| Direction call matched the outcome | 50.9% | 50.7% | model |
| Upward-trend cases identified | 48.4% | 87.3% | baseline |

### Supporting lines, by era

| Era | Target games | Model boom-HIGH | Baseline boom-HIGH | Model bust-LOW | Baseline bust-LOW | Model direction | Baseline direction | Model trend | Baseline trend | Containment model | Containment baseline | Welch t model | Welch t baseline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2002-2008 | 504 | 49% | 91.6% | 52.6% | 15.8% | 50.8% | 53.6% | 45.3% | 89.1% | 49.6% | 56.5% | -0.3 | 0.32 |
| 2009-2014 | 1560 | 47.4% | 90.8% | 51.1% | 7.6% | 49.2% | 50.6% | 47.9% | 87.9% | 49.4% | 54.6% | -2.31 | -1.57 |
| 2015-2020 | 1573 | 48% | 90.9% | 55.4% | 9.2% | 51.5% | 52.2% | 48.4% | 88.5% | 51% | 56.9% | -3.77 | -1.9 |
| 2021-2026 | 1706 | 52.3% | 88.8% | 51.5% | 11.2% | 51.9% | 48.7% | 49.7% | 84.9% | 53% | 59% | 1.06 | 1.61 |

## Verdict

Over 5,343 target games from 179 qualified players, the model scored higher than the plain prior-games baseline on 2 of the 4 scenario metrics and lost on 2. On the model's own scenario output it called 49.2% of boom games HIGH (baseline 90.3%, chance 50%), 52.6% of bust games LOW (baseline 10.1%), and its direction call matched the actual outcome on 50.9% of all target games against the baseline's 50.7%; when the model actually called a side it was right 50.9% of the time. The reason is visible in the conditional rates. When the model says HIGH (P = 1) the game turned out to be a boom 51.6% of the time; when it says LOW (P = 0) the game was a bust 50.2% of the time. Both are a coin flip. The model's direction call is worth z = 1.27 against chance, and a paired z of 0.13 against the baseline on the same games. It identified 48.4% of the 1,975 upward-trend cases against the baseline's 87.3%. Plainly: it is a mixed result, not a clean win - the model wins 2 of the 4 and loses 2, and the losses are stated above without softening. Read the two wins carefully. The bust-detection win is large and real (paired z = 30.46). The direction-call win is not a win at all: 50.9% against 50.7% is a paired z of 0.13, which is noise. The two losses are real too, and they are the price of the baseline's HIGH lean: it calls HIGH on 90.1% of games, so it wins any metric that rewards saying HIGH and loses badly on bust detection (10.1% against the model's 52.6%). Through one identical classifier on both sides the model wins 2 and loses 2 of the same four rows. Supporting lines: containment in the 90% interval was 51% for the model against 56.8% for the baseline, and Welch t against the actuals was -2.93 for the model against -1.01 for the baseline.

## Caveats, stated plainly

- **DraftKings' own per-game projections are not public for past seasons.** Nothing here compares against a DK projection, because there is nothing public to compare against. The baseline is the plain prior-games average, which is the only comparison buildable from public data.
- **Contest-level metrics are not in this run and they are not faked.** Winning contests predicted, accurate picks inside winning contests, and contests contributed to all need DraftKings contest results, which are not publicly available. They stay pending until a DraftKings contest-entry feed exists. The moment that feed exists, these are the metrics that get computed from it: (1) *winning contests predicted* - the number and share of entered contests in which the model's lineup finished first, from the published final standings; (2) *accurate picks inside winning contests* - the share of the model's picks within those winning lineups that individually clear the contest's ownership thresholds at their position; (3) *contests contributed to* - the number of contests the model supplied a lineup for, so every rate has its own denominator; (4) *ROI* - only if the feed carries entry fees and payouts; (5) *top-N finish rate* - the share of entered contests where the model placed in a paying percentile. None of these are estimated, implied or guessed here.
- **Factors fed were pre-game-known only**: home/road and month. In-game information (opponent form, rest, injuries, weather, usage share) was deliberately withheld, because feeding it would fabricate knowledge the projection would not have at lineup time. It is also why the factor's separation power is modest.
- **A player's log only contains games for the sampled teams.** A player who spent part of a season with a club outside ne/gb/pit/sf has that stretch missing, so their earlier-games count is understated and their split is computed over what we have. The gate is conservative in that direction: it makes the 30-game test harder, not easier.
- **ESPN's box scores do not expose two-point conversions** in the receiving group, so that DraftKings component is 0 in every game in this run. It is worth a fraction of a point per game and is not what separates the model from the baseline.
- **The 90% interval is optimistic.** With halves this small the normal quantile is anti-conservative, which is why containment sits well below 90% for both sides. Treat containment as a relative comparison only.
- **The baseline leans HIGH by construction.** A plain average of a boom/bust distribution sits above the player's median, so its implied call is HIGH on 90.1% of games. That is a property of the naive estimator, not a choice made to favour the model, and it is reported as it comes out.
- **The model and Welch maths are a deliberate plain-Node port of src/lib/dave-projection.ts** so the harness runs under bare node with no app imports. The port was checked against the engine itself.

## What this means for the model

- **The 30-game gate is doing its job.** 19,638 candidate games were refused for insufficient sample and 5,343 were projected. That is the difference between projecting from a handful of games and projecting from a career.
- **The model never abstains.** With 30 or more prior games the Welch sameness test never fired (0 of 5,343 rows) and the factor's condition is always known before kickoff, so P was never 0.5. The model called a side on 100% of target games; the games where the honest answer was "I don't know" were forced into a call.
- **The factor is the whole story, and the factor is mostly selection noise.** The winning pre-game factor was month on 3,848 games (72%), isHome on 1,495 games (28%). P was 1 on 48.3% of games, 0 on 51.7% and 0.5 (no call) on 0%. The winning factor separated the two halves by an average of 0.19 on the very games it was chosen from, and then carried almost nothing into the next game: 51.6% boom rate when it said HIGH, 50.2% bust rate when it said LOW.
- **The search prefers high-cardinality factors.** month won 72% of all games. A twelve-level month factor has many more chances to separate two halves of fifteen by luck than a binary home/road flag does, so the search takes it, and takes it for no predictive reason.
- **The fix is a stricter factor, not a different split.** Require the winning factor to clear a minimum separation (or a permutation test) before it is allowed to set P, and fall back to P = 0.5 when it does not. On this data that one change would stop the model forcing a call on 100% of games and would put it on the same answer as the baseline on most of them.
- **The split is not the weak part, the inputs are.** The factor pool here is only home/road and month. Both are known before kickoff, which keeps the test honest, but they are weak separators for a fantasy ceiling. The next real gain is a stronger pre-game factor set (opponent strength, rest days, usage share from the previous game), not a different splitting rule.
- **Keep the plain average in the room.** It is the control. Any change to the model has to beat it on boom detection, bust detection and direction match, over a career-long sample, before it counts as an improvement.
- **Contest results are still missing.** Nothing here says anything about prizes, winning contests or ROI. Those stay pending a DraftKings contest-entry feed, and they are the only metrics that would tell us whether any of this moves money.

Per-game rows: frontend/react/.tmp-audit/mavis-accuracy-history.json (git-ignored). Rebuild with: node scripts/mavis-accuracy-history.mjs
