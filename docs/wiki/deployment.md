# Deployment — publishing to Surge and proving what is live

## The live site

The public site is **https://fantasygrinder.surge.sh/**. As of 2026-11-03 it was published with the
**surge CLI**, from the `frontend/react` directory, serving that directory's `dist` output.

The publish command as of 2026-11-03:

```bash
cd frontend/react
npm run build          # produces dist/
surge dist fantasygrinder.surge.sh
```

The surge CLI is interactive. It authenticates from the operator's `~/.netrc`, and it prompts when it
cannot authenticate — running it unauthenticated in a non-interactive shell is what caused the incident
recorded in [credential-incident.md](credential-incident.md). Read that page before publishing.

## How to prove the live site is the build you think it is

Surge returns two headers that make a publish verifiable without guessing:

- **`ETag`** — the SHA256 of the served file.
- **`surge-stamp`** — the publish timestamp in epoch milliseconds.

So the check is mechanical: compute the SHA256 of your local built file, compare it with the live
`ETag`. If they match, the local build **is** the live build. Read `surge-stamp` to learn **when** it
was published.

```bash
# local file hash
sha256sum frontend/react/dist/assets/index-*.js

# live hash + publish time
curl -sI https://fantasygrinder.surge.sh/assets/index-<hash>.js | grep -iE 'etag|surge-stamp'
```

This is the method to use before and after any publish. "I deployed it" is not evidence; a matching
SHA256 and a stamp is.

## The state of the live site on 2026-11-03 (and 2026-11-04)

As of **2026-11-03**, the live site was still serving the **older September build**:
`assets/index-B45PN6sy.js`, published **2026-09-13T02:50:19Z**. The repo tip on 2026-11-03 carried a
**newer** build — the glass rebuild, real stacking rules, exposure report and hero artwork from
`c415472` — which was **not** live.

On **2026-11-04**, a fetch of `https://fantasygrinder.surge.sh/` still returned HTML that references
`./assets/index-B45PN6sy.js`, confirming the September build was still the live one a day later.

**Superseded, and worth knowing:** the repo's `README.md` and `RUNBOOK.md` still describe **Netlify**
(`fantasy-grinder.netlify.app`) and **Render** as the production targets. As of 2026-11-04 the actually
public site is Surge, and the README's deploy instructions were historical. Treat the Surge flow on this
page as the ground truth until the docs are reconciled.

## Verification tooling that already exists in the repo

As of 2026-11-03 the scripts directory `frontend/react/scripts/` contained:

- `check-card-layout.mjs` — Playwright measurement of the home card row. See
  [home-screen-layout.md](home-screen-layout.md) for what it reports and for the caveat about its pinned
  browser build.
- `deploy-surge.mjs` — being added on 2026-11-03 to handle publishing.
- `verify-deploy.mjs` — being added on 2026-11-03 to prove the live site matches a local build.

As of 2026-11-04, only `check-card-layout.mjs` was present in the tracked tree; the two deploy scripts
were still in preparation. Verify their existence in the tree before relying on them.

## Checklist for publishing

1. `git status` — confirm the working tree is clean and you know which commit you are shipping.
2. `cd frontend/react && npm run build`.
3. Run `node scripts/check-card-layout.mjs` against the built app if the change touched the home screen.
4. Record the SHA256 of the built asset bundle.
5. `surge dist fantasygrinder.surge.sh` — with a working Surge credential. See
   [credential-incident.md](credential-incident.md).
6. Fetch the live asset headers; confirm `ETag` equals the local SHA256 and read the `surge-stamp`.
7. Note the commit hash and the stamp in the next dated wiki entry.

See also [locations.md](locations.md) for where the build output sits on disk.
