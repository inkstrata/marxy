# MARXY-27 — Code blocks highlighted at parse time from the grammar allow-list

**Design:** [02-render](../../design/02-render.md) post-pass 5 · **Depends on:** MARXY-61, MARXY-20.

## Do this, in order
1. `packages/core/src/highlight/index.ts`: `highlight(code, lang): Promise<Token[][] | null>` over `@shikijs/core` (`createHighlighterCore` with `engine: createJavaScriptRegexEngine()` — no WASM on the startup path), grammars imported lazily from `@shikijs/langs/<lang>` for the 25 allow-listed ids only (a map generated from `scripts/allowlists/shiki-languages.json`; a test asserts the map equals the allow-list). Tokens carry `scope` classes only; no colours.
2. `apps/desktop/src/render/highlight.ts`: for each `pre > code[class^=language-]` in visibility order (IntersectionObserver), build `<span class="marxy-tok-<class>">` runs from tokens (trusted DOM, no `innerHTML`).
3. `packages/theme/src/tokens.css` is frozen: put the `--marxy-tok-*` colour set in `packages/theme/default/theme.css` (theme-owned colours) and the mapping in `base.css` (`.marxy-tok-keyword { color: var(--marxy-tok-keyword) }` …) — 12 scopes: keyword, string, comment, number, function, type, variable, operator, punctuation, constant, tag, attribute.
4. `base.css` already gives hanging-indent wrapping; verify no `<pre>` scrolls horizontally.
5. Copy affordance: `Mod+C` with a `codeBlock` selection uses `copy-code-clean` (MARXY-42 provides the operation; until then copy `code.textContent`).

## Tests
All 25 languages produce tokens for a one-line sample (table); `plaintext`/unknown → `null` and untouched DOM; highlighting `03-ai-plan.md` adds < 30 ms after first paint (mark `highlight_ms`); licence gate green; a bundle test proves no grammar outside the allow-list is reachable (`dist` grep for `racket`, `ada`, `nginx`, `gnuplot` absent).
