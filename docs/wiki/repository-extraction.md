# Repository extraction — 2026-11-03

## What happened

On **2026-11-03**, Fantasy Grinder was extracted out of the monorepo `Davidebri1/dfs-optimizer` into
its own repository.

As of 2026-11-03, the canonical home of the app is the **private GitHub repo
`Davidebri1/fantasygrinder`**, branch `main`, with the local checkout at
`C:\Users\D\fantasygrinder`. As of 2026-11-04 the tip commit of that checkout was `7aec943`.

## How the extraction was done

On 2026-11-03 the app was extracted with a **git subtree split**, not a copy:

```bash
git subtree split --prefix=fantasy_grinder
```

The subtree split walks the monorepo's history and replays only the commits that touched that prefix,
producing a standalone commit chain with the app moved to the repository root. The result on 2026-11-03
was that the **8 original commits were preserved** — the extraction rewrote no history and dropped no
work from the original chain.

The new repo keeps the monorepo as a **second git remote named `monorepo`**, pointing at the local
monorepo checkout, so the two histories stay connected. As of 2026-11-03 the remotes on
`C:\Users\D\fantasygrinder` were:

- `origin` → the GitHub URL of the private repo `Davidebri1/fantasygrinder`.
- `monorepo` → the local path of the monorepo checkout, used for fetch and push.

## The uncommitted-work rescue (read this before you move or clean any worktree)

This is the part worth learning from, and the part most likely to be repeated.

On **2026-11-03**, the source worktree held a large body of **uncommitted work**: the glass visual
rebuild, real stacking rules, the portfolio / exposure engine, ESPN live sync and the hero artwork —
**60 files, +9,688 lines**. That work existed nowhere else: not in the monorepo, not in the new repo, not
on any remote. A plain copy of the checkout would have shipped an older app; a plain clone would have
lost it entirely.

The rescue was done with plumbing that creates a commit object **without moving any branch and without
touching the operator's working tree**:

```bash
git add -A
git write-tree
git commit-tree <tree> -p <parent> -m "message"
```

`git add -A` built the index from the working tree, `git write-tree` wrote that index out as a tree
object, and `git commit-tree` created a commit object pointing at it. No branch was moved, so the
operator's working tree and index were left exactly as they were. That commit was then subtree-split and
pushed, and it landed as **commit `c415472`** — "Glass rebuild + stacking: frosted-glass dark theme,
real stack rules, exposure report, hero art" — on 2026-11-03.

### The lesson, stated once

Before cleaning up, moving, archiving or deleting **any** worktree, run `git status` in it first. If it
shows uncommitted work, rescue it with the add / write-tree / commit-tree sequence before touching
anything else. A worktree's uncommitted files are in neither git nor any remote until a commit object
exists.

## How to get back to the old worktree

On 2026-11-03 the app previously lived inside a git worktree at:

```
C:\Users\D\.local\share\opencode\worktree\221c160e7278031e2c84b6fd6044b73153b3f471\g5-gauntlet-opencode-go-minimax-m3-1\fantasy_grinder
```

That path still resolved as of 2026-11-04 — the parent `worktree` directory holds several worktrees
(`221c160e7278031e2c84b6fd6044b73153b3f471`, `221c160e7278031e2c84b73153b3f471`,
`7096effdddea9fada5d3cca9be6b6e84fbe49327`, `85fbd8c4e9ae6df7e3c54ec7c138580fd91c50ac` and
`c105e5fa0c05ccd77deee8aee0db82f35cd05998`).

To look at the old state, cd into that `fantasy_grinder` directory and inspect it as a normal git
working tree. Its history is the monorepo's history restricted to the app prefix, so its older commits
line up with the first 8 commits preserved in the new repo.

One warning about that path, recorded 2026-11-03: it is a hidden directory tree under
`.local\share\opencode\worktree\`, which is why plain folder searches did not surface the project. If
you cannot find Fantasy Grinder by searching folders, look under
`C:\Users\D\.local\share\opencode\worktree\` — not just in `C:\Users\D\`.

See also [locations.md](locations.md) for every other location, and
[home-screen-layout.md](home-screen-layout.md) for what changed in the interface during this period.
