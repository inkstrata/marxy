# Changelog fragments

Nearly every pull request used to add a line to the same spot in `CHANGELOG.md`, so almost
every merge put every other open PR in conflict there. One file per story cannot conflict.

## The rule

Your story's changelog entry is a file named after its key: `changelog.d/MARXY-123.md`. The
file holds exactly **one line**, written for a reader of Marxy, ending in `(MARXY-123)` — the
same sentence that used to go under `CHANGELOG.md`'s `## Unreleased` heading.

```
Copying a code block keeps the source's own newline instead of always appending one (MARXY-230)
```

Do not add a heading, a bullet marker, or more than one line. Do not touch anyone else's
fragment, and do not touch `CHANGELOG.md` itself — `scripts/changelog.mjs --release` is the only
thing that writes to it.

During the transition, a `CHANGELOG.md` line under `Unreleased` still counts as an entry, so a
pull request already in flight before this change keeps passing. New work uses a fragment.

## At release

`node scripts/changelog.mjs --release X.Y.Z` folds every fragment in this directory into
`CHANGELOG.md` under a new `X.Y.Z` heading, in key order, and deletes the fragments it folded
in. It touches no other byte of `CHANGELOG.md`.

## The shared helper

`scripts/lib/changelog.mjs` is the one place that knows what counts as an entry
(`hasEntry`, `fragmentPath`, `validFragment`, `isFragmentPath`) — every gate and script that
checks for a changelog entry calls it, so they cannot disagree.
