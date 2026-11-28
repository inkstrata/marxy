# Scale measurement on Windows (Chromium)

2026-11-27, branch `scale-measure`, from `origin/main` 933316ab. Input to the windowed-pages work: the Windows half of
the numbers `work/reports/2026-11-27-big-files.md` took on a loaded Mac. The owner has made windowing the architecture
for Markdown pages; a research corpus on another machine (`docs/research/windowed-pages/`) measures tier 1 and the node
budget on Mac WebKit and Chromium. This is its Windows input.

Machine: Windows 11, i9-10900K (20 threads), 32 GB, Playwright Chromium 153 headless, `scripts/measure-scale.mjs` over
the in-memory shell, 1440x900. Other builders used the machine during the session; load was not logged. Figures are the
browser's main-thread task time in ms until the page has been quiet for about a second; `+` means still busy at the cap
(120 s), so the real figure is higher. Raw JSON and logs are in `raw/`.

**Not done:** WebKit (section 5), Edge, memory, the real WebView2 window, repeats on a quiet machine. The matrix was cut
short to stay near the time budget. The Markdown transcript, text, JSON, CSV and log tables overlapped other runs of
mine and are indicative only.

## 1. Node count against task time (Markdown prose; clean, run alone, one run per size)

| Size | Nodes after open | Open (task ms) | Key | toSource | toRead | Find |
| --- | --- | --- | --- | --- | --- | --- |
| 0.25 MB | 24,554 | 1,478 | 13 | 502 | 156 | 405 |
| 0.5 MB | 45,472 | 5,290 | 23 | 903 | 295 | 662 |
| 1.0 MB | 80,915 | 30,350 | 43 | 1,422 | 571 | 2,972 |
| 2.0 MB | 87,898 at the cap (still mounting) | 125,613+ | 121 | 3,479 | 1,660 | 2,990 |
| 4.0 MB | 159,547 at the cap (still mounting) | 123,739+ | 116,762+ | 7,106 | 119,195+ | 26,005 |

Reading it:

- Open grows 3.6x, then 5.7x per doubling of the file while nodes grow about 1.8x: the cost is not per node, it is the
  per-chunk whole-article work still in the mount. About 25k nodes opens in 1.5 s, 45k in 5 s, 81k in 30 s.
- Once the page is quiet, an interaction costs about linearly in nodes: a cursor key 13, 23, 43 ms at 25k, 45k, 81k nodes
  (about 0.5 ms per 1,000 nodes); Source and back 0.5 to 1.4 s at those sizes.
- From 2 MB the page never settles inside 120 s. At 4 MB a cursor key, a scroll and Read-from-Source each stall for the
  whole cap, and an edit and undo took 233 s. Open's growth of 1.0 at 4 MB is the cap, not linearity.
- Switching to Source is mild (7 s at 4 MB); the open cliff is the whole story for Markdown pages.

All nine steps, as the script prints them (growth per doubling in brackets, `!` over 2.5):

| size | open | key | scrollMid | scrollEnd | toSource | toRead | editUndo | reload | find |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.3 MB | 1478 | 13 | 9 | 8 | 502 | 156 | 1064 | 351 | 405 |
| 0.5 MB | 5290 (3.6 !) | 23 (1.8) | 13 (1.4) | 12 (1.5) | 903 (1.8) | 295 (1.9) | 2133 (2.0) | 657 (1.9) | 662 (1.6) |
| 1.0 MB | 30350 (5.7 !) | 43 (1.9) | 24 (1.8) | 26 (2.2) | 1422 (1.6) | 571 (1.9) | 3625 (1.7) | 2230 (3.4 !) | 2972 (4.5 !) |
| 2.0 MB | 125613+ (4.1 !) | 121 (2.8 !) | 71 (3.0 !) | 628 (24.2 !) | 3479 (2.4) | 1660 (2.9 !) | 10906 (3.0 !) | 2990 (1.3) | 2990 (1.0) |
| 4.0 MB | 123739+ | 116762+ | 116951+ | 119831+ | 7106 (2.0) | 119195+ | 232762+ | 114738+ | 26005 (8.7 !) |

## 2. Markdown transcript (overlapped other runs of mine from 1 MB: indicative only)

| size | nodes | open | key | scrollMid | scrollEnd | toSource | toRead | editUndo | reload | find |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.3 MB | 30,757 | 3934 | 40 | 42 | 39 | 645 | 383 | 2999 | 1091 | 734 |
| 0.5 MB | 50,001 | 14836 | 56 | 88 | 63 | 908 | 659 | 6542 | 2491 | 1405 |
| 1.0 MB | 89,626 | 99217+ | 95 | 135 | 196 | 2115 | 1624 | 17549 | 7374 | 2525 |
| 2.0 MB | 149,704 | 111486+ | 101634+ | 117037+ | 45347 | 3707 | 2833 | 49286 | 22652 | 3950 |

Same shape as prose, somewhat worse: 99 s+ to open at 1 MB.

## 3. Text, JSON, CSV, log (overlapped a transcript run: indicative only; steps open, key, scrollEnd, toSource, find)

| kind | size | open | key | scrollEnd | toSource | find |
| --- | --- | --- | --- | --- | --- | --- |
| txt | 1 MB | 2632 | 35 | 10 | 2184 | 238 |
| txt | 2 MB | 8068 (3.1 !) | 64 | 15 | 4449 | 199 |
| txt | 4 MB | 13101 (1.6) | 96 | 18 | 6555 | 258 |
| json-pretty | 1 MB | 2189 | 28 | 23 | 558 | 207 |
| json-pretty | 2 MB | 2260 | 27 | 23 | 618 | 208 |
| json-pretty | 4 MB | 2283 | 34 | 26 | 455 | 313 |
| csv | 1 MB | 317 | 10 | 33 | 128 | 180 |
| csv | 2 MB | 399 | 9 | 56 | 132 | 210 |
| csv | 4 MB | 227 | 7 | 22 | 120 | 159 |
| log | 1 MB | 219 | 9 | 73 | 114 | 122 |
| log | 2 MB | 310 | 8 | 73 | 112 | 142 |
| log | 4 MB | 459 | 10 | 88 | 125 | 155 |

JSON, CSV and logs are flat or linear to 4 MB (open 0.2 to 2.3 s). Plain text still grows 3.1x from 1 to 2 MB, so it is
the one non-Markdown shape with a real cost below the 5 MiB lines threshold.

## 4. Repeats

Two more runs of prose at 0.25 and 0.5 MB (`raw/chromium-md-r2.*`, `r3`; fewer steps) gave open 2.1 and 15.2 s, and 4.3
and 25.7 s, against 1.5 and 5.3 s in the first run; their key, Source and find times were 1.2 to 2.5x the first run's
too. Something else on the machine (not logged) moves the 0.5 MB open by up to 5x. Treat the open column as good to a
factor of about 2 at 0.25 MB and 3 to 5 at 0.5 MB; the growth shape (over 3x per doubling from 0.25 MB) is the stable
finding. `raw/loaded/` holds the earlier repeat attempts that overlapped other runs, kept for the record. The Edge run
was stopped before it produced a clean result and is not reported.

## 5. WebKit: method not yet working

`measure-scale.mjs` now takes `--browser webkit` (Playwright WebKit 26.6 launches on Windows). WebKit has no CDP, so
the script falls back to the lag of a 5 ms timer in the page as "task time" and counts nodes from the DOM. In the one
try (250 KB prose; overlapped by another run), open had not reported quiet at the 60 s cap, where Chromium opens the
same file in about 1.5 s. Either the timer-lag proxy never meets the quiet bar (jitter), or Windows WebKit is far
slower; the run cannot tell which. Next: log the lag series itself, pick the quiet threshold from an empty page in
WebKit, and compare nodes and wall time with a test that does not depend on a quiet bar. Playwright's Windows WebKit is
not WKWebView, so it says little about the Mac app's engine either way.

## 6. Mac comparison

The Mac figures in the big-files report predate the open-cliff fixes that are on this `main` (Mac: 29 to 38 s at
0.5 MB of prose, 62 s wall at 1 MB, load average 30 to 120). Windows today: 5.3 s at 0.5 MB, 30 s at 1 MB, with the same
3x to 6x growth per doubling. Not like for like (code, load, task time versus wall time), so no ratio is claimed.

## 7. Recommendation (from the clean prose data alone; uncertainty stated)

Not applied: the code has no placeholder constants for these, so none is wrong.

- **Node budget for tier 2 (windowing):** about 20,000 mounted nodes is where this data is comfortable (about 0.25 MB of
  prose: open 1.5 s, Source and back 0.5 s, a key 13 ms). 45,000 is the most it supports; open is already 5 s there.
  Whole-page mounting is past usable between 45k and 81k nodes today. Uncertainty: one clean run per size, open varies
  2 to 5x with load, and the node counts at 2 MB and up are partial mounts at the cap. The windowed tier's own cost per
  mounted node is not measured here (section 1 gives the idle cost, about 0.5 ms of key per 1,000 nodes).
- **Scale classes:** bytes alone do not fit. For Markdown, 1 MB (the "heavy" placeholder) is already 81k nodes and a
  30 s open, so Markdown is heavy from about 0.25 MB or 25,000 nodes and huge past about 2 MB or 90,000 nodes, where
  nothing settles. Blocks were not counted, so the 5,000-block placeholder is unchecked. JSON, CSV and logs are cheap to
  4 MB and need no class below the 5 MiB lines threshold; plain text is heavy from about 1 MB. Stating thresholds in
  nodes (normal under 25k, heavy 25k to 90k, huge above) with a 5 MiB byte backstop fits the data better than one
  byte ladder. These are numbers for the owner to weigh, not a policy.

## Files

`raw/chromium-md-r1.json` and `.log` (prose and transcript, clean for prose), `raw/chromium-other.*`,
`raw/chromium-md-r2.*`, `r3.*`, `raw/webkit-md.log`, `raw/loaded/` (overlapped), `raw/run-rest.sh`, `run-clean.sh`.
