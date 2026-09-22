# ADR-0023 — Byte provenance rides into the DOM on attributes a document cannot forge

**Status:** accepted (MARXY-75; Amendment 1 changes how, not what) · **Source:** design pass 2026-09-18; ADR-0003, ADR-0004, ADR-0009

## Context

ADR-0003 puts `{ file, start, end }` on every AST node, and ADR-0004 needs a rendered element
to resolve back to that range. The renderer that lands with MARXY-12 emits plain HTML and its
sanitiser strips every `data-*` attribute, so today nothing in the DOM says which bytes an
element came from. Whatever carries provenance must survive the sanitiser **and** must not be
something a hostile document can write for itself: a forged range would make an operation
splice bytes the reader did not point at, which is the one thing Marxy promises never to do.

## Decision

1. The renderer emits `data-marxy-s="<start>" data-marxy-e="<end>"` (decimal byte offsets) on
   **every element it creates for an AST node**, block and inline, including the task-marker
   `<input>`, the code `<pre>`, the math containers, images and links. Text nodes carry nothing.
2. Sanitising runs **once**, over the whole render, and provenance travels under names no
   document can know. For each call the pipeline draws 128 bits from the platform's CSPRNG
   (the Web Crypto `crypto` global) and has the renderer write `data-marxy-<nonce>-s` / `-e`. The allow-list
   for that pass is `DEFAULT_POLICY` plus exactly those two names, each constrained to
   `^[0-9]{1,9}$`; it does **not** admit the public `data-marxy-s` / `-e`, so anything a
   raw-HTML island wrote under the public names is removed like any other unlisted attribute. Only
   after the pass does the pipeline rename ` data-marxy-<nonce>-s="` to ` data-marxy-s="`. The
   sanitiser writes every attribute as ` name="value"` and escapes every `<` in text, so the only
   place that string can occur in its output is an attribute admitted under that exact name.
   Link URLs, which the renderer emits verbatim from the AST, are judged by the same pass, so the
   renderer still makes no security decision.
3. The app resolves an element to its node by `closest('[data-marxy-s]')` and a `Map` from
   `"${start}-${end}"` to the node, built once per render (§03). Ranges are trusted only when
   the map has that exact key; an attribute pair with no matching node is ignored.

## Amendment 1 — one pass, secret names (MARXY-75, 2026-09-19)

The decision as first proposed sanitised each island **alone** with `DEFAULT_POLICY` and then the
whole render with the public names admitted. Implementing it showed the first pass destroys inline
raw HTML: CommonMark makes `<kbd>` and `</kbd>` two separate inline `html` nodes, and a sanitiser
that balances its output turns the first into `<kbd></kbd>` and drops the second, so
`Press <kbd>Ctrl</kbd>` reads `Press Ctrl` with an empty element before it. The same happens to
`<sup>`, `<sub>`, `<a>` and `<b>` written inline, which READMEs use constantly. Sanitising islands in
their surrounding context needs the whole document, and once the whole document is sanitised in
one pass the only thing left to decide is how the renderer's attributes differ from a document's.
A per-call secret answers that without a second tokenizer or a strip step that could disagree
with the one that exists. `packages/core/src/render/contract.test.ts` pins the `<kbd>` case; the
`provenance-forgery` vector pins the forgery case, in both spellings a document might try.

## Consequences

- One renderer, one source of truth for HTML shape; no parallel DOM renderer and no positional
  map that could drift.
- The "every attribute allow-listed for its element" sweep gains two global entries and stays.
- A test walks the AST and the parsed output in parallel and asserts every node's element
  carries its own offsets; a sanitiser vector proves an island's `data-marxy-*` is stripped.
- Selection, reading position (§08), the outline, find and typesetting all read the same two
  attributes and nothing else.

## Rejected

- **A positional map** (nth renderer element ↔ nth node): breaks the moment an island unwraps
  or removes an element.
- **A second, DOM-building renderer in the app**: duplicates the HTML mapping and diverges.
- **`class="marxy-s…"` tokens**: forgeable from an island; `class` is allowed on several elements.
- **Each island sanitised alone first** (this ADR as proposed): breaks inline raw HTML; see Amendment 1.
- **Stripping `data-marxy-*` from islands with a pattern before the pass**: a second reading of
  attribute syntax beside the sanitiser's, which is exactly the disagreement ADR-0009 exists to avoid.
- **Islands sanitised only, renderer output trusted**: would make the renderer responsible for
  URL decisions, which ADR-0009's single-boundary rule forbids.
