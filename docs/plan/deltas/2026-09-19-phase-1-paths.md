# Plan delta — 2026-09-19 (Phase 1 paths match their task cards)

> Out-of-cadence planner correction, written while implementing MARXY-20 at Ian's request.

## What was wrong

The CSV is the spec the story-boundary hook enforces; the task cards are what an implementor is
told to do. For three Phase 1 stories they disagreed, so following the card was refused by the hook:

| Key | CSV Paths | What the card says to edit |
| --- | --- | --- |
| MARXY-20 | `packages/theme` | also `packages/typeset/src/grid.ts`, `apps/desktop/index.html`, `vite.config.ts`, `main.ts` |
| MARXY-21 | `fonts, apps/desktop/src/fonts, packages/theme` | also `index.html`, `main.ts`, `src/shell/tauri.ts`, `commands/os.rs`, `src/theme/offset.ts`, `THIRD_PARTY_NOTICES.md` |
| MARXY-23 | `packages/typeset` | the app has to call `attach()` after render, in `main.ts` |

## Decision

Widen the three rows to the card's files, plus the docs each story's design changes land in
(`docs/design`, `docs/adr`) and its own taste-review folder. No other row changes. `apps/desktop/src/main.ts`
now appears in three rows; they are sequential (21 depends on 20, 23 on 20), so the occupancy rule
serialises them, which is the intent.

## How we would know I was wrong

A later story's card names a file its row does not. Then the fix is this delta's again: the card
and the row are written together or not at all.
