# Fantasy Grinder — project wiki

Durable tribal knowledge for the Fantasy Grinder DFS lineup optimizer. Written on 2026-11-04.

Every claim in this wiki is dated. Claims about code cite the commit they were true at, in the form
`Davidebri1/mavis-fantasy-grinder@<hash>`. When a later change supersedes an earlier statement, the earlier
statement is kept and marked **superseded** — it is never rewritten or deleted.

- Canonical repository: the private GitHub repo `Davidebri1/mavis-fantasy-grinder`, branch `main`.
- Local checkout: `C:\Users\D\mavis-fantasy-grinder`.
- As of 2026-11-04 the tip commit of that checkout was `7aec943`.

If you are a future agent with no memory of this project, read this page first, then the page that
matches your task. Nothing here is speculation: each statement was true on the date it carries.

## Product and project

- [mavis-product.md](mavis-product.md) — What the product is: the mandatory Django + Postgres layer, the React/Vite
  frontend, the in-browser optimizer fallback, the five strategies, and the stacking feature.
  (Statements dated 2026-10-31 to 2026-11-04.)
- [mavis-repository-extraction.md](mavis-repository-extraction.md) — The 2026-11-03 extraction of the app out of the
  monorepo into its own repo, how the uncommitted work was rescued, and how to get back to the old worktree.

## Interface

- [mavis-home-screen-layout.md](mavis-home-screen-layout.md) — The staggered home card row that was rejected on
  2026-11-03, the single aligned row that replaced it at `7aec943`, and the measurement that proves it.

## Operations

- [mavis-deployment.md](mavis-deployment.md) — Publishing to Surge, and proving that the live site is the build you
  think it is (ETag / `surge-stamp`).
- [mavis-credential-incident.md](mavis-credential-incident.md) — The 2026-10-31 `~/.netrc` wipe that destroyed the
  stored Surge token, and the recovery procedure that brought it back.
- [mavis-locations.md](mavis-locations.md) — Every known location of the app: the new repo, the old worktree, the
  monorepo checkout, and the four Google Drive mounts.

## Repo documents (not wiki pages)

These live in the repo and were read on 2026-11-04 while writing this wiki. They are older than the
pages above in several places; where they disagree with a wiki page, the dated wiki page wins.

- [README.md](../../README.md) — product overview, architecture, local dev commands.
- [RUNBOOK.md](../../RUNBOOK.md) — operator runbook.
- [CHANGELOG.md](../../CHANGELOG.md) — commit-by-commit history.
- [architecture.md](../architecture.md) — system architecture notes.
- [optimizer_complexity_notes.md](../optimizer_complexity_notes.md) — solver cost notes.

## Wiki conventions

- One page per thing: a decision, a recurring problem, a subsystem, a preference. Not one page per topic area.
- Facts are dated on the day they were established, not the day they were written down.
- Superseded claims are marked in place with the date of the replacement.
- No credential values, no personal identifiers. The Surge token lives in the operator's `~/.netrc`,
  never in this repo, and is never quoted here.

## 2026-11-04, later in the day

- The repository was renamed to `Davidebri1/mavis-fantasy-grinder` and made **public**. The old URL
  (`Davidebri1/fantasygrinder`) redirects to the new one. The local checkout moved to
  `C:\Users\D\mavis-fantasy-grinder`.
- **Naming rule set by the project owner on 2026-11-04:** everything created for this project carries
  "mavis" plus a descriptive subject in its filename or title — the repo, the folder, the scripts, the
  wiki pages, the screenshots, the Cloudflare Pages project (`mavis-fantasy-grinder`). Descriptive,
  not verbose.
- The site moved off Surge and is now published to **Cloudflare Pages** at
  <https://mavis-fantasy-grinder.pages.dev>. See [mavis-deployment.md](mavis-deployment.md).
- The home screen changed again: the sport cards no longer overlap the banner. See
  [mavis-home-screen-layout.md](mavis-home-screen-layout.md).
