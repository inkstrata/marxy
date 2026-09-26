# Skeptic pass — 04 · Code as read: typography against the grid

Reviewed 2026-09-25. 12 claims attacked: 5 upheld, 0 downgraded, 3 corrected, 0 removed, 4 qualified.

| # | Claim (short) | Attack | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Scroll exception for diff/patch/log/ascii fences | Contradicts accepted ADR-0033 point 5 ("wraps, never scrolls"); no study either way | Qualified: relabelled "Proposal for an ADR amendment, not a default"; stays [D] judgement; adds chrome-at-rest cost | docs/adr/0033 lines 74-75; sibling 06-code "Wrap or scroll?" (sibling said scroll, ADR overrode) |
| 2 | 1.667 leading is "inside" the sibling's 1.5-1.6 in x-heights | Sibling range is for code; dividing by Literata's 0.507 is the wrong face. In mono x-heights (0.550) the range is 2.73-2.91, Marxy 3.03 is above it | Corrected | 06-code.md line 153; 03-fonts.md line 254 (0.550), 198 (0.507). Other numbers (10.14, 9.90, 97.6 %, 2.96, 3.03, 611.2, 53.8) recomputed and right |
| 3 | Line-number copy is clean in both engines | Reproduced (5 constructions x 3 selections x 2 engines; CodeMirror run). But file:// hand-made page, plain CodeMirror without Marxy's theme | Qualified: says what it does and does not license | scratchpad p04/probe04.mjs, cm-probe.mjs |
| 4 | Engines do not break inline code after `/` `.` `_` | Re-ran slash, dot, underscore, hyphen cases: no break after the first three, break at hyphen, both engines | Upheld (I re-ran four of ten) | own Playwright run |
| 5 | Only 2 of 301 inline spans exceed the measure; 126 lines, 40/22/10 | Recounted from packages/core/goldens: identical (median line 37, 21 with `/`, 32 with space). Sample is a small fixture corpus, not real-world | Upheld (counts); caveat on representativeness already implicit | packages/core/goldens/*.html.txt |
| 6 | `<wbr>` copies clean | Reproduced, but Marxy would use `marxy-lb`, not `<wbr>`, and that was not tested inside `code` | Qualified | p04/wbr.mjs; typeset/src/apply.ts lines 1-6 |
| 7 | url.sty is the incumbent for slash breaks | Source read: it also breaks after `.`, `_` and others; chapter's rule is narrower | Qualified (wording) | url.sty line 32 |
| 8 | GitHub late-2022 auto-wrap complaints | Thread verified: staff quote (19 Jan 2023) matches; complaint is largely mobile | Qualified (mobile note added) | discussion 42298 |
| 9 | GitHub and .editorconfig "not verified" | Discussion 4893 shows users in Aug 2021 calling it a "hack" for tab width; still no GitHub doc | Qualified (added, not relied on) | discussion 4893 |
| 10 | Miara 1983 second-hand | Bauer text (read, lines 100-176) says 2-4 spaces, 2 best, 0 worst; replication n=22 students, null; possibly underpowered | Upheld; wording tightened, stays [X] | scratchpad bauer19.txt |
| 11 | Source mode ligature state "unverified" | No rule reaches `.cm-content`: base.css scopes it to code/kbd/pre; theme-bridge.ts sets none; no other file sets it. So ligatures very likely ON in Source | Corrected (gap stated as a gap; still not measured in the app) | theme-bridge.ts lines 18-40; base.css 165-168 |
| 12 | Code inherits weight 380 dark; ADR-0033 point 5 says "never scrolls" | pre/code set no weight; `.marxy-article` sets 380 and the wght axis (base.css 33, 51, 61); light 400 is in default/theme.css line 6, not tokens.css. ADR quote confirmed | Upheld | tokens.css 23; ADR-0033 line 74 |

## What still worries me

Every "measured" figure is from headless Playwright, not the Tauri webview; WebKit 26.6 via Playwright is a proxy. The scroll exception's premise (a wrapped diff row is misread) is untested in either direction, and the ADR's hang-plus-rule may already suffice. I did not re-fetch WCAG, Primer, VS Code, GNU, Typst or the MDN sources, nor recompute the OKLCH table or the window-width table. The ADR-0033 point 5 exception should be settled by the author, not by this chapter.
