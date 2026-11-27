# Hunt 03: big files, across every path

**Goal.** The owner's report (2026-11-27): "different aspects of the app failing or horribly slowing down when
working with big files (fundamentally not that big at 1–5 MB even)". Find every place where work grows faster
than the file, or where a 1–5 MB file (and the first sizes past the 5 MB lines threshold) makes the app freeze,
fail or slow badly; measure how each path scales; and turn the verified ones into tracker rows. Hunt 01's note
for the next hunt pointed here: long unbroken input is the richest seam.

Run beside a research corpus on the same question (`docs/research/large-files/` on `agent/large-files`), which
looks at best practice and at how comparable apps handle big files. This hunt finds what is wrong in Marxy.

**Out of scope, already known.** Hunt 01's rows (`briefs/known-rows-hunt-01.md`; B1 export as a web page, B2 a
backtracking pattern in Search, B3 a long unbroken run, B9 a 62,000-paragraph Word document) and hunt 02's
findings (`briefs/known-hunt-02.md`: the rail, drawer panels, Links, Metadata and Transforms panels, relayout on
a width change, a page busy for 15 s after a big open), both run by other sessions and not on `main` yet. Rows
already in `todo.md`: R13 (a 1 MB Markdown file takes about 78 s to open on Windows; never measured on macOS),
P11 and P12 (budgets for lines of text and containers), E22 (geometry table), E23 (near-typeset), R18, R19.

**Big files.** `probes/gen.mjs` makes every shape at any size, deterministic, so numbers from one domain compare
with another: Markdown prose, transcript, technical, dense blocks, references and footnotes, headings, tables,
code fences, one unbroken line; text; TypeScript; JSON pretty, minified and deep; CSV, CSV with quoted newlines;
JSON Lines; log; diff; HTML; YAML. Sizes: 0.5, 1, 2 and 4.9 MB (the biggest full page) and 5.1 MB (the
smallest lines reading).

## Domains

| Prefix | Catcher | Port | Aim |
| --- | --- | --- | --- |
| MEA | measurement | 1471 | the matrix: each shape at each size, opened and used (open, key, scroll, find, Source and back, an edit and undo, reload, save); where it grows faster than the file |
| RDR | read path | 1472 | parse, render, sanitise, progressive mount, typesetting, idle passes and incremental replace for 1–5 MB Markdown |
| EDT | edit, copy and save | 1473 | Source, splices and the offset map, undo history, paste, folding Source back, copy and export (not as a web page), save, live reload of a big file |
| NAV | find and place | 1474 | find on the page, the Line's `#` and `/`, the Search panel over one big file (not regex), the Outline at many headings, place keeping, split and tabs with big files, the warm store |
| VWR | readings and viewers | 1475 | JSON, CSV, JSON Lines, logs, lines reading around 5 MB, code colouring, diff, HTML, YAML, notebooks, archives, office and books, hex |
| SHL | shell and IPC | 1476 | reading, detecting, decoding and writing big files in Rust and across IPC; versions kept per save; watch and tail; the index and content search over big files |

## Counts

38 findings from six catchers, 38 verdicts from twelve verifiers (all Sonnet at medium effort), 19 bug rows (L1 to L19)
plus nine structural rows (L20 to L28) from the research corpus beside the hunt. Every outcome is in `triage.md`; the
account, the measurements and the order of the work are in `../../reports/2026-11-27-big-files.md`.

| Domain | Findings | Confirmed | Plausible | Not reproduced, duplicate, by design | Rows | S1 rows |
| --- | --- | --- | --- | --- | --- | --- |
| MEA (measurement) | 12 | 9 | 1 | 2 (MEA-01 is R13; MEA-12 headings at 0.5 MB) | 5 (L1, L3, L6, L10, L11) | 3 |
| EDT (edit, copy, save) | 8 | 8 | 0 | 0 | 5 (L9, L14, L16, L17, L18) | 0 |
| NAV (find and place) | 6 | 6 | 0 | 0 | 4 (L4, L5, L7, L8) | 2 |
| RDR (read path) | 5 | 3 | 0 | 2 (by design: a file with a definition is parsed whole) | 1 (L2), the rest merged into L1 | 1 |
| SHL (shell and IPC) | 5 | 5 | 0 | 0 | 2 (L13, L19) | 0 |
| VWR (readings, viewers) | 2 | 2 | 0 | 0 | 2 (L12, L15) | 0 |
| **All** | **38** | **33** | **1** | **4** | **19** | **6** |

L1 to L4, L6 and L12 to L14 were fixed by other branches before this landed (`triage.md`, "Fixed before the rows landed").

Most productive: measurement (the open cliff on every prose-like shape, and the plain-text cliff below the lines
threshold) and find and place (every finding confirmed, two S1). The read path's two whole-parse findings are the
documented design, which L24 changes. The shell's findings were all real and all small once timed in CPU.

**Severities came down in verification.** The catchers timed by the wall clock on a machine whose load average stood at 30
to 120 (other sessions ran verify and browser suites); the verifiers measured CPU or the browser's task time and found
wall time running 4 to 10 times higher. The open cliff (L1 to L3) held in CPU time; most S1s in editing and the shell
did not. Measuring in CPU time from the start is now in the verifier brief, and `docs/big-files.md` says why.

**The laptop slept** from 03:57 to 06:53 (battery at 1%); a verifier and a verify run were frozen in it and resumed.

**The lines threshold is 5 MiB** (5,242,880 bytes), not 5 MB: the generator's "5.1 MB" files were whole pages (MEA-11).
The docs now say 5 MiB (`agent/scale-guard`).

## For the next hunt

- Every number here is headless Chromium. WebKit, Marxy's engine on macOS, through `scripts/browser-tests.mjs`.
- Run the catchers' probes in CPU or task time from the start; a loaded machine makes the wall clock lie.
- `scripts/measure-scale.mjs` (from `agent/scale-guard`) is this hunt's matrix as a tool: start with it.
- Not reached: notebooks, archives, office documents and books at size; the Spine; reopening a big file after a restart.
