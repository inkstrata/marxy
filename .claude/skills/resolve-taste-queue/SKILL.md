---
name: resolve-taste-queue
description: Walk the author through the open rows of the Marxy taste-review queue in a local browser UI, one row at a time with its screenshots, then write their verdicts into queue.md and a dated decisions.md. Use when asked to resolve, review, or walk through the taste queue.
---

# resolve-taste-queue

The human half of verification (ADR-0016). The queue is `docs/taste-review/queue.md` plus any
unfolded `docs/taste-review/queue.d/*.md` fragments. This skill runs a small local review app so
the author judges each row against its artifacts instead of reading paths in a terminal.

## Run it

```bash
node .claude/skills/resolve-taste-queue/server.mjs        # http://127.0.0.1:4747
```

Run it in the background, then open `http://127.0.0.1:4747` in the browser (Control Chrome first,
the in-app pane if Chrome is not running). Tell the author the URL and that the keys are on screen.
Options: `--port N`, `--root DIR` (review another checkout), `--keep` (don't exit after finishing).

## What the author sees

One row per screen: the key, what a reader would notice, the artifacts (PNGs inline, `before-`/`after-`
pairs that flip with <kbd>space</kbd>, click for a lightbox, source and fixture files expandable, corpus
`.md` pages with an "Open in Marxy" button), then the question for the reviewer pinned at the bottom.

| Key | Does |
| --- | --- |
| `1` `2` `3` `4` | Fine · Tune · Change · Defer (Fine advances; the others focus the note) |
| `d` | Accept the row's stated `(Default: …)` as Fine and advance |
| `n` / `Esc` / `Enter` | Focus the note / leave it / save it and advance |
| `←` `→` or `k` `j` | Previous / next row |
| `s` | Clear the verdict and skip |
| `f` | Review and write the decisions |

Progress autosaves to `~/.cache/marxy-taste-review/session.json`, so closing the tab or stopping the
server loses nothing; reopening resumes at the first undecided row.

## Finishing

`f` shows every verdict, then writes: it folds well-formed `queue.d` fragments into `queue.md`
(same as `node scripts/taste-queue.mjs --fold`), fills each decided row's Decision cell
(`**Fine.** note \`2026-10-review-N/decisions.md\``), and writes
`docs/taste-review/<YYYY-MM>-review-<N>/decisions.md`. Skipped rows stay open. The server then exits.

A fragment that is prose rather than one table row (today `C-12.md`) cannot be folded by the repo
script. The harness still shows it, records its verdict in `decisions.md` only, and leaves the file.

## After the author finishes

1. Read `git diff docs/taste-review/` and confirm it matches what they chose.
2. Tune and Change verdicts are follow-ups: list them for the author and offer to file stories; do
   not start them unprompted.
3. Commit on a feature branch off `origin/main` (never `main`), open a PR per `AGENTS.md`, and put
   the link in the final message. No attribution lines.

## Maintaining

`lib.mjs` has the parsing, artifact resolution and write-back; `ui.html` is the whole front end.
`node --test .claude/skills/resolve-taste-queue/test.mjs` runs `finish()` against a temp copy of the
real queue, so a format change in `scripts/lib/taste-queue.mjs` that breaks it shows up there.
