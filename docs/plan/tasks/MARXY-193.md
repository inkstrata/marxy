---
key: MARXY-193
design: [09-app-shell, 02-render, 13-trust]
depends: [MARXY-198]
verify: [pnpm precheck, pnpm done MARXY-193]
---
# MARXY-193 — One way a document reaches the page

**Design:** [09-app-shell](../../design/09-app-shell.md) · [02-render](../../design/02-render.md) ·
[13-trust](../../design/13-trust.md) · **Deltas:** [2026-09-22-broad-review](../deltas/2026-09-22-broad-review.md)
(the finding), [2026-09-23](../deltas/2026-09-23.md) (re-scoped around MARXY-198) ·
**ADRs:** ADR-0011 (palette, no tabs), ADR-0023 (node map through byte ranges) ·
**Depends on:** MARXY-198, which landed most of the original story. **Rebase on it. Do not start
before it is Done, and do not re-implement anything in the "already landed" list below.**

**Outcome.** Opening from the command line, from a second launch or open event, and from the palette
all run the same function, and there is no second way left in the tree. A document opened any way
gets the buffer, the image policy, the typesetter, the grid, highlight, maths and Source mode that a
launch gets. `open` can land on a byte offset. Opening many documents in a row leaks nothing, an error
message is shown as text, never as markup, and a Playwright test proves every one of these through
`startApp`.

## Already landed by MARXY-198 — read it, do not redo it
- `AppHandle.open(path)` and `AppHandle.currentPath()`; `replaceOpenDocument` → `openReplacing`
  behind `serially()`, so opens and mode switches run one at a time.
- `teardownDocument()`: `typeset.destroy()`, one module-level `ResizeObserver` disconnected and
  replaced, pending grid pass cancelled, Source editor `destroy()`ed. `keepOnGrid` no longer adds an
  observer per open.
- `palette/view.ts`: `PaletteDeps.openDocument?` — when present, `renderPath` calls it and returns.
  `mountPaletteFromHandle` passes `handle.open` and seeds the current path from `handle.currentPath()`.
- `rerenderFromBuffer` after a Source edit.

## What is still wrong after MARXY-198
- `renderPath` keeps its fallback: with no `openDocument` it still parses, sanitises and sets
  `deps.article.innerHTML` itself, so `apps/desktop/src/palette/` must stay in `innerHtmlAllowedIn` and
  a second way to the page still exists.
- `handle.open` takes no byte offset; the palette scrolls with `scrollToByteOffset` *after* the open
  returns, before background typesetting has finished, so a heading jump can land off by the reflow.
- `openReplacing`'s catch still writes `` `<p>${String(e)}</p>` `` through `assignHtml`; Rust
  `read_file` errors embed the path, so a file name becomes markup.
- Nothing counts typesetters or observers, so the leak fix has no test.
- No test drives the palette UI through `startApp` and checks the buffer the Source editor shows.

## Files and signatures
- `apps/desktop/src/app.ts`
  - `open(file: string, opts?: { at?: number }): Promise<void>` on `AppHandle` (extends MARXY-198's
    `open(path)`; keep the name). `at` is a byte offset: after `keepOnGrid`, scroll so the block that
    contains `at` (through `state.document.nodeMap`, ADR-0023) sits at the reading position. No `at`:
    top of the document, as today.
  - `debugCounts(): { typesetters: number; resizeObservers: number }` on `AppHandle`, harness-only:
    count live `TypesetController`s (increment in `startTypeset`, decrement in `destroy`) and live
    observers (0 or 1). Do not export module state; return numbers.
  - The catch in `openReplacing` builds `<p>` with `createElement` and sets `textContent`. No
    `assignHtml`, no template string with `e` in it.
  - Launch (`boot`) keeps its measured path and marks exactly as today. `first_text` does not move.
- `apps/desktop/src/palette/view.ts`: `PaletteDeps.openDocument` becomes required,
  `(path: string, at?: number) => Promise<void>`. `renderPath`'s parse/sanitise/`innerHTML` body is
  deleted; the function becomes a call to `openDocument(path, byteOffset)` then `setCurrentPath`. Remove
  the `parseMarkdown` / `renderDocumentSafeHtml` imports if nothing else in the file uses them. The
  palette never writes `#doc`.
- `apps/desktop/src/main.ts`: unchanged if `mountPaletteFromHandle` already passes `handle.open`; if a
  call site constructs `PaletteDeps` directly, give it `openDocument`.
- `scripts/registry.json`: remove `apps/desktop/src/palette/` from `innerHtmlAllowedIn`. If any palette
  row code still assigns markup, convert it to DOM APIs.
- `apps/desktop/test/open-path.test.mjs`: new Playwright test over `startApp` + memory shell, in the
  existing browser job.

## Do this, in order
1. Rebase on `main` with MARXY-198 merged. Read its `app.ts` and `palette/view.ts` diffs.
2. `at`: extend `open`, implement the scroll through the node map after the grid pass; make the palette
   pass `byteOffset` through instead of scrolling itself.
3. Make `openDocument` required; delete the fallback; tighten the registry; run `pnpm check:registry`.
4. Error path to `textContent`.
5. `debugCounts`.
6. Write the test; run `app-harness.test.mjs` and the CLI smoke to confirm the mark order is unchanged.

## Tests → expected
| Check | Expect |
| --- | --- |
| open-path: boot `/r/A.md`, `handle.open('/r/B.md')`, Mod+E | `sourceHarness().bufferHash === contentHash(B)`, and `#marxy-source` text starts with B's first line |
| open-path: the same through the palette UI (summon, type, Enter) | same as above, and `document.title` names B |
| open-path: B contains `![x](https://example.com/a.png)` opened via palette | the blocked-content notice is present, as on launch |
| open-path: open A, B, C, A in sequence | `debugCounts()` is `{ typesetters: 1, resizeObservers: 1 }` |
| open-path: `readFile` rejects for `/r/<b>x</b>.md` | `#doc` contains the literal text `<b>x</b>`, and `#doc b` is null |
| open-path: `handle.open('/r/B.md', { at })` with `at` inside B's third heading | after `typeset.ready` and the grid pass, `sourceHarness()` reports a reading byte offset inside that heading's block |
| `rg -n "innerHTML" apps/desktop/src/palette` | no match |
| `rg -n "renderDocumentSafeHtml\|parseMarkdown" apps/desktop/src/palette/view.ts` | no match |
| `pnpm check:registry` | green. Re-adding `article.innerHTML = html` to `palette/view.ts` turns it red (named mutation in the PR) |
| app-harness + CLI smoke | launch mark order unchanged |

## Acceptance → check
The CSV row's seven criteria map one to one onto the table above (criterion 5 covers the three
`rg`/registry rows).

## Do not
Change any mark name or move `first_text`. Touch `packages/core` (render and sanitise are correct; this
is about who calls them). Re-implement `serially`, `teardownDocument` or `AppHandle.open` — they are
MARXY-198's; extend them. Add watching, index loading or persistence: those are MARXY-194, 196 and 195.
Add a tab strip or a history UI.
