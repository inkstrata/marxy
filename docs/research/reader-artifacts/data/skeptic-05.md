# Skeptic pass — 05 · Diffs and provenance

Reviewed 2026-09-25. 14 claims attacked: 8 upheld, 2 downgraded, 3 corrected, 0 removed, 1 qualified.

| # | Claim (short) | Attack | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Histogram over Myers, Nugroho [B] | Java only; judged by miners; chapter text said B, default said C | Downgraded B → C | [arXiv 1902.02467](https://arxiv.org/abs/1902.02467): 14 projects (churn), 10 (BIC) |
| 2 | Same, counter-evidence | Newer work | Qualified: thesis reports histogram pathological cases; no Yang 2024/25 study found | [Glodny 2025](https://arxiv.org/abs/2507.22071) |
| 3 | Byte offsets alone fail on regeneration; Marxy restores by byteOffset only | Measured with Node 24 on 03-ai-plan.md | Corrected: `offsetThroughEdit` exists; exact for one edit run, lands at byte 2 or 42 when edits are above and below | `packages/core/src/position/restore.ts`; new Measured box |
| 4 | Frozen OperationInput lacks whole source | Read operation.ts, ast.ts | Upheld (Document has `src` range and `path`, no text) | `contracts/operation.ts` |
| 5 | Cmd+C copies rendered text | Read apply.ts | Corrected: true for drag `text`; node selection runs first `copy-` op (source bytes) | `apps/desktop/src/selection/apply.ts` |
| 6 | Alcocer: 12 participants, unified less effort, not significant | Abstract summaries | Upheld (still abstract only) | [IEEE](https://ieeexplore.ieee.org/document/10328768/) |
| 7 | Uwano: 30 processes, 6 programs, 5 subjects, scan | Fetched page | Upheld | [Okayama](https://okayama.elsevierpure.com/en/publications/analyzing-individual-performance-of-source-code-review-using-revi/) |
| 8 | Fregnan 219,476 PRs, 138 projects, 106 participants, 64% | Fetched | Upheld | [arXiv 2208.04259](https://arxiv.org/abs/2208.04259) |
| 9 | Baum 50 participants, small changes | Fetched | Upheld | [Zenodo](https://zenodo.org/records/2001923) |
| 10 | VS Code data-line on non-inline tokens with map | Source read | Upheld | vscode markdownEngine.ts |
| 11 | Obsidian getSectionInfo may return null | d.ts read | Upheld (interface fields not seen) | obsidian.d.ts |
| 12 | Typora copies HTML by default, Shift+Cmd+C Markdown | Docs read | Upheld | [Typora](https://support.typora.io/Quick-Start/) |
| 13 | Licences: difftastic MIT, GumTree LGPL-3.0, dmp Apache-2.0, Hypothesis client BSD | LICENSE heads fetched | Upheld | raw LICENSE files |
| 14 | git no-newline, color-moved 35/36, hunks | Re-run git 2.55.0 | Upheld (moved needs 20+ alnum chars; tiny blocks are not recoloured) | local run |

Also checked and upheld: Hypothesis (32 chars, four strategies, modified dmp), text fragments (first occurrence, `prefix-,start,end,-suffix`), git-diff doc option text.

## What still worries me

The 2024/25 "Yang et al." paper named in the brief was not found; searches surfaced only Glodny and BDiff (abstract gave no algorithm comparison). Alcocer, Bacchelli-Bird, Baum, Fregnan and Nugroho remain abstract-only. I did not check whether the app passes the `edit` bytes into `restorePosition` on live reload (reload.ts is the caller), so the "fails on two edit sites" finding is about the core function. GitHub suggestion syntax and GitHub rendered-markdown permalinks are still unverified.
