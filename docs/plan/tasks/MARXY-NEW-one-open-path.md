---
key: MARXY-NEW-one-open-path
design: [09-app-shell, 02-render, 13-trust]
depends: []
verify: [pnpm precheck, pnpm done MARXY-NEW-one-open-path]
---
# MARXY-NEW-one-open-path — One way a document reaches the page

**Design:** [09-app-shell](../../design/09-app-shell.md) · [02-render](../../design/02-render.md) ·
[13-trust](../../design/13-trust.md) · **Delta:** [2026-09-22-broad-review](../deltas/2026-09-22-broad-review.md) ·
**ADRs:** ADR-0011 (palette, no tabs), ADR-0023 (node map through byte ranges) ·
**Sequencing:** shares `apps/desktop/src/palette/view.ts` with MARXY-42, so `ready.mjs` holds this
until MARXY-42 leaves In Progress/In Review. Rebase on it. Do not start before.

**Outcome.** Opening from the command line, from a second launch or open event, and from the palette
all run the same function. So a document opened any way gets the buffer, the image policy, the
typesetter, the grid, highlight, maths and Source mode that a launch gets. Opening many documents in a
row leaks nothing, and an error message is shown as text, never as markup.

## What is wrong today
- `palette/view.ts` `renderPath` parses, sanitises and sets `deps.article.innerHTML` by itself. `app.ts`'s
  `openPath` / `documentBuffer` still name the previous document, so Mod+E after a palette open shows
  the **previous** document's source, and leaving Source commits the previous buffer.
- A palette open gets no typesetter, grid pass, images, highlight, maths or blocked-content notice.
- `replaceOpenDocument` (the `onOpenFiles` route) calls `typesetDocument` and `keepOnGrid` on every
  open. The old `TypesetController` is never `destroy()`ed, and each open adds another `ResizeObserver`.
- `replaceOpenDocument`'s catch does `assignHtml(doc, `<p>${String(e)}</p>`)`. Rust `read_file`
  errors embed the path.

## Files and signatures
- `apps/desktop/src/app.ts`
  - `openDocument(file: string, opts?: { at?: number }): Promise<void>`: the only function that
    replaces `#doc`'s contents with a document. It (1) tears down the previous open: `typeset?.destroy()`,
    Source editor dropped, previous watch handle (none yet; see `MARXY-NEW-live-reload`) closed.
    (2) Runs today's `openDocumentThroughRenderMark` + `finishDocumentOpen` body. (3) If `at` is given,
    scrolls to that byte offset through the node map after the grid pass.
  - `keepOnGrid` installs its `ResizeObserver` **once per article element**, not once per open.
  - Launch (`boot`) keeps its measured path and marks exactly as today. It calls the same internals, so
    `first_text` stays where it is. Do not move marks.
  - The error path uses `textContent` (build the `<p>` with `createElement`), never `innerHTML`.
  - `AppHandle` gains `open(file: string, opts?: { at?: number }): Promise<void>`, which delegates to
    `openDocument`, plus a harness-only `debugCounts(): { typesetters: number; resizeObservers: number }`.
- `apps/desktop/src/palette/view.ts`: `renderPath` is deleted. `PaletteDeps` takes
  `open(path, at?)` and the palette calls it. The palette never writes `#doc`.
- `apps/desktop/src/main.ts`: passes `handle.open` into `mountPaletteFromHandle`.
- `scripts/registry.json`: remove `apps/desktop/src/palette/` from `innerHtmlAllowedIn`. The palette
  builds its own rows with DOM APIs. If any row code still assigns markup, convert it.
- `apps/desktop/test/open-path.test.mjs`: new Playwright test over `startApp` + memory shell, in the
  existing browser job.

## Do this, in order
1. Rebase on `main` after MARXY-42 lands. Read its changes to `palette/view.ts` and `selection/`.
2. Extract `openDocument` from `replaceOpenDocument` + `boot` with no behaviour change on launch. Run
   `apps/desktop/test/app-harness.test.mjs` and the CLI smoke and confirm the mark order is identical.
3. Teardown: destroy the typesetter, one `ResizeObserver`.
4. Route the palette through `open`. Delete `renderPath`. Tighten the registry.
5. Error path to `textContent`.
6. Write the test.

## Tests → expected
| Check | Expect |
| --- | --- |
| open-path: boot `/r/A.md`, `handle.open('/r/B.md')`, Mod+E | `sourceHarness().bufferHash === contentHash(B)`, and `#marxy-source` text starts with B's first line |
| open-path: the same through the palette UI (summon, type, Enter) | same as above, and `document.title` names B |
| open-path: B contains `![x](https://example.com/a.png)` opened via palette | the blocked-content notice is present, as on launch |
| open-path: open A, B, C, A in sequence | `debugCounts()` is `{ typesetters: 1, resizeObservers: 1 }` |
| open-path: `readFile` rejects for `/r/<b>x</b>.md` | `#doc` contains the literal text `<b>x</b>`, and `#doc b` is null |
| `rg -n "innerHTML" apps/desktop/src/palette` | no match |
| `pnpm check:registry` | green. Re-adding `article.innerHTML = html` to `palette/view.ts` turns it red (named mutation in the PR) |
| app-harness + CLI smoke | launch mark order unchanged |

## Acceptance → check
The CSV row's six criteria map one to one onto the table above.

## Do not
Change any mark name or move `first_text`. Touch `packages/core` (render and sanitise are correct; this
is about who calls them). Add watching, index loading or persistence: those are the three stories
that depend on this one. Add a tab strip or a history UI.
