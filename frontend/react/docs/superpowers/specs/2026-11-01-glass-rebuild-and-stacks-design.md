# Fantasy Grinder — Glass rebuild, clickable app, RotoWire stacks

Date: 2026-11-01
Status: approved in principle; canvas direction delegated to the agent.

## 1. What is wrong today

Three defects, all confirmed in the code:

1. **Nothing is clickable.** Lineup card rows are plain `<tr>` with a hover tint
   (`src/components/RotoLineupCard.tsx:101`). Exposure rows are `<li>` with no
   handler (`src/components/ExposureReport.tsx:159`). The pool table exposes
   three small icon buttons and nothing else (`src/components/PlayerPoolTable.tsx:97`).
   There is no player detail view anywhere in the app, no filtering, no
   way to act on a player.
2. **Player identity is photo + name.** Team is grey text, position is a quiet
   word, jersey number is absent. ESPN sends `jersey` in the roster feed and
   the pipeline drops it. The pool table's Pos/Team/Opp columns exist for NBA
   only (`PlayerPoolTable.tsx:54`) — NFL, MMA and Golf have no position or
   team column at all.
3. **Stacks are not implemented.** `src/types.ts:145-148` declares
   `team_stacking_rules`, `global_min_players_per_team` and
   `global_max_players_per_team`; nothing reads them. The only correlation in
   the engine is Monte Carlo variance (`src/optimizer/simulate.ts`). There is
   no "Daily Lineup Stacks / Generate Stacks / Use Stack", and no game or team
   limits.

Plus the visual bar: the current flat opaque surfaces do not reach the
MiniMax Code reference.

## 2. Visual system — "a stadium at night, seen through frosted glass"

The canvas is dark because the work happens at night, and because glass is
the material the reference uses. The colour field is not a painted gradient:
it is the existing field-lines photograph, blurred until it becomes texture,
with real light sources on top of it.

### 2.1 Backdrop stack (bottom to top)

1. `--canvas` base: `#07090E`.
2. `public/hero/field-blurred.webp` — the field-lines photograph, Gaussian
   blur radius 28, desaturated to 35%, darkened, downscaled to 640×360 and
   saved as WebP. Blur is baked into the asset so the browser pays nothing.
   Full-bleed, `position: fixed`, `z-index: -20`.
3. Three CSS light sources over it, `mix-blend-mode: screen`:
   - **Key** — cold white-blue `#BFD6FF`, large, from the top. Direction of light.
   - **Fill** — the sport's colour, from the lower left, and it is the
     brightest bloom. It sits behind the working area so the lineup stack is
     the lit zone.
   - **Counter** — warm ember `#FF7A45`, small, upper right, low opacity.
   - No violet. No purple-to-blue gradient.
4. Grain overlay, `opacity .28`, `mix-blend-mode: overlay`.

The fill colour is driven by `--sport`, set on the root element from the
active sport, so the app's light is the sport's colour:
NBA `#4C8DFF`, NFL `#25C97F`, MMA `#FF5A3C`, Golf `#F0C64B`.

### 2.2 Materials

Token names stay as they are — the values change — so no component has to be
renamed. Redefined values:

| token | value | meaning |
|---|---|---|
| `--canvas` | `#07090E` | the dark room |
| `--canvas-deep` | `#04060A` | deepest well |
| `--surface-1` | `rgba(255,255,255,.045)` | glass card |
| `--surface-2` | `rgba(255,255,255,.026)` | recessed glass |
| `--surface-3` | `rgba(255,255,255,.075)` | hover glass |
| `--surface-4` | `rgba(255,255,255,.085)` | floating glass |
| `--inset` | `rgba(0,0,0,.24)` | cut-in well |
| `--line` | `rgba(255,255,255,.09)` | hairline |
| `--line-strong` | `rgba(255,255,255,.18)` | hairline, emphasised |
| `--ink` | `#EEF2F8` | primary text |
| `--ink-muted` | `#9BA7B9` | secondary text |
| `--ink-subtle` | `#6C7789` | tertiary text |
| `--ink-on-dark` | `#EEF2F8` | kept for chrome; now the same as `--ink` |
| `--ink-on-dark-muted` | `#9BA7B9` | as above |
| `--chrome` | `rgba(10,14,22,.66)` | the chrome bar, glassy |
| `--chrome-deep` | `rgba(5,8,13,.86)` | under the chrome |
| `--brand` | `#4C8DFF` | data bars, links, selection |
| `--brand-wash` | `rgba(76,141,255,.14)` | selection fill |
| `--good` | `#3ED598` | positive state |
| `--warn` | `#F5B942` | caution state |
| `--action` | `#FFFFFF` | the single bright primary action |
| `--danger` | `#FF6A4D` | exposure over cap, errors |

Radii: `--radius-1 10px`, `--radius-2 16px`, `--radius-3 22px`, `--radius-4 30px`.

Height is expressed by blur + hairline + one soft deep shadow, never by a
solid card sitting on a solid card:

```
--shadow-1: 0 1px 2px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.05);
--shadow-2: 0 8px 24px -12px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06);
--shadow-3: 0 18px 44px -18px rgba(0,0,0,.72), inset 0 1px 0 rgba(255,255,255,.07);
--shadow-4: 0 32px 72px -24px rgba(0,0,0,.82), inset 0 1px 0 rgba(255,255,255,.08);
```

`.panel`, `.control`, `.floating` and the chrome bar get
`backdrop-filter: blur(22px) saturate(140%)`. `.well` does not blur (it is
recessed, not floating) but takes a dark fill and an inner hairline.

### 2.3 Type

Drop Barlow and Barlow Condensed. The condensed uppercase voice is
"broadcast graphics", not "working tool". Load **Inter** (400/500/600/700),
**Inter Tight** (500/600) and keep **IBM Plex Mono** for figures.

Tailwind maps `font-condensed` → Inter Tight so every existing usage changes
voice without a rename. `font-display` → Inter Tight as well.

Labels stay body face, one step smaller, sentence case, untracked.

### 2.4 Motion

Only motion that carries information: lineup cards reveal in rank order, the
aurora drifts on a 90–140s cycle, the live dot pulses while a feed refreshes.
All of it stops under `prefers-reduced-motion`. No `transition: all`, no
animated width/height/top/left.

## 3. Player identity

One chip, used everywhere a player appears:

```
[photo 40px] [name] [position badge] [team crest] [jersey no.]
```

- **Position badge** — 20px rounded tile, mono, uppercase. Coloured by
  position family so a lineup's shape is legible at a glance: guards `#4C8DFF`,
  wings `#3ED598`, bigs `#F5B942`, quarterbacks `#FF6A4D`, receivers `#B07CFF`?
  — no. Families are exactly: NBA `G` blue / `F` green / `C` amber; NFL
  `QB` ember, `RB` green, `WR` blue, `TE` amber, `DST` slate; MMA neutral;
  Golf neutral.
- **Team crest** — real logo from `https://a.espncdn.com/i/teamlogos/{nba|nfl}/500/{abbr}.png`.
  On load failure, fall back to a monogram tile filled with the team's
  primary colour, from a table covering all 30 NBA and 32 NFL teams.
- **Jersey number** — carried from the ESPN roster `jersey` field into the
  `Player` model as `jersey`, for NBA and NFL.

The pool table gains position, team and opponent columns for **every** sport,
not just NBA.

## 4. Interaction model — nothing is a dead end

| Where | Click does |
|---|---|
| Player row — lineup card, pool, exposure | Opens the player drawer |
| Team crest or team cell | Filters the pool to that team |
| Game cell | Filters the pool to that game |
| Exposure row | Filters the pool to that player |
| Lineup card body | Expands matchup detail (opponent, implied score, stack hits) |
| Lineup card actions | Copy lineup as text; lock lineup so it survives a rebuild |
| Pool column header | Sorts by that column |
| Pool row action icons | Lock / Like / Exclude, revealed on hover and focus |

**Player drawer** — right-side glass sheet, 380px, over the app:
photo, name, position badge, team crest, opponent crest, jersey number, tip
time, salary, projection, Roto Score, projected ownership, portfolio
exposure, injury note, and the actions Lock / Like / Exclude / Use in stack.
Closes on Escape or an outside click. Focus moves into the sheet and is
trapped while open.

**Filters** — active filters are shown as glass chips above the pool with a
clear button. Filtering narrows the pool table only; it never changes what
the optimizer built.

## 5. Stacks — RotoWire parity

A **Stacks** tab joins Lineups / Exposure / What to enter / Player pool.

**Generate stacks** scans the live slate and ranks candidates:

- **NFL / NBA team stack** — a quarterback (or the highest-scoring player)
  plus one to three teammates from the same team. Two-man and three-man
  variants.
- **Game stack** — the strongest players from both sides of one game.
- **MMA card stack** — both fighters from one bout, or a group from the same
  card.

Each row shows: stack name, positions, teams, combined salary, combined
projected points, value per $100 of salary, and roster % (average projected
ownership of the players in it).

**Use stack** writes a rule into the optimizer settings and rebuilds:

```
StackRule = { scope: "team" | "game", id: string, min: number, max: number }
```

The engine enforces it inside `buildPortfolio`, alongside the existing MMA
`isLegal` check. If a rule cannot be satisfied the build relaxes it and says
so in the warnings, the same way the exposure cap relaxes today — never a
silent truncation.

The three dead fields (`team_stacking_rules`,
`global_min_players_per_team`, `global_max_players_per_team`) are wired to
the same rule path so they stop being inert.

## 6. Data pipeline additions

- `jersey?: string` on `Player`, populated from the ESPN roster payload for
  NBA and NFL.
- `teamColor?: string` optional, used only by the crest fallback.
- Nothing else in the pipeline changes.

## 7. Acceptance criteria

1. Every player row in the app is clickable and opens the drawer.
2. Every player shows position, team crest and jersey number.
3. NFL, MMA and Golf pool tables have position and team columns.
4. The Stacks tab generates ranked stacks from the live slate, and "Use
   stack" changes the optimizer output — verifiable by the build warnings
   naming the rule.
5. `npx tsc -b --noEmit` exits 0; `npm run build` exits 0;
   `npx vitest run` passes, with new tests covering the stack constraints.
6. The live site still returns the full requested lineup count for all four
   sports with no console errors.
7. No dead tokens remain: every token in `:root` is referenced somewhere.
8. `prefers-reduced-motion` disables the aurora drift and the reveal.

## 8. Build order

1. Foundation: tokens, tailwind mirror, backdrop, blurred asset, crest data,
   player chip, jersey plumbing.
2. Engine: stack rules in `buildPortfolio`, settings plumbing, tests.
3. Interaction: drawer, filters, lineup card actions, pool table.
4. Stacks: generator module, Stacks tab, wiring into the optimizer screen.
5. Integrate, typecheck, build, test, verify in a browser, deploy.
