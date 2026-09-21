---
key: MARXY-37
design: [09-app-shell, 08-position-and-watching, 01-buffer]
depends: [MARXY-20, MARXY-75, MARXY-93]
verify: [pnpm precheck, pnpm done MARXY-37]
---
# MARXY-37 — Source mode module: CodeMirror 6 with per-file-type default and position-preserving switch

**Design:** [09-app-shell](../../design/09-app-shell.md) §Source mode, [08-position-and-watching](../../design/08-position-and-watching.md) §Mode switch, [01-buffer](../../design/01-buffer.md) `fromText` · **Depends on:** MARXY-20, MARXY-75, MARXY-93.

**Split 2026-09-21** (`docs/plan/deltas/2026-09-21-marxy-37-split.md`): PR #142 was CI-red because
`apps/desktop/package.json` (needed for the new `@codemirror/*` deps) was outside Paths. Widened
to add it, mirroring MARXY-86. This story stays the self-contained module — its own Playwright
harness (`harness-entry.ts`) proves every criterion below; nothing here mounts into `main.ts` or
`app.ts`. **MARXY-169** is the analogous view slice (compare MARXY-87): Mod+E,
the `#marxy-source` DOM node, and the real-app screenshot. Do not add app-shell wiring here.

## Do this, in order
1. Use `byteToUtf16`, `utf16ToByte` and `fromText` from `packages/core/src/buffer/` (MARXY-93). Do not create or edit files there; if a function is missing or wrong, stop and report `blocked`.
2. `apps/desktop/src/source/editor.ts`: the CM6 setup in §09 (dynamic import so it stays off the startup path), `lineSeparator` from the buffer's eol, language by extension (MIT packages only; add to the licence allow-list), 2 MB threshold.
3. Mode switch `Mod+E`: position mapping both ways (§08), selection mapping, the "unchanged → keep bytes" rule, `fromText` on edits with the `mixed → LF` notice, `history.push` one edit.
4. Per-file-type default on open; theme bridge mapping `--marxy-*` to CM6 theme.

## Tests
Unit: `.rs`/`.ts`/`.py`/`.css` → Source, `.md` → Rendered. Playwright: switch twice without editing → `buffer.bytes` identical (hash); edit one line in a CRLF fixture → every line ending in the result is CRLF; 9 MB file scrolls with no frame > 100 ms (envelope tier); position round-trip returns to the same block.
