# block-cache: review (Opus)

**Verdict: ready after my fix.** `775e48dc` on `agent/block-cache`. Verify 11/11 on that tip (browser 489, unit-desktop 1256); tree clean.

## Bug fixed

Source asked the worker for the same fence forever. `BoundedCache.set` refuses an entry over a quarter of its character bound; a token entry costs about twice the code's length, so a fence over about 187K characters is never stored. Source now drew colour only from the shared store: each reply was refused, triggered a redraw, missed the store and was sent again, endlessly, with no colour. The old per-editor Source cache had no character bound and stored these. The fix keeps such runs in a small map inside the Source plugin (at most four entries). New test (200K-character fence, a stub counting requests) passes with the fix; on the builder's code the page spins until the 90 s timeout.

## Checked

- Sanitiser: neither KaTeX nor diagram output went through the sanitiser on master either; both libraries build markup from escaped text. The cache stores exactly what they made, each value a fixed result of its key (fixed KaTeX options, no shared macros; diagram text plus face). No new way around the sanitiser. A document cannot plant a value under another key; a diagram text containing the stand-in id prefix is never stored.
- Diagram ids come from one counter shared by all panes: never shared. Builder's test checks it.
- Settings and theme: tokens carry scope names, not colours; diagram markup has no inline colour and the face is in its key; math on/off only decides whether placeholders exist.
- Read and Source colour: same key, worker job and `runsFromTokens`: identical to master.
- LRU bounds exercised in Node: entry bound, character bound, oversize refusal hold. No DOM nodes held.
- Same final HTML: the builder's test asserts cached first write equals the uncached two-write path.

## Mutation

All three lookups disabled: code, formula and diagram tests each fail. typecheck, lint, check pass.

## To file

- A diagram measured before its font loads keeps those widths while cached.
- Source's lazily built `runs` are not counted in the character bound.
