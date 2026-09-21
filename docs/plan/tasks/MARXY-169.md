---
key: MARXY-169
design: [09-app-shell, 08-position-and-watching]
depends: [MARXY-37, MARXY-95]
verify: [pnpm precheck, pnpm done MARXY-169]
---
# MARXY-169 — Mount Source mode from the app shell: Mod+E toggle and per-file-type default in the real DOM

**Design:** [09-app-shell](../../design/09-app-shell.md) §Source mode, §Keyboard table (`Mod+E`) ·
[08-position-and-watching](../../design/08-position-and-watching.md) §Mode switch ·
**Depends on:** MARXY-37 (the module), MARXY-95 (`startApp` split).

**Split 2026-09-21** (`docs/plan/deltas/2026-09-21-marxy-37-split.md`). MARXY-37's own PR #142
body named this the follow-on ("App shell wiring (Mod+E) is a follow-on"), and
`apps/desktop/index.html` today is only `<article id="doc">` — there is no `#marxy-source` node
and no keybinding dispatcher anywhere in `app.ts` or `main.ts`. This is the analogous vertical
slice to MARXY-87 (palette view mounted from `main.ts`, asserted against the real document): the
part that makes a reader able to actually reach Source mode, not just a module that proves its
own logic in a standalone harness.

**Reuse, do not re-implement:** `defaultModeForPath`, `createSourceEditor`, `leaveSourceMode`,
`modeRoundTripWithoutEdits`, `scrollSourceToByte` — all exported from
`apps/desktop/src/source/index.ts` by MARXY-37.

## Files and signatures
- `apps/desktop/index.html` — add `<div id="marxy-source" hidden></div>` beside `#doc` (§09 DOM skeleton).
- `apps/desktop/src/app.ts` — a small keydown dispatcher (the first one in this file; MARXY-87
  will want the same seam for `Mod+P` — whichever lands first should leave something the other
  can add a case to, not a competing listener) with one case, `Mod+E`: hide/show `#doc` and
  `#marxy-source`, lazily create the CM6 editor via `createSourceEditor` on first switch and keep
  it, fold Source edits back with `leaveSourceMode` before returning to Rendered, map the reading
  position both ways with `scrollSourceToByte` / `sourceVisibleByteOffset`. Also call
  `defaultModeForPath` once on open so a `.rs`/`.ts`/`.py`/`.css` file starts in Source and `.md`
  starts in Rendered.
- `apps/desktop/src/main.ts` — no change expected; wiring lives in `app.ts`'s `startApp`. If a
  call site is needed, add it here rather than duplicating `startApp`.
- `apps/desktop/test/source-mode-shell.test.mjs` — boots the real app the way
  `apps/desktop/test/images.test.mjs`'s `boot()` does (vite build, static serve,
  `window.marxyApp.start`), then drives `Mod+E` and the default-mode-on-open case against
  `document`.
- `docs/taste-review/queue.md` — one new row, screenshot of Source mode mounted by the real app.

## Do this, in order
1. `index.html`: the mount point.
2. `app.ts`: default mode on open (`defaultModeForPath`); the keydown dispatcher with the `Mod+E`
   case; lazy CM6 creation and teardown-free reuse on repeat toggles.
3. Position mapping both ways through the module's own functions — do not reimplement byte↔UTF-16
   mapping here.
4. `source-mode-shell.test.mjs` against the real booted app.
5. Screenshot + queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| open `fixtures/corpus/04-source.rs` through the real app | `#marxy-source` visible, `#doc` hidden |
| open `fixtures/corpus/01-long-technical.md` through the real app | `#doc` visible, `#marxy-source` hidden |
| `Mod+E` twice, no edits | `buffer.bytes` hash unchanged; visible reading position unchanged |
| `startup-deferral`-style check after wiring lands | `@codemirror/*` still absent from the startup bundle until the first `Mod+E` |

## Acceptance → check
CSV criteria 1–3 → `source-mode-shell.test.mjs`; criterion 4 → `docs/taste-review/queue.md` row;
criterion 5 → CHANGELOG.md.

## Do not
Reimplement any function MARXY-37 already exports. Put CM6 on the startup import graph. Build a
second keydown dispatcher if MARXY-87 already added one — extend it.
