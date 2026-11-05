# Locations — where everything lives

All paths below were confirmed to resolve on **2026-11-04** unless a different date is stated.

## The canonical home

- **Repository**: the private GitHub repo `Davidebri1/fantasygrinder`, branch `main`.
- **Local checkout**: `C:\Users\D\fantasygrinder`.
- As of 2026-11-04 the tip commit of that checkout was `7aec943`.
- A second git remote, named `monorepo`, points at the monorepo checkout for history access.

The extraction that produced this is recorded in [repository-extraction.md](repository-extraction.md).

## The old locations, and why they are not the home

- **Old source worktree**:
  `C:\Users\D\.local\share\opencode\worktree\221c160e7278031e2c84b6fd6044b73153b3f471\g5-gauntlet-opencode-go-minimax-m3-1\fantasy_grinder`.
  As of 2026-11-04 this path resolved. It is a **hidden path** — nested under `.local\share\opencode\worktree\`
  — which is why plain folder searches did not surface the project. If a search comes up empty, look
  there.
- **Monorepo main checkout**: `C:\Users\D\DFS Github`. As of 2026-11-04 this path existed and was
  the monorepo's main checkout, but it **does not contain the app**. The app lived in the worktree above,
  not in this checkout.
- **Monorepo repo**: `Davidebri1/dfs-optimizer`, from which the app was subtree-split on 2026-11-03.

## Google Drive mounts

Google Drive for Desktop on this machine mounts **four separate accounts**, each with its own `My Drive`:

| Mount | Account label | As of 2026-11-04 |
|---|---|---|
| `P:\My Drive` | account 1 | present |
| `E:\My Drive` | account 2 | present |
| `G:\My Drive` | account 3 | present |
| `H:\My Drive` | account 4 | present |

As of **2026-11-03 there was NO copy of the Fantasy Grinder app in any Drive account.** The four
near-misses, all of which are *not* the app:

- `P:\My Drive\DFS optimizer 1\dfs-optimizer-app` — a **different repo**, older build.
- `P:\My Drive\dfs-optimizer-main` — the **Flutter app**, not this React + Django product.
- `E:\My Drive\Fantasy Grinder DFS Optimizer - 2026-09-10` — the **September deliverables bundle**,
  containing the older React build.
- Ten single-file `fantasy-grinder-dfs-*.zip` archives in `G:\My Drive` — a **different, single-file
  Tailwind product state**, not this app.

The practical consequence: the Drive is not a backup of the current product. The git repository at
`C:\Users\D\fantasygrinder` is the only copy of the current code, and the 2026-11-03 rescue in
[repository-extraction.md](repository-extraction.md) is the reason the newest work exists at all.

## Build output and public site

- **Frontend source**: `C:\Users\D\fantasygrinder\frontend\react`
- **Build output**: `C:\Users\D\fantasygrinder\frontend\react\dist` — this is what gets published.
- **Backend source**: `C:\Users\D\fantasygrinder\backend\django`
- **Live public site**: `https://fantasygrinder.surge.sh/` — as of 2026-11-04 still serving the
  September build. See [deployment.md](deployment.md).

## Operator home-directory files

- The Surge credential lives in the operator's `~/.netrc` and nowhere else. As of 2026-10-31 that file
  had no backup on the machine. See [credential-incident.md](credential-incident.md).
