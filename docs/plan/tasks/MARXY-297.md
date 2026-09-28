---
key: MARXY-297
design: [07-index-and-palette]
depends: []
verify: [pnpm precheck, pnpm done MARXY-297]
---
# MARXY-297 — Make the index-model's heading scanner require a matching closing fence

**Design:** [07-index-and-palette](../../design/07-index-and-palette.md) · **Delta:** [2026-09-28-bugcatch-2](../deltas/2026-09-28-bugcatch-2.md) · **Depends on:** nothing.

**Outcome.** A code-fence line inside an already-open fence of the other marker type (``` inside a ~~~ block, or vice versa) does not close the fence early.

## Why
`headingsFromMarkdown`'s fence-tracking heuristic (`index-model/entry.ts`) toggles `inFence` on any line starting with ``` or ~~~, without checking the closing fence uses the same character (and at least the same length) as the opening one, unlike CommonMark's actual rule. A fenced block whose body contains a line starting with the other fence character mis-toggles `inFence` early, so a later `# comment`-shaped line still inside the real fence is misread as a real heading and shows up in the file's index-model heading list.

## Files and signatures
- `packages/core/src/index-model/entry.ts`: track which fence character (and length) opened the current fence, and only close on a matching closing fence.

## Tests → expected
| Check | Expect |
| --- | --- |
| A ``` ```-fenced block containing a line starting with ~~~ (and the reverse) | no spurious heading is produced from content inside the still-open fence |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
