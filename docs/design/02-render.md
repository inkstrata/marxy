# 02 — Render: AST → HTML → DOM

Builds on MARXY-12's `packages/core/src/render` (`renderDocumentSafeHtml`) and
`packages/core/src/sanitize` (`sanitizeHtml`, `DEFAULT_POLICY`). This document fixes the HTML
each node renders to, the provenance attributes (ADR-0023), the one sanitiser pass, and the
app-side post-passes. Core produces a string; the app owns the DOM.

## The DOM contract

Every element below carries `data-marxy-s` and `data-marxy-e` (byte offsets of the node) unless
marked *none*. Class names are `marxy-*` only, which the policy allows.

| AST node | HTML | Notes |
| --- | --- | --- |
| `document` | `<article class="marxy-article">…</article>` | created by the app, `data-marxy-s="0"`, `e` = byte length |
| `frontmatter` | *nothing* | not rendered; the outline may show its `title` later |
| `heading` | `<h1..h6 id="<slug>">` | slug = GitHub algorithm: lowercase, strip punctuation except `-` and `_`, spaces → `-`, `-n` suffix on duplicates |
| `paragraph` | `<p>` | tight list items render inlines without `<p>`; the provenance then goes on the `<li>` |
| `blockquote` | `<blockquote>` | |
| `list` | `<ul>` / `<ol start reversed>` | `class="marxy-tasks"` when any item has a task marker |
| `listItem` | `<li>` | `class="marxy-task marxy-task-done"` when checked |
| `taskMarker` | `<input type="checkbox" checked disabled>` | `disabled` so the browser never toggles it; the app handles `click` (§03). Provenance = the marker's own bytes |
| `codeBlock` | `<pre><code class="language-<lang>">` | provenance on `<pre>` = whole block, on `<code>` = `content` range; `<code>` text is `value` verbatim |
| `htmlBlock` | the island, verbatim into the one sanitiser pass | *none* on its elements (a document's own are stripped); wrapped in nothing |
| `thematicBreak` | `<hr>` | |
| `table` / `tableRow` / `tableCell` | `<table><thead><tr><th align>…</thead><tbody><tr><td align>` | `align` from the table's alignment row |
| `mathBlock` | `<pre class="marxy-math">` with the TeX source as text | KaTeX post-pass renders into it (D-A12) |
| `footnoteDefinition` | `<li id="marxy-fn-n">` inside `<ol class="marxy-footnotes">` after an `<hr>` | as MARXY-12 already does |
| `text` | text node, smart typography applied (below) | *none* |
| `emphasis`, `strong`, `strikethrough` | `<em>`, `<strong>`, `<del>` | |
| `code` (inline) | `<code>` | |
| `link` | `<a href title>` | href verbatim from the AST; the second sanitise pass judges it. `class="marxy-external"` when scheme is http(s)/mailto |
| `image` | `<img src alt title>` | src verbatim; remote sources lose the element to the sanitiser and are recorded in `removed` |
| `html` (inline) | the island, verbatim into the one sanitiser pass | *none* |
| `softBreak` | `"\n"` | |
| `hardBreak` | `<br>` | |
| `footnoteReference` | `<sup><a href="#marxy-fn-n" id="marxy-fnref-n">n</a></sup>` | |
| `mathInline` | `<code class="marxy-math-inline">` with the TeX source | |

The renderer **MUST** emit provenance on every row above not marked *none*; the parallel-walk
test in MARXY-75 enforces it.

## One pass, secret provenance names (ADR-0023 Amendment 1)

```ts
// packages/core/src/render/pipeline.ts
export function renderDocumentSafeHtml(document: Document, policy = DEFAULT_POLICY): RenderResult {
  const secret = secretNames();            // data-marxy-<128-bit nonce>-s / -e, per call
  const { html, removed } = sanitizeHtml(renderToUnsanitisedHtml(document, { provenance: secret }), withProvenance(policy, secret));
  return { html: publish(html, secret), removed };   // rename the secret names to data-marxy-s / -e
}
```

Islands are inserted verbatim and judged in context with everything else, so inline raw HTML
split across nodes (`<kbd>` … `</kbd>`) keeps its shape. The allow-list admits only the secret
names, so a document's own `data-marxy-*` is removed. Checks judge the output against
`RENDERED_POLICY` (`DEFAULT_POLICY` plus the public names). The first design, each island
sanitised alone, broke inline HTML; ADR-0023 records why it was replaced.

## Smart typography (D-A13)

A pure function over each `text` node's value at render time, in `packages/core/src/render/typography.ts`,
applied only outside `code`, `mathInline`, `link` URLs and `htmlBlock`:

| Input | Output | Rule |
| --- | --- | --- |
| `"` at word start / after space, `(`, `[`, `\n` | `“` | else `”` |
| `'` at word start | `‘` | else `’` (also apostrophes) |
| `--` | `–` (en dash) with surrounding spaces kept | `---` → `—` |
| `...` | `…` | |
| last space of a paragraph's text when the paragraph has ≥ 8 words | U+00A0 | "widont": the last two words stay together |

Idempotent: running it on its own output changes nothing (test). Never applied to the file.

## App-side post-passes (`apps/desktop/src/render/`)

Run after `innerHTML`, in this order, each cheap and each skipping elements it has already
processed (`data-marxy-done` is set by the app, not the renderer, and is not provenance).

1. **Node map.** Walk `[data-marxy-s]` elements once; build `Map<string, Node>` keyed
   `"${s}-${e}"` by walking the AST in the same order. Elements whose key is absent from the
   AST are left unmapped (an island can only produce those after MARXY-75 strips its
   attributes; the map ignores them). Also collect the ordered array of block elements for
   reading position (§08).
2. **Links.** `a.marxy-external` click → `shell.openExternal(href)`; `a[href^="#"]` click →
   scroll to `#id` with the reading-line offset (§09).
3. **Images.** For each `<img>`: resolve `src` against the document's directory (`../x.png`
   allowed only inside the directory tree; anything escaping it is treated as remote, i.e.
   replaced by alt text and a notice); `const { width, height } = await shell.imageSize(path)`;
   set `width`/`height` attributes and `src = shell.assetUrl(path)`. The `<img>` keeps its
   layout box from the attributes, so decode causes **no layout shift**; the grid pass (§04)
   pads its height to a line-box multiple. Images wider than the measure scale down with
   `max-width: 100%; height: auto` and the reserved height is recomputed from the aspect ratio
   *before* insertion, so the box is right from the first frame.
4. **Blocked-content notice.** If `removed` contains any subresource or island removal, one
   notice (§09): "3 remote images and 1 raw-HTML block were not loaded" with the hosts listed,
   and (Phase 3, MARXY-44) the per-document allow action.
5. **Code highlighting** (D-A11). For each `pre > code.language-*` in visibility order:
   `highlight(code.textContent, lang)` from `packages/core/src/highlight/` (a thin wrapper over
   `@shikijs/core` with `createHighlighterCore` and lazily imported grammars from
   `scripts/allowlists/shiki-languages.json`; `themes: []`, `tokens` only). The app replaces the
   `<code>` children with `<span class="marxy-tok-<scope>">` runs — trusted DOM built from
   tokens, never HTML strings. Unknown language → untouched. Colours come from
   `--marxy-tok-*` tokens (§05). TextMate scopes map to the twelve classes by **first matching
   prefix, in this order**; a scope matching none gets no class:

   | class | scope prefixes |
   | --- | --- |
   | `comment` | `comment` |
   | `string` | `string` |
   | `number` | `constant.numeric` |
   | `constant` | `constant` (after numeric) |
   | `keyword` | `keyword.control`, `keyword.other`, `storage.modifier`, `keyword` (but not `keyword.operator`) |
   | `operator` | `keyword.operator` |
   | `function` | `entity.name.function`, `support.function`, `meta.function-call` |
   | `type` | `entity.name.type`, `entity.name.class`, `support.type`, `support.class`, `storage.type` |
   | `tag` | `entity.name.tag` |
   | `attribute` | `entity.other.attribute-name` |
   | `variable` | `variable`, `support.variable` |
   | `punctuation` | `punctuation` | Long lines: `white-space: pre-wrap; text-indent: -2ch;
   padding-left: 2ch` gives the hanging indent; no horizontal scrollbar ever.
6. **Math** (D-A12). If any `.marxy-math, .marxy-math-inline` exists: `import('katex')` once,
   render with `throwOnError: false`, `output: 'html'`. Before KaTeX loads, block math's height
   is reserved at `lines × line-box` from the source line count; after render the grid pass
   snaps the real height. KaTeX's fonts are OFL and bundled; its CSS is injected once.
7. **Task markers.** `input[type=checkbox]` click → `preventDefault()`, resolve the marker via
   the node map, run `toggle-task` (§03).

## Tests

- `packages/core/src/render/contract.test.ts`: for each corpus file, parse, render, parse the
  HTML with a small tag scanner (no DOM), assert the table above per node type on a sample of
  nodes, and assert every provenance pair maps to a node (MARXY-75).
- `typography.test.ts`: the rule table, idempotence, and "code spans are untouched".
- `apps/desktop/test/post-passes.test.mjs` (Playwright): images get `width`/`height` before
  load; remote images produce alt text and one notice; a `javascript:` link has no `href`;
  clicking a task checkbox toggles the marker bytes and nothing else.
