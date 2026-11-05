# Fantasy Grinder — project wiki

Durable tribal knowledge for the Fantasy Grinder DFS lineup optimizer. Written on 2026-11-04.

Every claim in this wiki is dated. Claims about code cite the commit they were true at, in the form
`Davidebri1/fantasygrinder@<hash>`. When a later change supersedes an earlier statement, the earlier
statement is kept and marked **superseded** — it is never rewritten or deleted.

- Canonical repository: the private GitHub repo `Davidebri1/fantasygrinder`, branch `main`.
- Local checkout: `C:\Users\D\fantasygrinder`.
- As of 2026-11-04 the tip commit of that checkout was `7aec943`.

If you are a future agent with no memory of this project, read this page first, then the page that
matches your task. Nothing here is speculation: each statement was true on the date it carries.

## Product and project

- [product.md](product.md) — What the product is: the mandatory Django + Postgres layer, the React/Vite
  frontend, the in-browser optimizer fallback, the five strategies, and the stacking feature.
  (Statements dated 2026-10-31 to 2026-11-04.)
- [repository-extraction.md](repository-extraction.md) — The 2026-11-03 extraction of the app out of the
  monorepo into its own repo, how the uncommitted work was rescued, and how to get back to the old worktree.

## Interface

- [home-screen-layout.md](home-screen-layout.md) — The staggered home card row that was rejected on
  2026-11-03, the single aligned row that replaced it at `7aec943`, and the measurement that proves it.

## Operations

- [deployment.md](deployment.md) — Publishing to Surge, and proving that the live site is the build you
  think it is (ETag / `surge-stamp`).
- [credential-incident.md](credential-incident.md) — The 2026-10-31 `~/.netrc` wipe that destroyed the
  stored Surge token, and the recovery procedure that brought it back.
- [locations.md](locations.md) — Every known location of the app: the new repo, the old worktree, the
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
