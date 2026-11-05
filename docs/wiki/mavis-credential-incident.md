# The credential incident — 2026-10-31

This page exists because the failure was destructive, unrecoverable by the routes people tried first, and
likely to recur: a publish command that could not authenticate silently destroyed the stored credential.

## What happened

On **2026-10-31**, a `surge` publish attempt that **could not authenticate** rewrote the operator's
`~/.netrc` **down to 2 bytes** and destroyed the stored Surge token.

The mechanism, as recorded on 2026-10-31: the surge CLI wants to prompt for authentication. In a
non-interactive shell there is nobody to answer the prompt, the prompt is aborted, and the CLI's response
to an aborted authentication is to write out the (empty) credential file it holds. The 2-byte file is the
leftover of that write.

## Why it could not be undone

As recorded on 2026-10-31:

- The machine was **not elevated**, so the raw disk could not be read to carve the old file out.
- **No other copy of the token existed on disk.** There was no backup, no second machine, no CI copy.

So the stored credential was simply gone, and there was no recovery path from the filesystem.

## How it was recovered

On **2026-10-31** the credential was restored with:

```bash
surge login --browser
```

That command, as used on 2026-10-31:

1. prints a URL and a **short code**,
2. opens that URL in the default browser,
3. **polls** until the sign-in is approved,
4. then **writes a fresh token back into `~/.netrc`**.

This is the recovery path. It is interactive by design and it is the only path that worked here.

## Lessons that must survive this session

1. **Never run an unauthenticated `surge` publish in a non-interactive shell.** The CLI prompts; an
   aborted prompt rewrites `~/.netrc` and destroys the credential. Check that a credential exists before
   publishing, or publish from an interactive shell.
2. **To re-authenticate, run `surge login --browser`** — not a retry of the publish, and not a manual
   edit of `~/.netrc`.
3. **Keep the Surge token out of the repo and out of CI logs.** The token lives in the operator's
   `~/.netrc` and nowhere else. It is never committed, never written into a script, and never printed
   into a log or a wiki page.
4. **Treat `~/.netrc` as the only copy.** As of 2026-10-31 there was no backup of it anywhere on the
   machine, so its loss is total. Anything that can write to that file is a high-risk operation.

## Related

- [mavis-deployment.md](mavis-deployment.md) — the publish flow that triggered this, and how to verify a publish.
- [mavis-locations.md](mavis-locations.md) — where the operator's home-directory files live relative to the repos.
