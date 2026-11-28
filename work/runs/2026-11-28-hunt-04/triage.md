# Hunt 04: triage

Every finding of round 1 has one verdict. Rows are in `work/todo.md` (B23 to B35). Severity is the verifier's.

| Id | Title | Catcher | Verdict | Outcome |
| --- | --- | --- | --- | --- |
| AUTO-01 | The weekly clean deletes untracked work under dist, target, node_modules or .venv without archiving it | S2 | CONFIRMED S2 | B25 |
| AUTO-02 | An owner comment that quotes marker text is ignored by the plan gate | S2 | CONFIRMED S3 (was S2) | merged into B26 |
| AUTO-03 | A review marker with no run or model counts as an independent approval | S2 | CONFIRMED S2 | B26 |
| AUTO-04 | A same-second `changes` verdict is ignored; `marxy-review-foo` parses as a review | S3 | CONFIRMED S3 | merged into B26 |
| AUTO-05 | Presence fails open when a probe errors or times out | S3 | CONFIRMED S3 | B32 |
| CAP-01 | A book's Outline silently stops at 5,000 entries or 8 levels | S3 | CONFIRMED S3 | B33 |
| CAP-02 | Find in a Word or book page with tens of thousands of matches throws | S2 | CONFIRMED S2 | B30 |
| CAP-03 | "1 more are left out" in the Word and RTF cap sentences | S3 | CONFIRMED S3 | merged into B34 |
| CAP-04 | A mail that stops indexing dash lines loses every later part but names one | S3 | CONFIRMED S3 (wording only) | merged into B34 |
| DIF-01 | Large Markdown is never parsed in the worker | S2 | DUPLICATE of WRK-01 | follows WRK-01 (B23) |
| DIF-02 | `verify --tier changed` on the open path skips every large-parse test | S3 | CONFIRMED S3 | merged into B23 |
| DIF-03 | A 2 MB plain .txt holds the page 570 to 610 ms; `plain-text-large` fails | S3 | CONFIRMED S3 (not bisected, may be load) | B35 |
| ENC-01 | In a single-byte or UTF-16 file past 4 KB a file byte maps to the wrong character | S2 | CONFIRMED S2 | B24 |
| ENC-02 | A byte invalid in Shift_JIS or GBK swallows the ASCII after it | S3 | CONFIRMED S3 | B31 |
| FND-01 | Select all then Copy as Markdown on a page still mounting copies only the drawn part | S2 | CONFIRMED S2 | B27 |
| FND-02 | Find counts a formula's TeX source while mounting, then keeps the stale count | S2 | CONFIRMED S2 | B28 |
| FND-03 | Find counts the elided tail of a very long code line | S2 | CONFIRMED S2 | merged into B28 |
| FND-04 | Find never matches a phrase across a soft line break | S2 | CONFIRMED S2 | B29 |
| WRK-01 | The Markdown parse worker never starts in the browser build | S2 | CONFIRMED S2 | B23 |

No S1 finding; no row under "To try in a real window".

Two claims were not carried into rows: the catcher's `extzephyr` copy difference under FND-02 (a probe wrote a tab in a JS string), and AUTO-03's claim that a commenter other than the contributor can post a counted marker (PLAUSIBLE; the row asks for the author to be kept and checked).

## Not reached by any catcher

- The real window and WebKit (nothing here ran in either); the built release of the parse worker.
- Rust `decode_mapped` (read, not run), the encoding write and save path, `document/encoding.ts`, UTF-32, a table map across a 64-record group boundary.
- `attribution` in `scripts/auto/lib/state.mjs`, a status `ERROR` in the check rollup, the 100-comment limit on `gh pr list`, `stale-run.mjs` folder archiving, `dashboard.mjs`.
- A kept find match across a remake from disk while mounting; window and Range staleness as idle chunks mount; `rows`, `lines` and PDF viewers in find; the cost per scroll of `ensureWindow` on a 5 MB page.
- The slide and comment positions (#803), whether Source or hex still holds every byte past a cap, `shell/tauri.ts` against `memory.ts`.
- Axes TWO, SCH, PRS and WKT of `axes.md` were not run.
