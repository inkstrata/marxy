# Skeptic pass — 07 · Trust and safety for untrusted artifacts

Reviewed 2026-09-25. 14 claims attacked: 4 upheld, 5 downgraded, 3 corrected, 0 removed, 2 qualified.

| # | Claim (short) | Attack | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Greshake, Trojan Source, Nasr, Liu, Lain graded B | Abstract only; attack demos or a different task (email links) | Downgraded B → C | [Nasr](https://arxiv.org/abs/2510.09023), [Lain](https://arxiv.org/abs/2502.20234) |
| 2 | Nasr: 12 defences bypassed, >90% | Fetched arXiv page; confirmed, but detector share not stated | Upheld fact, C | [arXiv 2510.09023](https://arxiv.org/abs/2510.09023) |
| 3 | Liu supports "do not flag prose" | Abstract gives scale only, no detector verdict | Corrected (sentence removed) | [arXiv 2310.12815](https://arxiv.org/abs/2310.12815) |
| 4 | Lin 2011: helped some participant types less | Page 403; detail unsupported by any text seen | Corrected (detail removed), C | ACM, ResearchGate, S2 unreadable |
| 5 | Domain highlighting weak | Counter-source exists that questions the earlier test's design | Qualified, [X] | [Xiong 2017](https://journals.sagepub.com/doi/10.1177/0018720816684064) |
| 6 | Dhamija 22 / 20 / 23% / 40% | Numbers checked against abstract summary | Upheld, C | [ACM](https://dl.acm.org/doi/10.1145/1124772.1124861) |
| 7 | `unicode-bidi: isolate` neutralises overrides | Tested in WebKit 26.6 via Playwright: RLO reversed 7 glyphs; isolate-wrapped, logical order, also unterminated and with LRI | Upheld (now Measured); not tested in pre/Shiki, CodeMirror or Tauri webview | scratchpad `bidi2.mjs` |
| 8 | UAX #9 / UTS #55 back the isolate approach | UAX #9 quote confirmed; UTS #55 isolates around lexical atoms, not per control | Qualified (variant, said so) | [UAX9](https://www.unicode.org/reports/tr9/), [UTS55](https://www.unicode.org/reports/tr55/) |
| 9 | Some agents do not strip HTML comments | Was unverified | Corrected: one two-model preprint, C | [arXiv 2602.10498](https://arxiv.org/abs/2602.10498) |
| 10 | Mod+C copies `getSelection().toString()` | Code: `runCopyShortcut` tries `copy-*` ops first, else selection text captured at pointer-up | Corrected (wording) | `selection/apply.ts`, `view.ts` |
| 11 | Smart typography reaches `<kbd>` | Ran `renderSafeHtml('<kbd>--help</kbd>')` → `–help` | Upheld | `render-html.ts:233` |
| 12 | "Copy code clean" never adds trailing newline (unchecked) | `copy-code-clean.ts` `clipText` appends `\n` | Corrected: Marxy today contradicts the default | `packages/core/src/operations/copy-code-clean.ts` |
| 13 | Image checkbox default (repeat host or no query = checked) | Evadable with two images or path-encoded data | Downgraded to nudge, all-unchecked alternative named | judgement |
| 14 | Code-point flag table | Rules cite UTS #39/#55; tag-flag emoji exception unverified by author | Upheld as [D], still unverified | UTS #51 not fetched |

## What still worries me

Lin 2011 and Xiong 2017 results were unreadable (403), so passive-cue weakness rests on Dhamija (2006, lab, 22 people) and a task-mismatched email study. Nothing tests whether a viewer marker changes acceptance. The bidi probe used one headless WebKit build, not the Tauri webview or a Shiki-highlighted fence. The tag-flag emoji exception and the variation-selector payload channel were not checked. Whether Marxy's frozen operation contract admits `strip-invisible` is unresolved.
