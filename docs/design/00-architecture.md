# 00 — Architecture

The whole application in one picture, the rules that keep modules apart, the startup path
with its targets, and the decisions this design pass made. Everything else in `docs/design/`
elaborates a box in this diagram.

## Data flow

```
                     shell.readFile(path)                 (Rust, apps/desktop)
   file bytes ──────────────────────────────▶ Buffer            §01  { bytes, text, bom, eol, version }
                                                 │ parseMarkdown(bytes, { file })   (packages/core)
                                                 ▼
                                              Document (AST)   every node: src { file, start, end } in bytes
                                                 │ renderDocumentSafeHtml(doc)      (packages/core)
                                                 ▼
                                              { html, removed } html carries data-marxy-s / data-marxy-e     §02, ADR-0023
                                                 │ article.innerHTML = html; post-passes (images, code, math)  (apps/desktop)
                                                 ▼
                                              DOM ──▶ typeset.attach(article) ──▶ lines, hanging, grid       §04 (packages/typeset)
                                                 │                                   ▲
                                                 │                       theme tokens + base.css              §05 (packages/theme)
                                                 ▼
                                              pixels; reading position tracked from the DOM                   §08

   user selects a node in the DOM ─▶ resolve(el) ─▶ { node, range } ─▶ operation.run() ─▶ replacement          §03
        ─▶ buffer.splice(range, replacement) ─▶ reparse ─▶ re-render ─▶ restore position, selection, typeset
   file changes on disk ─▶ shell watch event ─▶ same path from Buffer, position kept                         §08
   Source mode ─▶ CodeMirror 6 holds buffer.text; on switch back, bytes come from the editor only if edited  §09
```

Two invariants hold at every arrow: bytes outside an operation's range never change (§01),
and nothing reaches the DOM without passing the sanitiser (§02, ADR-0009).

## Modules and what they may import

| Module | May import | Never imports | Runs in |
| --- | --- | --- | --- |
| `packages/core` | its own files; `mdast-*`, `micromark-*`; nothing with a DOM | `document`, `window`, `@tauri-apps/*`, `apps/*`, `packages/typeset`, `packages/theme` | Node and browser |
| `packages/typeset` | `justif/core`; types from `@marxy/core` | shell, theme internals, `@tauri-apps/*` | browser (needs DOM) |
| `packages/theme` | nothing (CSS + a tiny TOML loader) | everything else | browser |
| `packages/shell-api` | nothing (types) | everything | — |
| `apps/desktop/src/shell/*` | `@tauri-apps/*`, `@marxy/shell-api` | `packages/core` internals | browser |
| `apps/desktop/src/**` (rest) | `@marxy/core`, `@marxy/typeset`, `@marxy/theme`, `@marxy/shell-api`, `./shell` | `@tauri-apps/*` directly, Node built-ins | browser |
| `apps/desktop/src-tauri` (Rust) | crates in `Cargo.toml`; none copyleft (ADR-0006) | — | native |

A dependency test per package asserts these (the pattern already exists in
`packages/core/src/parse/dependencies.test.ts`; §10 says how to extend it). `apps/desktop`'s
test `shell-boundary.test.mjs` asserts that `@tauri-apps` appears only under `src/shell/`.

## The startup waterfall

Targets are for the product tier (reference hardware, ADR-0022). CI runners are 5–20× slower
and gated by envelope; the shape is what matters and it is the same everywhere.

| Step | Where | Target (ms, cumulative) | Notes |
| --- | --- | --- | --- |
| process start → window shown, white | `main.rs` | 60 | window created before anything else; `visible: true`, background `#fff`; no menu construction on the path |
| webview loads bundled `index.html` | webview | 150 | one HTML file, critical CSS inline (`base.css` + tokens + default theme light), one JS bundle, fonts referenced with `<link rel=preload as=font>` from the bundle |
| `script_start` mark | `main.ts` | 160 | |
| `args()` → `readFile()` | IPC | 175 | one round trip each; never more than two IPC calls before first text |
| `parseMarkdown` | core | 185 | 100 KB ≈ 5–10 ms (MARXY-59 measures) |
| `renderDocumentSafeHtml` + `innerHTML` | core, app | 200 | |
| `document.fonts.ready` | webview | 240 | both variable fonts decode; nothing waits on grammars, KaTeX or the index |
| **`first_text`** mark | app | **≤ 300, budget 500** | two frames after the DOM mutation, as MARXY-13 defined it |
| typeset the viewport | typeset | +100 (budget) | synchronous in the frame after `first_text` |
| restore reading position | app | +5 | before the first typeset frame is committed, so no jump |
| highlight visible code blocks | app | idle | per block, visibility-ordered; grammars loaded on first use |
| load index, MRU, pins | shell + app | idle | never on the critical path |
| KaTeX | app | on demand | only when the document has math |

Levers if the reference-hardware number misses 500 ms, in order: (1) remove `markdown-it` and
`DOMPurify` from the bundle (MARXY-61); (2) inline the two fonts as `data:` in the HTML so no
second fetch happens; (3) defer the italic face until first use; (4) a resident process
(ADR-0013, opt-in). Font subsetting is **not** a lever in v1: a subset of Literata cannot ship
under the Reserved Font Name without renaming, and renaming a face is its own story.

## Threads and scheduling

One JavaScript thread. No web workers in v1 (parse and render are under 20 ms for the largest
corpus document). Long work — typesetting the rest of the document, highlighting, index diffing —
runs in idle chunks of ≤ 8 ms via `requestIdleCallback`, polyfilled on WebKitGTK with
`setTimeout(fn, 0)` (§04 has the scheduler). Rust does watching and indexing on its own threads
and emits events; the webview never blocks on them.

## Errors

- Every shell command returns `Result<T, ShellError>` where
  `ShellError = { code: 'not-found' | 'permission' | 'io' | 'invalid' | 'unsupported', message: string, path?: string }`.
  The Rust side maps `std::io::ErrorKind` to `code`; the message is for a person.
- The app shows errors as **notices** in the notices region (§09), never as native dialogs, with
  two exceptions: the document named on the command line cannot be read (the empty state shows
  the message), and a save fails (the notice stays until dismissed and offers "save as").
- No error is ever sent anywhere. No log file exists unless `MARXY_DEBUG=1`, in which case the
  shell prints structured lines to stderr. Nothing is written to disk about a document except
  its reading position (§11).

## Decisions made in this design pass

Recorded here so `docs/decisions.md` can point at them. Each is elaborated in the section named.

| # | Decision | Where |
| --- | --- | --- |
| D-A1 | Provenance rides on `data-marxy-s` / `data-marxy-e` attributes; islands sanitised narrow, renderer output sanitised wide | §02, ADR-0023 |
| D-A2 | Selection is node-granular in v1; span selection exists only for copying text | §03 |
| D-A3 | A splice triggers a full reparse and re-render with position and selection restored; no DOM diffing in v1 | §03 |
| D-A4 | Typesetting measures with `Range.getClientRects()` on the real text nodes, not a canvas, so optical size, kerning and the weight offset are exactly what the engine paints | §04 |
| D-A5 | Ragged-right through `justif/core` with word-glue stretch 0.6 em and no shrink; hyphenation on for `en` with allow-listed patterns; breaks applied as soft hyphen + `<br>` inside `white-space: nowrap`; per-paragraph fallback to engine wrapping on any overflow | §04 |
| D-A6 | Left-edge hanging and optical alignment only (the right edge is ragged), via a measured negative inline margin on the first grapheme of each line | §04 |
| D-A7 | The baseline grid is satisfied by construction for text blocks through CSS `mod()`, and by a `snapToGrid` pass (bottom padding) for code, images, tables, math and raw HTML | §04, §05 |
| D-A8 | Base stylesheet is system-owned CSS that derives every vertical distance from tokens; themes are token values plus colour/decoration rules injected after it | §05 |
| D-A9 | The Linux weight offset is keyed to the runtime WebKitGTK version (`2.52+ → 75`, `2.50–2.51 → 125`, else `100`), overridable in config; all `font-weight` declarations add the token | §05 |
| D-A10 | Images: the renderer emits `<img src alt>`; the app resolves local sources through the asset protocol scoped to the document's directory and sets `width`/`height` from `shell.imageSize` before the image loads; remote images were already reduced to alt text by the sanitiser and are named in one dismissible notice | §02 |
| D-A11 | Code highlighting is a DOM post-pass using `@shikijs/core` with allow-listed grammars, token colours through `--marxy-tok-*` variables, block-by-block in visibility order | §02 |
| D-A12 | Math: the renderer emits `<pre class="marxy-math">` / `<code class="marxy-math-inline">` with the TeX source; KaTeX renders into them on demand; block math height is reserved at one line box per source line | §02 |
| D-A13 | Smart typography is a text-run transform at render time in core; the file is untouched | §02 |
| D-A14 | Find uses the CSS Custom Highlight API with a `<mark>` fallback and lands a match at 40 % of the viewport height | §09 |
| D-A15 | Source mode is CodeMirror 6 with a minimal setup; leaving Source without an edit keeps the original bytes; leaving with edits encodes with the buffer's line ending, `mixed` becomes LF with a notice | §09 |
| D-A16 | Index root is the enclosing git repository, headings are found by a line scanner in Rust (not the markdown parser), the index is persisted per root and refreshed in the background | §07 |
| D-A17 | Reading position is the first visible block's `data-marxy-s` plus a fraction; persisted per path with a capped LRU | §08 |
| D-A18 | Config is TOML (`smol-toml`, MIT) in the platform config directory; state files are versioned JSON; corruption never crashes | §11 |
| D-A19 | The app's DOM skeleton, state machine and keyboard map are fixed (§09); no other chrome exists | §09 |
