# 09 — The app shell: DOM, state, keys, outline, find, notices, Source mode

`apps/desktop/src/`. Chrome at rest is zero: at rest the DOM contains the article and nothing
visible else. Everything below is summoned and dismissed.

## DOM skeleton (D-A19)

```html
<body data-marxy-mode="rendered" data-marxy-variant="dark">   <!-- dark is primary (ADR-0024) -->
  <main id="marxy-main">
    <div id="marxy-notices" role="status"></div>            <!-- empty at rest -->
    <article class="marxy-article" data-marxy-s="0" data-marxy-e="…"></article>
  </main>
  <div id="marxy-source" hidden></div>                      <!-- CodeMirror mounts here in Source mode -->
  <dialog id="marxy-palette"></dialog>                      <!-- §07 -->
  <dialog id="marxy-outline"></dialog>
  <div id="marxy-find" hidden></div>
</body>
```

No element outside `#marxy-main` is visible unless its state is open. There is no toolbar,
tab bar, status bar or sidebar element in the DOM at all, so the "chrome at rest" gate is a DOM
assertion, not a screenshot judgement.

## State (`apps/desktop/src/state.ts`)

```ts
interface AppState {
  document: { buffer: Buffer; ast: Document; nodeMap: NodeMap; blocks: BlockList } | null;
  mode: 'rendered' | 'source';
  overlay: 'none' | 'palette' | 'outline' | 'find';
  selection: Selection;            // §03
  dirty: boolean;
  variant: 'light' | 'dark';
}
```

A single `dispatch(action)` mutates it; every mutation is one of: `open(path)`, `reloaded`,
`setMode`, `setOverlay`, `select`, `applied(op)`, `saved`, `setVariant`. Overlays are
exclusive: opening one closes another. `Esc` closes the open overlay, else clears the
selection, else does nothing.

## Keyboard map

`Mod` is `⌘` on macOS and `Ctrl` on Linux (and Windows later). Bound in one table
(`keys.ts`); the palette lists every command with its key so the map is discoverable without
chrome.

| Key | Action | Notes |
| --- | --- | --- |
| `Mod+P` | palette (documents) | with a selection: `Mod+P` again shows operations |
| `Mod+Shift+P` | palette (operations) | |
| `Mod+E` | toggle Rendered / Source | position kept (§08) |
| `Mod+F` | find | `Enter` next, `Shift+Enter` previous, `Esc` closes and keeps the reading position |
| `Mod+Shift+O` | outline | `↑/↓ Enter`, `Esc` |
| `Mod+[` / `Mod+]` | back / forward | history stack (§07) |
| `Mod+S` | save | byte-faithful, atomic |
| `Mod+Z` / `Mod+Shift+Z` | undo / redo | in Rendered mode: the operation history (§01); in Source: CodeMirror's |
| `Mod+Shift+E` | open in external editor | at the current block's line |
| `Mod+=` / `Mod+-` / `Mod+0` | body size ±1 px / reset | persisted in config; re-layout |
| `Alt+↑` / `Alt+↓` / `Alt+←` | move block selection / select parent | §03 |
| `Space` / `Shift+Space`, `PageDown/Up`, `Home/End`, arrows | scroll | native |
| `Esc` | close overlay, else clear selection | |
| `Mod+C` | copy | with a `node`/`section` selection: runs `copy-section` or `copy-code-clean` when applicable, else the DOM selection |

No single-letter bindings in v1 (a reader may be typing in find or the palette).

## Outline

Built from the AST's headings (`level`, text, `src.start`). Rendered as a `<dialog>` at the
right edge, width `min(320px, 40vw)`, one line per heading, indented by level. The current
heading (the last with `start ≤ position.byteOffset`) is marked; opening the dialog scrolls it
into view. `Enter` on a heading selects its section (§03) and scrolls it to the reading line;
`Esc` closes. Frontmatter `title:` shows as the first entry when there is no h1.

## Find (D-A14)

- Input at top-right, no chrome until `Mod+F`. Case-insensitive, whole document, incremental.
- Matching runs over a text index built at render: the concatenation of the article's text
  nodes with a map from string offset to `(textNode, offset)`. Soft hyphens (U+00AD) and the
  typesetter's `<br>` are invisible to it: the index is built *before* typesetting and kept in
  sync by the typesetter's split records (each split maps a node to its two halves).
- Highlights: `CSS.highlights.set('marxy-find', new Highlight(...ranges))` with
  `::highlight(marxy-find)` styled by the theme; the current match in a second highlight.
  Fallback when `CSS.highlights` is undefined: wrap matches in `<mark class="marxy-find">`
  and unwrap on close (the fallback is exercised by a test that deletes `CSS.highlights`).
- Navigation scrolls the current match to the reading line (40 % of the viewport), never to
  the top edge. Count shown as `3 of 41` inside the input.
- In Source mode, find is CodeMirror's `@codemirror/search` panel with the same key.

## Notices (`#marxy-notices`)

One region, in flow above the article, empty at rest. A notice is a single line with up to two
actions, dismissible, and it never overlaps the text. Kinds in v1: blocked content (§02),
external change while dirty (§08), file removed, save failed, theme warnings (§05), index
truncated (§07), operation summary (transient, 4 s). Never a modal dialog.

## Source mode (D-A15)

CodeMirror 6 in `#marxy-source`, created on first switch and kept:

```ts
new EditorView({ state: EditorState.create({ doc: buffer.text /* without BOM */, extensions: [
  history(), drawSelection(), highlightActiveLine(), keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
  EditorView.lineWrapping, language(byExtension(path)), lineNumbers?  // config.line_numbers
  EditorState.lineSeparator.of(buffer.eol === 'crlf' ? '\r\n' : '\n'),
  themeBridge,   // maps --marxy-* tokens to CM6's theme
] }) })
```

Languages, MIT only: `@codemirror/lang-markdown`, `-javascript`, `-rust`, `-python`, `-css`,
`-json`, `-yaml`, `-html`; others plain. Files over 2 MB: no language, no wrapping.

Leaving Source: if `view.state.doc.toString() === buffer.text.slice(bom ? 1 : 0)`, keep the
original buffer untouched. Otherwise `buffer = fromText(path, doc, like: buffer)` (§01) and
`history.push` one edit covering the whole document with label "edit in Source". A `mixed`
buffer edited in Source becomes LF with a one-time notice.

Per-file-type default: `.md .markdown .mdx .txt` open Rendered; everything else Source. A
`theme.css` next to a `theme.toml` opens in Source with a notice offering "apply this theme".

## Window title

`<name> — marxy`, with ` •` appended while dirty. That is the only persistent indicator.

## Tests

- `state.test.ts`: the transition table; overlays exclusive; `Esc` semantics.
- Playwright: at rest the only visible elements are inside `#marxy-main`; each key in the map
  does what the table says; find lands the current match at 40 % ± 2 px; the fallback path
  wraps and unwraps `<mark>`; Source round-trip without edits leaves `buffer.bytes` identical.
