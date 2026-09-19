---
key: MARXY-42
design: [03-selection-and-operations, 06-shell, 09-app-shell]
depends: [MARXY-41, MARXY-87]
verify: [pnpm precheck, pnpm done MARXY-42]
---
# MARXY-42 — Operations: copy section and copy code block clean; the command registry

**Design:** [03-selection-and-operations](../../design/03-selection-and-operations.md) §Applying an operation, §`copy-section`, §`copy-code-clean`, §The command registry · [06-shell](../../design/06-shell.md) `clipboardWrite` · [09-app-shell](../../design/09-app-shell.md) `Mod+C`, `Mod+Shift+P` · **Depends on:** MARXY-41, MARXY-87 (palette view with an operations state) · **ADRs:** ADR-0004.


**Review:** touches a CODEOWNERS path under ADR-0028 (sanitiser, `tauri.conf.json` or `capabilities/`), so it waits for Ian's review as well as the signed one.
**Outcome.** With a section or a code block selected, `Mod+C` (or the palette's operations list) puts clean text on the clipboard: a section as its markdown source, a code block without fences or highlight markup. The palette offers these only when they apply. This story also creates the registry every later command joins.

## Files and signatures
- `packages/core/src/operations/copy-section.ts`, `copy-code-clean.ts`, `index.ts` (`OPERATIONS`), `operations.test.ts`.
- `apps/desktop/src/commands/registry.ts` — `Command`, `fromOperation`, as §03.
- `apps/desktop/src/commands/index.ts` — `commands()`; this story's content: `OPERATIONS.map(fromOperation)`.
- `apps/desktop/src/selection/apply.ts` — `apply(op, sel, ctx)` steps 1–6 of §03 (steps 3–5 are exercised by MARXY-43; implement them now).
- `apps/desktop/src/selection/view.ts` — migrate the selection keys from MARXY-41's listener into registry commands (`group: 'selection'`).
- `apps/desktop/src/palette/view.ts` — only the operations section's data source: `commands().filter(c => c.group === 'selection' && c.when(ctx))`. Nothing else in the palette.
- Rust `clipboard_write` via `tauri-plugin-clipboard-manager` (MIT/Apache-2.0); `capabilities/default.json` gains `clipboard-manager:allow-write-text` and `-write-html`; `src/shell/tauri.ts` gains `clipboardWrite`.
- `apps/desktop/test/operations-copy.test.mjs` (app harness).

## Do this, in order
1. Core operations with the §03 case tables verbatim as table tests. `copy-section` `canApply`: node is a heading (section) or no node with `range` = whole document. `copy-code-clean` `canApply`: `node.type === 'codeBlock'`.
2. Registry + `fromOperation` + `index.ts`.
3. `apply.ts`. `Mod+C` with a `node`/`section` selection runs the first applicable copy operation; with `text`/`none`, the native copy.
4. Palette operations section wired; after a copy the palette closes and a transient notice says "Copied".
5. Shell clipboard.

## Tests → expected
| Check | Expect |
| --- | --- |
| `operations.test.ts` | §03 tables for both operations; fidelity: `replacement === text` for every applicable node of every corpus file |
| Playwright: select the h2 "Installation" in `02-readme-real-world.md`, `Mod+C` | `clipboardWrite` recorded once; `text` equals the source bytes of that section trimmed + `\n`; `html` present and sanitised (no `data-marxy-*`, no `script`) |
| code block `Mod+C` | text equals `node.value`; no ` ``` `; no `marxy-tok-` substring; no `html` |
| palette with a paragraph selected | neither copy operation listed |
| palette with a code block selected | "Copy code" listed; `Enter` copies and closes |
| neutralise `canApply` to `true` | the "paragraph" case fails |

## Acceptance → check
CSV: table-driven tests → `operations.test.ts`; clean clipboard → the two Playwright cases; offered only when the selection matches → the palette cases; palette-reachable → the palette `Enter` case.

## Do not
Put DOM or clipboard code in `packages/core`. Copy highlighted HTML. Change `session.ts`/`search.ts`/`keys.ts`. Add operations other than these two.
