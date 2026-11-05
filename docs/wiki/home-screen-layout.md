# Home screen layout — the staggered row that was rejected, 2026-11-03

## What was rejected

**Before** commit `7aec943` (that is: in the tree that became `c415472`, dated 2026-11-03), the four
sport cards on the home screen sat at **three different vertical offsets** — `-16px`, `+10px` and
`+34px` — inside a container using `items-start`.

The visible result on 2026-11-03: the row read as **boxes dropped at random heights**, with ragged
bottoms and no common baseline. The project owner rejected that layout as sloppy.

That rejected arrangement is recorded here as history. It is superseded by the layout below and must not
be reintroduced.

## What replaced it

As of `Davidebri1/fantasygrinder@7aec943` (2026-11-03), commit
*"Home screen: one aligned row of sport cards, no staggered heights"*, the home screen is built in
`frontend/react/src/components/HeroPanel.tsx`:

- All four cards share **one top edge, one height and one width**. The grid stretches: the card element
  carries `flex h-full flex-col`, and the inner content wrapper carries `flex flex-1 flex-col`, so each
  card fills the row height.
- Each card's **"Open" row is pinned to the bottom** with `mt-auto pt-5`, so the action line sits on the
  same line across all four cards regardless of how long the description text is.
- **Depth comes from shadow and glass**, not from vertical offsets: `bg-surface-1 backdrop-blur-2xl` with
  `shadow-3`. The only transform in the component is a hover lift (`hover:-translate-y-1`), which is a
  hover state and not part of the resting layout.
- The card that the **hero's primary action points at (NFL)** carries a quiet brand tint
  (`border-brand/40`) and a **"Start here"** chip (`bg-brand-wash`, `text-brand`). It earns emphasis
  through colour and a label, never through a different height — the module docstring in `HeroPanel.tsx`
  records that intent: *"Position is for reading, not for emphasis."*
- The grid is `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5`, so the four cards sit on one line at
  desktop width and reflow to two and then one column below that.

The row hangs over the bottom edge of the hero photograph as a single band, so it reads as one object in
front of the room rather than as separate cards floating at different depths.

## The measurement that proves it

Measured on 2026-11-03 at a **1440x900** viewport, after `7aec943`:

| Property | Value |
|---|---|
| Top edge of all four cards | `y = 591` (identical for all four) |
| Card size | `299 x 222` px (identical for all four) |
| CSS transform on the cards | none (no resting transform) |
| Gutter between cards | even, 20px |

Four cards, one row, one top edge, one height, one width, even gutters.

## How to re-run the measurement

The verification script already exists in the repo:
`frontend/react/scripts/check-card-layout.mjs`.

As of 2026-11-03 it launches Playwright at a 1440x900 viewport, selects the card elements, and prints each
card's `href`, `x`, `y`, `w`, `h`, `transform` and `zIndex`. It then prints the unique tops, the
unique heights and the unique left edges, and an explicit verdict line:

```
aligned row: true
```

when the row has exactly one top, one height, one left edge and four cards. It also writes a screenshot.

Typical use, as of 2026-11-03:

```bash
cd frontend/react
npm run build && npm run preview          # serve the build the script points at
node scripts/check-card-layout.mjs http://localhost:4174/ home-cards-desktop.png
```

**Caveat, recorded 2026-11-03:** the script pins `executablePath` to one specific installed headless
Chromium build under the operator's local Playwright cache. If that exact build is not installed on the
machine, the script fails to launch even though Playwright itself is installed. The Playwright browser
build the project expects may not match what is installed locally — check the path before concluding that
the layout regressed.

See also [deployment.md](deployment.md) for how a build gets published and proved live, and
[product.md](product.md) for the rest of the app.
