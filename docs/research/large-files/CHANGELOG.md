# Changelog

Append-only. Newest first. Findings are never deleted or renumbered: a superseded finding keeps its
text, gains a `[superseded]` tag and a `*Superseded by XXX-NN (date): why.*` line, and is logged here.

## 2026-11-27 (lead, after the second and third passes)
- 03: PRS-03 corrected again: remark #1010 was closed by commit cdab8fa, a documentation change ("Add paragraph on security"), not a fix; the maintainer's closing comment added. Checked by the lead through the GitHub API; the first-pass correction that called it fixed was wrong.
- 04: DOM-02 and DOM-05 now cite MDN browser-compat-data's own records (sources 22 and 23); DOM-05 retagged [confirmed] (Safari 26.2 partial, webkit.org/b/304174).
- 10: GRD-10 says "prior work" as the PerfFuzz abstract does.
- SYNTHESIS.md written: nine decisions, answers to Q-01 to Q-12.

## 2026-11-27
- Verifier corrections applied (findings kept, none renumbered).
- 01: EDS-12 retagged `[absence]`; EDS-09 "likely stale" dropped (Zed `FILE_SIZE_MAX` 6 GB still on `main`), open question closed; EDS-11 softened (history not diffed).
- 02: MDA-09 Readium 30,000-line/20 s figures marked `[unverified]` (not in issue 313), design-note half confirmed; MDA-04 512 KB clarified as rich diffs; MDA-03 4.6 s to under 1 s labelled the fork author's own benchmark.
- 03: PRS-03 remark #1010 closed as completed 2025-02-12 (cdab8fa); stance reworded as the reporter's account of a private reply plus the public remark-team reply; TL;DR fixed; markdown-it 90 ms stated as parse-only (102.62 ms parse+render). New finding PRS-13 (micromark open quadratic reports #246, #263, #265; PR #249; #236 unverified); sources 22-24 added (PRS-12 was already taken).
- 04: DOM-05 retagged `[likely]` (Safari 26.2 partial, WebKit 304174); TL;DR, "What I would not do" and Options row fixed; DOM-02 BCD Chrome 85/Firefox 125, Baseline-date disagreement noted, Safari 18.0 confirmed.
- 05: TYP-09 Readium figures `[unverified]`; TL;DR "at least linearly".
- 06: THR-11 and Options row: WebView2 streaming stated as disputed (one user's inference vs a maintainer); THR-05 notes CodeMirror uses `isInputPending`.
- 07: DAT-14 JSON Crack default `NEXT_PUBLIC_NODE_LIMIT=1200` added; DAT-06 absence clause given a Searched line; TL;DR "found no fallback"; the 5 MB comparison marked the author's inference.
- 08: SRC-09 split: `content-visibility: auto` findable only from Safari 26 (not 18-25); TL;DR and Recommendation 5 fixed; SRC-10 Chrome 105 sourced.
- 09: TL;DR cross-ref BUF-12 and "peak RSS growth"; BUF-05 narrowed to WebKit figures (Lemire benchmark exists); BUF-09 Git 2.49 sentence `[unverified]`; audit html_len inconsistency noted.
- 10: GRD-07 corrected (rewrites possible; "cannot see loops" unsourced); GRD-09 study numbers; GRD-01 TL;DR uses SQLite's 7+ digits; GRD-03 `[absence]`; GRD-06 `[likely]`; GRD-10 numbers on the saved page; GRD-05 "2x-100x" marked inference.

## <YYYY-MM-DD>
- Created: <N> chapters, synthesis.
