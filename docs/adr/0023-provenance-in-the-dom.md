# ADR-0023 — Byte provenance rides into the DOM on attributes a document cannot forge

**Status:** proposed (lands with MARXY-75) · **Source:** design pass 2026-09-18; ADR-0003, ADR-0004, ADR-0009

## Context

ADR-0003 puts `{ file, start, end }` on every AST node, and ADR-0004 needs a rendered element
to resolve back to that range. The renderer that lands with MARXY-12 emits plain HTML and its
sanitiser strips every `data-*` attribute, so today nothing in the DOM says which bytes an
element came from. Whatever carries provenance must survive the sanitiser **and** must not be
something a hostile document can write for itself: a forged range would make an operation
splice bytes the reader did not point at, which is the one thing marxy promises never to do.

## Decision

1. The renderer emits `data-marxy-s="<start>" data-marxy-e="<end>"` (decimal byte offsets) on
   **every element it creates for an AST node**, block and inline, including the task-marker
   `<input>`, the code `<pre>`, the math containers, images and links. Text nodes carry nothing.
2. Sanitising runs **twice**, with two policies:
   - Each raw-HTML island (`htmlBlock`, inline `html`) is sanitised **first**, alone, with
     `DEFAULT_POLICY`, which has no `data-*` attribute anywhere in its allow-list. The result
     replaces the island's bytes in the renderer's output.
   - The whole renderer output is then sanitised with `RENDERER_POLICY`, which is
     `DEFAULT_POLICY` plus two global attributes, `data-marxy-s` and `data-marxy-e`, each
     constrained to `^[0-9]{1,9}$`.
   Untrusted bytes exist only inside islands, and islands lose every `data-*` before they are
   ever seen by the policy that allows the two marxy attributes. A document therefore cannot
   claim provenance. Link URLs, which the renderer emits verbatim from the AST, are still judged
   by the second pass, so the renderer still makes no security decision.
3. The app resolves an element to its node by `closest('[data-marxy-s]')` and a `Map` from
   `"${start}-${end}"` to the node, built once per render (§03). Ranges are trusted only when
   the map has that exact key; an attribute pair with no matching node is ignored.

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
- **Islands sanitised only, renderer output trusted**: would make the renderer responsible for
  URL decisions, which ADR-0009's single-boundary rule forbids.
