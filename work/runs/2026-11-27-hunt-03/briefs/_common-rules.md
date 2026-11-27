**Already known — skip.** Anything in `work/todo.md` (R13, P11, P12, E22, E23, R18, R19 are about big files),
hunt 01's rows in `work/runs/2026-11-27-hunt-03/briefs/known-rows-hunt-01.md` (B1 export as a web page, B2 a
backtracking Search pattern, B3 one long unbroken run, B9 a huge Word document's `append(...)`), and hunt 02's
findings in `work/runs/2026-11-27-hunt-03/briefs/known-hunt-02.md` (rail, drawer panels, Links, Metadata and
Transforms panels, relayout on a width change, the page busy after a big open). New evidence for one of those is a
finding that says "Adds to todo row <id>" or "Adds to hunt-02 <id>"; a *different* place with the same pattern is
a new finding.

**What to look for**, in order of what hurts a reader most:
1. Freezes: work on the main thread that grows with the file and never yields — a loop over every block, line,
   heading or match; work that runs again in full for a small change (a keystroke, a scroll, a panel, a hover);
   an `await` that waits for a whole-page pass before answering a key.
2. Growth faster than the file (O(n²)): a scan of the whole document or page per item (`indexOf`, `slice`,
   `querySelectorAll`, `closest`, `getBoundingClientRect`, `Range` per block), `Array.shift`/`splice`/`concat`
   in a loop, string building by repeated `+=` over parts, sorting inside a loop, a re-parse of the whole file
   for a feature that needs one part of it.
3. Failures on size: spreading an unbounded array into a call (`push(...xs)`, `append(...nodes)`,
   `Math.max(...xs)`, `String.fromCharCode(...)`: stack overflow), recursion as deep as the input nests,
   a string or array past the engine's limits, a worker message that clones the whole text on every change.
4. Memory that grows with the file several times over (the bytes, the text, the tree, an HTML string, the DOM,
   an offset map, undo, a warm copy) or keeps growing with use (history, caches with no bound).
5. Thresholds: what changes at the 5 MB lines line (4.9 MB vs 5.1 MB), at the footnote/definition rule (a file
   that may hold a definition is parsed whole), at each documented limit in `docs/file-kinds.md` ("Size limits").

**How to measure.** Use `work/runs/2026-11-27-hunt-03/probes/gen.mjs` for files (`bigFile(kind, bytes)`; kinds
listed in it). **A doubling test is the core probe:** take the same action at 1 MB and 2 MB (and 4.9 MB where it
matters); time per doubling over about 2.5× is super-linear and a finding even if each time is small. Race every
`page.evaluate`, key press and wait against a 10 s timer and print which step stalled. Six catchers share this
Mac (Apple silicon, macOS 26), so prefer the browser's own counts — Chromium's `Performance.getMetrics` through
CDP (`TaskDuration`, `ScriptDuration`, `LayoutCount`, `LayoutDuration`, `RecalcStyleCount`, `Nodes`; see how
`scripts/measure-interactions.mjs` reads them) — and ratios taken in one run, over raw wall times; re-run any
surprising number once. Run long probes under `caffeinate -i` (this laptop's sleep freezes processes and fakes
hangs). WebKit is the engine on macOS: when a finding may differ there, try it through
`node scripts/browser-tests.mjs` with a probe test copied in and removed straight after, or say it was Chromium only.

**Severity for this hunt** (in the finding's Severity line, with one word after it): `S1` a freeze of 5 s or more
or one that never ends, a crash or a file that fails to open or shows wrong content; `S2` a stall of 1–5 s on one
action, or work that grows faster than the file; `S3` 200 ms–1 s on one action that should be instant. Put the
sizes and numbers in the title or the Actual line ("1 MB: 0.4 s, 2 MB: 1.7 s, 4.9 MB: 11 s").
