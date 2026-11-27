# source-return: review (Opus)

**Verdict: ready after my fix.** Tip `d2b3b887`, tree clean. Verify turn on that tip 10/10 (browser 74, unit-desktop 1258). typecheck, lint, check pass.

## Bug fixed (`25d1e883`)

Changing text size, light/dark variant, theme, typesetting or measure while Source showed did not mark the page stale: `relayoutKeepingReader` returned early in Source. Before this branch a commit made while hidden forced a whole render that covered it; with the splice, old paragraphs stayed set in the old size or face, and turning typesetting off left them set (the test sees this). A settings change with no commit was already wrong before the branch. Source mode now marks the page stale for a whole render. `repaint` now passes on `wholeBecause` (rename, "bytes are unchanged") instead of always marking bytes-only. `docs/architecture.md` updated (`d2b3b887`).

## Tests added (`splice-all.test.mjs`)

- Behind Source, in the app: three commits then three undos back to the first bytes (spliced, every top-level node kept); a commit above the reader (cursor, find count and current match unchanged); a rename (whole render); typesetting off (whole render, no paragraph left set).
- Chain test spliced only every 4 steps (commits, undos, redos; 6 seeds x 16 steps): byte for byte equal to a whole render, no mismatches.

## Mutations

- Removing the relayout fix: the typesetting case fails.
- Reverting the `repaint` change: the rename case still passes (a rename while hidden is set whole by another path, not traced; possibly a per-file trust rerender). That part is defensive, not proven by a test.

## Checked by reading

Trust grants, transcripts, a file that opened in Source, switching file or tab (`show` clears the page) all end in a whole render. A reload while hidden is a byte change the splice handles. Pane width is handled by the article's resize observer when Read shows again. Nothing replaces the hidden page's content while Source shows: the mount's pending chunks go to the splice; idle passes change content only inside blocks.

## To file

- Two edits far apart still replace everything between (one cut).
- Measuring tool lacks a "Source to Read after an edit" scenario.
- No `TaskDuration` numbers taken.

## Orchestrator notes

The bug fixed also existed on master for a settings change made while Source showed with no commit (Read came back in the old size or face). Worth telling Ian as a fixed pre-existing bug.

## Integration red, settled (same reviewer)

`mode-swap` "while Source shows, a reload from disk..." was case (a): the test expected a whole render on return. `wrappedMd` is 68,330 bytes, over the 64 KB floor, so the splice is allowed; nothing bypasses the floor. Only the changed `h1` is replaced. Test changed (`89a747c4`): `staleCase` takes a `replaced` selector; for the reload case the changed block has no old element and exactly one top-level block is new, the rest kept. The hidden-article-untouched, content, typeset and not-dirty checks are kept; theme and trust cases still require no old node. Mutation: removing the reload's stale mark fails the test. `mode-swap` + `splice-all` 34/34.
