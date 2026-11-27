# MEA matrix: how each shape scales with size (hunt 03, macOS, headless Chromium)

Run with `node probes/MEA/matrix.mjs --sizes 1m,2m,4.9m --kinds md-prose,txt --out <file>.json` from the worktree root
(then `node probes/MEA/tomd.mjs *.json` for this table). Each row plants the file in the memory shell and takes: open
(first text; busy until idle = wall time until the main thread was quiet for three 300 ms polls; task seconds from
`Performance.getMetrics`; longest task; nodes), then the task seconds of a cursor key `j` (median of 5), scroll to the middle and to
the end, to Source and back, a one-paragraph edit and its undo (Markdown with a top-level paragraph only), a line appended on disk
with a `modified` event (reload), and find of "the". Every step waits for quiet, so wall time carries about 1 s of floor; compare task seconds.

**Read first.** Six catchers shared this laptop, so times carry noise; counts (layouts, nodes) and task seconds from the
browser are the numbers to compare. `!` means the thread was still busy at the 120 s cap, so the real figure is higher.
`STALLED` or `ERR` means `contentComplete()` or the step did not finish in 120 s. Cut sizes: 2 MB and 4.9 MB Markdown were not run for
shapes other than prose (a 2 MB prose open takes over 3 minutes: 188 s task, never quiet; its other steps are in md-prose.json);
the 1 MB and 0.5 MB steps of the other Markdown shapes ran. The lines line is `LINES_FROM = 5 MiB` (5,242,880 bytes), so the brief's 5.1 MB is still a full page;
5.3 MB is the lines reading (txt-5300k, log-5300k). 2 MB and 4.9 MB Markdown prose: the 4.9 MB run was stopped after 2 MB (the open alone would take over 10 minutes).
Not run: the `md-technical`, `md-dense` and `md-headings` steps after the open at 0.5/1 MB when the open stalled; text, TypeScript, HTML, CSV and JSON at 2 MB.

| shape | MB | first text s | open busy s | open task s | longest s | nodes | key | scroll mid | scroll end | to Source | to Read | edit | undo | reload | find (task s) | find longest s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| md-prose | 0.50 | 0.57 | 14.8 | 13.0 | 0.59 | 47314 | 0.18 | 0.04 | 0.05 | 1.29 | 0.37 | 1.65 | 1.00 | 1.06 | 0.83 | 0.29 |
| md-prose | 1.00 | 1.11 | 62.3 | 59.7 | 1.12 | 86954 | 0.18 | 0.19 | 0.18 | 2.49 | 0.80 | 3.06 | 2.10 | 1.99 | 1.71 | 0.70 |
| md-prose | 2.01 | 2.57 | 188.1! | 185.6 | 0.21 | 118842 | 0.77 | 0.63 | 0.59 | 4.87 | 1.51 | 5.87 | 4.16 | 4.24 | 3.33 | 1.39 |
| md-transcript | 0.50 | 0.68 | 34.8 | 27.9 | 0.69 | 50389 | 0.20 | 0.15 | 0.15 | 1.68 | 0.88 | 3.85 | 3.32 | 2.60 | 1.13 | 0.44 |
| md-transcript | 1.00 | STALLED >120000ms at open | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| md-technical | 0.51 | 0.84 | 82.9 | 76.2 | 0.86 | 53893 | 0.08 | 0.42 | 0.75 | 2.56 | 2.11 | 3.23 | 1.72 | 1.36 | 1.92 | 0.62 |
| md-technical | 1.02 | STALLED >120000ms at open | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| md-dense | 0.50 | STALLED >120000ms at open | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| md-dense | 1.00 | STALLED >120000ms at open | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| md-references | 0.50 | 0.83 | 18.2 | 16.7 | 0.84 | 50418 | 0.11 | 0.06 | 0.67 | 1.75 | 0.67 | 3.05 | 1.72 | 2.33 | 1.23 | 0.49 |
| md-references | 1.00 | 1.70 | 123.0! | 121.3 | 1.71 | 81651 | 0.48 | 0.07 | 0.07 | 3.17 | 1.27 | 6.60 | 4.89 | 5.76 | 3.04 | 1.05 |
| md-headings | 0.50 | STALLED >120000ms at open | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| md-headings | 1.00 | STALLED >120000ms at open | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| md-tables | 0.50 | 1.46 | 4.7 | 3.5 | 1.46 | 171986 | 0.06 | 0.14 | 0.12 | 1.09 | 0.88 | - | - | 1.15 | 1.72 | 0.83 |
| md-tables | 1.00 | 2.31 | 11.2 | 10.1 | 2.31 | 339170 | 0.05 | 0.35 | 0.34 | 2.08 | 1.85 | - | - | 1.93 | 2.92 | 1.38 |
| md-code-fences | 0.50 | 0.13 | 1.6 | 0.4 | 0.13 | 8598 | 0.01 | 0.04 | 0.02 | 0.27 | 0.41 | 0.39 | 0.24 | 0.24 | 0.23 | 0.07 |
| md-code-fences | 1.00 | 0.31 | 2.1 | 0.9 | 0.31 | 9670 | 0.03 | 0.04 | 0.03 | 0.52 | 0.82 | 0.80 | 0.53 | 0.52 | 0.36 | 0.11 |
| txt | 1.0 | FATAL: page.goto: Timeout 30000ms exceeded. |
| txt | 1.00 | 0.12 | 4.4 | 3.2 | 1.17 | 76752 | 0.12 | 0.01 | 0.01 | 1.83 | 0.72 | - | - | 5.78 | 1.40 | 0.66 |
| txt | 4.90 | 0.42 | 107.7 | 106.0 | 7.86 | 371202 | 1.01 | 0.81 | 0.21 | 2.57 | 6.72 | - | - | 134.13! | 10.77 | 3.71 |
| txt | 5.10 | 0.48 | 84.3 | 82.8 | 5.30 | 386303 | 0.15 | 0.06 | 0.02 | 1.41 | 3.90 | - | - | 120.95 | 10.12 | 3.38 |
| txt | 5.30 | 0.09 | 1.0 | 0.1 | - | 3154 | 0.00 | 0.01 | 0.01 | 0.11 | 0.07 | - | - | 0.21 | 0.19 | 0.00 |
| code-ts | 1.01 | 0.14 | 1.5 | 0.2 | 0.15 | 3437 | 0.11 | 0.11 | 0.05 | 1.11 | 0.32 | - | - | 0.44 | 0.62 | 0.26 |
| code-ts | 4.91 | 0.07 | 1.8 | 0.4 | 0.09 | 5234 | 0.01 | 0.00 | 0.07 | 0.95 | 0.16 | - | - | 0.58 | 0.30 | 0.07 |
| json-pretty | 1.00 | 0.29 | 3.1 | 1.9 | 1.63 | 52364 | 0.07 | 0.03 | 0.06 | 0.83 | 1.89 | - | - | 121.30! | 93.16 | 3.68 |
| json-pretty | 4.90 | 0.07 | 3.2 | 2.0 | 1.24 | 51687 | 0.04 | 0.02 | 0.01 | 0.44 | 1.52 | - | - | 60.48 | 1.00 | 0.27 |
| json-minified | 1.00 | 0.24 | 2.4 | 1.3 | 1.06 | 48277 | 0.04 | 0.01 | 0.01 | 0.49 | 0.90 | - | - | 0.64 | 0.21 | 0.00 |
| json-minified | 4.90 | 0.10 | 2.1 | 1.2 | 0.66 | 48305 | 0.03 | 0.03 | 0.01 | 0.15 | 0.80 | - | - | 1.79 | 0.19 | 0.06 |
| csv | 1.00 | 0.15 | 1.2 | 0.2 | 0.15 | 8286 | 0.01 | 0.03 | 0.02 | 0.20 | 0.06 | - | - | 0.34 | 0.21 | 0.00 |
| csv | 4.90 | 0.08 | 1.3 | 0.3 | - | 8323 | 0.02 | 0.04 | 0.13 | 0.20 | 0.11 | - | - | 0.57 | 0.36 | 0.00 |
| jsonl | 1.00 | 0.07 | 1.2 | 0.2 | 0.08 | 5695 | 0.01 | 0.03 | 0.02 | 0.48 | 0.06 | - | - | 0.26 | 0.19 | 0.00 |
| jsonl | 4.90 | 0.08 | 1.4 | 0.3 | - | 5735 | 0.01 | 0.05 | 0.01 | 0.17 | 0.17 | - | - | 0.60 | 0.39 | 0.00 |
| log | 1.00 | 0.06 | 1.8 | 0.2 | 0.06 | 7583 | 0.01 | 0.09 | 0.09 | 0.25 | 0.07 | - | - | 0.27 | 0.34 | 0.11 |
| log | 4.90 | 0.08 | 2.4 | 0.5 | - | 8252 | 0.03 | 0.12 | 0.10 | 0.20 | 0.12 | - | - | 0.37 | 0.36 | 0.15 |
| log | 5.10 | 0.09 | 2.4 | 0.5 | - | 8299 | 0.02 | 0.17 | 0.14 | 0.26 | 0.17 | - | - | 0.63 | 0.63 | 0.24 |
| log | 5.30 | 0.05 | 1.0 | 0.1 | - | 3248 | 0.00 | 0.01 | 0.01 | 0.12 | 0.07 | - | - | 0.22 | 0.19 | 0.00 |
| diff | 1.00 | 0.05 | 1.5 | 0.2 | 0.06 | 5863 | 0.01 | 0.08 | 0.05 | 0.16 | 0.15 | - | - | 0.26 | 0.25 | 0.09 |
| diff | 4.90 | 0.10 | 9.9 | 8.5 | 0.07 | 5770 | 0.04 | 0.13 | 0.52 | 0.33 | 0.63 | - | - | 0.75 | 0.43 | 0.19 |
| html | 1.00 | 0.22 | 2.7 | 0.7 | 0.22 | 95399 | 0.01 | 0.00 | 0.00 | 0.49 | 0.22 | - | - | 0.63 | 0.04 | 0.00 |
| html | 4.90 | 0.89 | 4.4 | 3.4 | 0.88 | 230050 | 0.01 | 0.00 | 0.00 | 0.57 | 2.95 | - | - | 5.30 | 0.07 | 0.00 |

Growth per size step (ratio of task seconds; open uses busy-until-idle seconds), by shape. Above 2.5 per doubling is super-linear.

| shape | step | open | key | scroll mid | to Source | to Read | edit | undo | reload | find |
|---|---|---|---|---|---|---|---|---|---|---|
| md-prose | 0.5 to 1.0 MB (x2.0) | 4.2 | 1.0 | 5.4 | 1.9 | 2.2 | 1.9 | 2.1 | 1.9 | 2.1 |
| md-prose | 1.0 to 2.0 MB (x2.0) | 3.0 | 4.2 | 3.3 | 2.0 | 1.9 | 1.9 | 2.0 | 2.1 | 1.9 |
| md-transcript | 0.5 to 1.0 MB (x2.0) | - | - | - | - | - | - | - | - | - |
| md-technical | 0.5 to 1.0 MB (x2.0) | - | - | - | - | - | - | - | - | - |
| md-dense | 0.5 to 1.0 MB (x2.0) | - | - | - | - | - | - | - | - | - |
| md-references | 0.5 to 1.0 MB (x2.0) | 6.8 | 4.5 | 1.2 | 1.8 | 1.9 | 2.2 | 2.8 | 2.5 | 2.5 |
| md-headings | 0.5 to 1.0 MB (x2.0) | - | - | - | - | - | - | - | - | - |
| md-tables | 0.5 to 1.0 MB (x2.0) | 2.4 | 0.9 | 2.5 | 1.9 | 2.1 | - | - | 1.7 | 1.7 |
| md-code-fences | 0.5 to 1.0 MB (x2.0) | 1.4 | 2.1 | 0.9 | 1.9 | 2.0 | 2.1 | 2.2 | 2.2 | 1.6 |
| txt | 1.0 to 4.9 MB (x4.9) | 24.3 | 8.4 | 73.2 | 1.4 | 9.4 | - | - | 23.2 | 7.7 |
| txt | 4.9 to 5.1 MB (x1.0) | 0.8 | 0.1 | 0.1 | 0.5 | 0.6 | - | - | 0.9 | 0.9 |
| txt | 5.1 to 5.3 MB (x1.0) | 0.0 | 0.0 | 0.2 | 0.1 | 0.0 | - | - | 0.0 | 0.0 |
| code-ts | 1.0 to 4.9 MB (x4.9) | 1.1 | 0.1 | 0.0 | 0.9 | 0.5 | - | - | 1.3 | 0.5 |
| json-pretty | 1.0 to 4.9 MB (x4.9) | 1.1 | 0.5 | 0.7 | 0.5 | 0.8 | - | - | 0.5 | 0.0 |
| json-minified | 1.0 to 4.9 MB (x4.9) | 0.9 | 0.7 | 1.9 | 0.3 | 0.9 | - | - | 2.8 | 0.9 |
| csv | 1.0 to 4.9 MB (x4.9) | 1.2 | 1.7 | 1.3 | 1.0 | 1.8 | - | - | 1.7 | 1.7 |
| jsonl | 1.0 to 4.9 MB (x4.9) | 1.2 | 2.1 | 1.5 | 0.3 | 2.9 | - | - | 2.3 | 2.0 |
| log | 1.0 to 4.9 MB (x4.9) | 1.4 | 1.8 | 1.3 | 0.8 | 1.7 | - | - | 1.4 | 1.1 |
| log | 4.9 to 5.1 MB (x1.0) | 1.0 | 0.9 | 1.4 | 1.3 | 1.4 | - | - | 1.7 | 1.8 |
| log | 5.1 to 5.3 MB (x1.0) | 0.4 | 0.2 | 0.1 | 0.5 | 0.4 | - | - | 0.3 | 0.3 |
| diff | 1.0 to 4.9 MB (x4.9) | 6.8 | 4.1 | 1.7 | 2.1 | 4.3 | - | - | 2.9 | 1.7 |
| html | 1.0 to 4.9 MB (x4.9) | 1.7 | 0.8 | 1.0 | 1.2 | 13.2 | - | - | 8.5 | 1.5 |
