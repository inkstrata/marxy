# Design documents — the runway

These documents exist so that a fast, inexpensive model can implement a story without making a
design decision. Every choice an implementor would otherwise have to make is made here: module
boundaries, function signatures, data shapes, algorithms with their edge cases, the tests that
prove each one, and the order to build in. If a story needs a decision this set does not
contain, the story is not ready; the planner adds the decision here first.

They are written against the code as it is on `main` at the time of writing (the parser in
`packages/core/src/parse`, the renderer and sanitiser landing with MARXY-12, the shell in
`apps/desktop`). Where a document depends on something not yet merged, it says so.

| Doc | Governs | Stories |
| --- | --- | --- |
| [00-architecture](00-architecture.md) | data flow, module import rules, the startup waterfall, error policy | every story |
| [01-buffer](01-buffer.md) | the document buffer: bytes, text, splice, undo, dirty, save | MARXY-14, MARXY-41–43, MARXY-49 |
| [02-render](02-render.md) | AST → HTML → DOM, provenance attributes, the two-pass sanitise, images, code, math, smart typography | MARXY-61, MARXY-75, MARXY-26, MARXY-27, MARXY-28, MARXY-29 |
| [03-selection-and-operations](03-selection-and-operations.md) | selection model, byte-range resolution, the four operations, splice → reparse → re-render | MARXY-41, MARXY-42, MARXY-43 |
| [04-typeset](04-typeset.md) | ragged-right Knuth–Plass through justif/core, hanging punctuation, grid snapping, scheduling | MARXY-23, MARXY-24, MARXY-20 (grid half) |
| [05-theme](05-theme.md) | the base stylesheet derived from tokens, the theme loader, variants, the weight offset | MARXY-20, MARXY-21, MARXY-22, MARXY-46, MARXY-47 |
| [06-shell](06-shell.md) | every Tauri command, its Rust module, capability and error mapping; asset scoping; single instance | MARXY-14, MARXY-26, MARXY-34, MARXY-35, MARXY-45, MARXY-48 |
| [07-index-and-palette](07-index-and-palette.md) | root detection, walking, entries, persistence, fuzzy ranking, palette states, history | MARXY-35, MARXY-36 |
| [08-position-and-watching](08-position-and-watching.md) | reading position from the DOM and back, watch events, reload with position kept | MARXY-34, MARXY-38 |
| [09-app-shell](09-app-shell.md) | DOM skeleton, state machine, keyboard map, outline, find, notices, Source mode, mode switch | MARXY-37, MARXY-47, MARXY-48 |
| [10-gates-and-testing](10-gates-and-testing.md) | how to write tests per package, the headless render entry, grid and rag checks, screenshot diffs | MARXY-25, MARXY-30 |
| [11-config-and-storage](11-config-and-storage.md) | config file, app data files, versioning, corruption handling | MARXY-38, MARXY-46 |

Task cards exist for MARXY-16, 20–31, 33–39, 61, 64 and 75 (`../plan/tasks/`).

Task cards for individual stories live in `../plan/tasks/<KEY>.md` and point into these
documents by section. An implementor reads `AGENTS.md`, its task card, and the sections the
card names — nothing else is required.

## Conventions used in these documents

- **MUST / MUST NOT** are requirements a test or gate checks. **SHOULD** is a default an
  implementor may depart from only with a reason in the PR.
- Type signatures are TypeScript unless marked Rust. They are the intended public surface;
  private helpers are the implementor's.
- "Node-granular" means an operation or selection resolves to whole AST nodes, never to a
  byte range inside a text run. v1 is node-granular throughout (ADR-0004, §03).
- Byte offsets are UTF-8 byte offsets into the file, half-open `[start, end)`, as in the AST
  contract. Nothing in the app speaks in code units except at the two conversion points named
  in §01.

## Hardened rules — answers to the questions an implementor would otherwise ask

These are decisions, not suggestions. A PR that departs from one says so in "For the reviewer"
and names the reason; the reviewer returns it unless the reason is a bug in this document.

| Question | Answer |
| --- | --- |
| Which test runner? | `node --test` with `--experimental-strip-types` in packages and the app; Playwright at the root for anything needing a DOM; `cargo test` in `src-tauri`. Never vitest, jest or mocha. |
| Where does a new file go? | Under the path the story lists, in the module the design names. A file that fits no listed path means the story is wrong: stop and report `blocked`. |
| May I add a dependency? | Only if the card or design names it, and only from the pinned table below. Anything else is `blocked` with the reason. |
| The design's signature does not compile against current code. | Adapt the minimum, keep the exported names, and write one line in "For the reviewer". Do not redesign. |
| A design references a function that does not exist yet. | If it is in your paths, build it as the design specifies. If not, stub it with `throw new Error('not implemented: MARXY-nn')` naming the owning story, and note it. |
| Which Node built-ins may packages use? | None in `packages/*/src` except `packages/core/scripts`. `apps/desktop/src` uses none. Tests may use `node:test`, `node:assert/strict`, `node:fs`, `node:path`, `node:url`. |
| Can I use `innerHTML` in the app? | Only for the sanitised `html` from `renderDocumentSafeHtml`, exactly once per render, into `<article>`. Everything else builds DOM with `createElement`/`textContent`. |
| Which quote style, formatting, line width? | biome defaults from the repo config (MARXY-8): single quotes, semicolons, 100 columns. Do not reformat files you did not change. |
| Naming | Files `kebab-case.ts`; exported functions `camelCase`; types `PascalCase`; CSS classes `marxy-<thing>`; data attributes only `data-marxy-s`, `data-marxy-e`, `data-marxy-done`, `data-marxy-typeset`, `data-marxy-mode`, `data-marxy-variant`; marks `snake_case`; events `marxy:<thing>`. |
| Which marks exist? | `main_start`, `window_shown`, `script_start`, `args`, `file_read`, `parsed`, `rendered`, `fonts_ready`, `first_text`, `typeset_viewport`, `position_restored`, `highlight_ms`, `index_loaded`, `live_reload`, `palette_keystroke`, `find_first_match`, `weight_offset`, `error`, `ready`. Add one only if a card says so. |
| Which events exist? | `marxy:watch`, `marxy:index-updated`, `marxy:open-files`. |
| What is the reading line? | 40 % of the viewport height. One constant, `READING_LINE = 0.4`, in `apps/desktop/src/position/position.ts`. |
| Rounding, tolerances | Grid ± 0.5 px; overflow > 0.5 px reverts a paragraph; screenshot threshold 0.1 / 0.1 %; contrast 7:1 body, 4.5:1 secondary and tokens; keystroke budget 16 ms p95; debounce: scroll 1 frame, resize 100 ms, position save 500 ms, watch 100 ms. |
| Which variant is default? | Dark (ADR-0024). Every screenshot, baseline, specimen and review lists dark first. |
| A fixture would help but does not exist. | Add it under `fixtures/corpus/` with the next number, never edit an existing one, and add its goldens. Say so in the PR. |
| Something in a design is wrong. | Do not silently work around it. Implement what compiles, write the discrepancy in "For the reviewer", and the planner fixes the design. |
| Error text for a person | One sentence, no stack, names the file if there is one: "Could not read README.md: permission denied." |

## Pinned dependencies

Everything below is MIT, Apache-2.0, BSD, CC0 or MPL-2.0 and passes `pnpm gate:licences`.
Versions are minimums; the lockfile pins exact ones.

| Purpose | Package | Version |
| --- | --- | --- |
| parser | `mdast-util-from-markdown`, `micromark-extension-gfm`, `mdast-util-gfm`, `micromark-extension-frontmatter`, `mdast-util-frontmatter`, `micromark-extension-math`, `mdast-util-math` | as in `packages/core/package.json` |
| line breaking | `justif` | ^0.9.1 (`justif/core`, `justif/hyphenate/en-us`, `justif/hyphenate/en-gb`) |
| highlighting | `@shikijs/core`, `@shikijs/engine-javascript`, `@shikijs/langs` | ^4.4 |
| math | `katex` | ^0.18 |
| editor | `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/language`, `@codemirror/lang-{markdown,javascript,rust,python,css,json,yaml,html}` | ^6 |
| TOML | `smol-toml` | ^1.4 |
| screenshot diff | `pixelmatch`, `pngjs` | ^7, ^7 |
| browser tests | `playwright` | ^1.57 |
| Rust: walking, matching, watching | `ignore` 0.4, `nucleo-matcher` 0.3, `notify` 8, `notify-debouncer-full` 0.5 | |
| Rust: images, opening, hashing | `imagesize` 0.13, `open` 5, `sha1_smol` 1 | |
| Rust: Tauri plugins | `tauri-plugin-single-instance`, `tauri-plugin-clipboard-manager`, `tauri-plugin-dialog`, `tauri-plugin-opener` | 2 |

Not allowed anywhere: `markdown-it`, `dompurify`, `remark`/`rehype` (slow, and the parser is
settled), `shiki` (the full bundle; use `@shikijs/core`), `highlight.js`, `prismjs`,
`mermaid`, any UI framework (React, Svelte, Vue), any CSS framework, `lodash`, `moment`.
