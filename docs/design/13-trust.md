# 12 — Trust: what a document is allowed to show, and how a reader widens it

ADR-0009 §2–3 and ADR-0027. The sanitiser is never off. By default a document gets the
markdown-equivalent allow-list and no remote content. A reader can grant a single document one
widening, named in a notice, remembered for that document, and revocable:

| Grant | What it widens | Scope | Where it is decided |
| --- | --- | --- | --- |
| **HTML** | the allow-list, from `marxy-default` to `marxy-wide` (layout HTML READMEs use) | this document path | core: the policy passed to `renderDocumentSafeHtml` |

Remote images have no grant. They stay blocked, always, and the notice says how many were held
and from which hosts (ADR-0044; the reader setting that would change this is not built, B-20).
An earlier version of this page described a per-host image grant: nothing ever acted on it, and it
is gone.

The HTML grant never permits script, event handlers, forms, frames, `style` attributes, `<style>`,
`<link>`, `<meta>`, `<base>`, SVG or MathML markup, or any URL scheme outside the existing lists.
Those are not in *any* policy, so there is nothing for a grant to switch on.

## The wide policy (`packages/core/src/sanitize/policy.ts`)

```ts
export const WIDE_POLICY: Policy;           // name 'marxy-wide'
export function policyFor(grant: { html: boolean }): Policy;   // DEFAULT_POLICY or WIDE_POLICY
```

`WIDE_POLICY` = `DEFAULT_POLICY` with these changes, and no others:

| Element | Change | Why |
| --- | --- | --- |
| `details` | moves from `transparent` to `elements`, attribute `open: boolean` | collapsible sections in READMEs |
| `summary` | moves from `transparent` to `elements` | its label |
| `div`, `p`, `h1`–`h6` | `align: enum(left, center, right)` | `<div align="center">` / `<p align="center">` title blocks |
| `div` | moves from `transparent` to `elements` (so `align` has an element to sit on) | |
| `img` | adds `width`, `height`: `pattern ^[0-9]{1,4}(%)?$`; `align: enum(left, right, center, top, middle, bottom)` | sized logos and badges |
| `picture`, `source` | `picture` stays transparent; `source` stays absent | `<source srcset>` is a subresource list we do not parse; the fallback `<img>` inside `<picture>` renders |
| `br`, `sup`, `sub`, `kbd` | already present | |

`transparent` loses `details`, `summary` and `div`; everything else in it stays transparent.
`urlSchemes` are **identical** to the default: a grant of HTML is not a grant of network.

`align` is presentational and the base stylesheet maps it (`[align=center] { text-align: center }`,
`img[align=left] { float: none; display: inline }` — Marxy never floats, because floats break
the grid; an aligned image is laid out inline and snapped like any other). `width`/`height` on an
`img` become the reserved box (§02 post-pass 3) and are capped by `max-width: 100%`.

## Rules every policy now carries

1. **Reserved identifiers.** An island may not produce an `id` or `name` beginning `marxy-`
   (case-insensitive). The renderer's own ids (`marxy-fn-1`, `marxy-fnref-1`) are the only
   holders of the prefix. Implemented as a policy field, not a new pattern:

   ```ts
   interface Policy { /* … */ readonly reservedIdPrefix?: string }   // 'marxy-' on DEFAULT_POLICY and WIDE_POLICY
   ```

   The island pass applies it; `withProvenance(policy)` (the renderer pass) sets it to
   `undefined`, because renderer output is where the prefix is legitimately produced and islands
   have already been through the first pass. The removal reads
   `{ what: 'attribute', name: 'id', reason: 'the marxy- prefix is reserved for marxy' }`.
   Test: an island `<a id="marxy-fnref-1" href="https://x">` in a document with a footnote —
   the island's `id` is gone, the footnote back-link still resolves to the renderer's anchor.

2. **Remote subresources are deferred, never loaded.** When `sanitizeUrl` refuses a
   `subresource` URL **only** because its scheme is `https` and the element is `img`, the
   sanitiser emits `data-marxy-remote="<parsed href>"` in place of `src` and records:

   ```ts
   { what: 'attribute', name: 'src', on: 'img', url: 'https://img.shields.io/…', reason: 'remote image, not loaded' }
   ```

   `Removal` gains one optional field, `url?: string`, the full parsed URL (never truncated),
   present for every refused URL. `http:` images are removed as today, with `url` and the reason
   `'remote image over plain http; marxy never loads these'`.

   `data-marxy-remote` is inert: nothing fetches a `data-*` value. `withProvenance(policy)`
   allows it on `img` with `pattern ^https://[^\s"'<>]{1,2048}$`. An island cannot forge a useful
   one: the island pass does not list `data-marxy-remote` as an input attribute, so an
   author-written one is stripped, and the only `data-marxy-remote` values that reach the DOM are
   URLs the sanitiser itself parsed out of a `src`. (A forged one would at worst add a host to the
   notice; the reader sees it named there.)

   `data-marxy-remote` is how the notice knows which hosts were held. Nothing sets `src` from it.

3. **Island removals carry the island's position.** `renderDocumentSafeHtml` tags every removal
   from the island pass with the island node's `src`:

   ```ts
   export interface RenderRemoval extends Removal { readonly src?: Source }   // packages/core/src/render/pipeline.ts
   export interface RenderResult { readonly html: string; readonly removed: readonly RenderRemoval[] }
   ```

   Removals from the renderer pass have no `src` (they are about the renderer's own output, i.e.
   link and image URLs from markdown syntax, and the app finds those by walking the AST).

## The unclosed-element case

CommonMark ends an HTML block of type 1 (`<script`, `<pre`, `<style`, `<textarea`) only at its
matching end tag, so an unclosed `<script>` makes the **rest of the document** one island, and
the sanitiser removes it and reports `{ what: 'truncation', name: 'script' }`. Without a
notice, the document just looks short. The notice for a truncation is never merged into the
summary line and is never transient:

> Everything after line 40 (212 lines) is inside an unclosed `<script>` and was not shown. [Show source]

`line` is the island's start line (from `src.start` via the buffer's line index); the count is
lines from there to the end. **Show source** switches to Source mode at that line (§08 mode
switch). A grant of HTML does not change this: `script` is in no policy.

## Persistence (`trust.json`, §11)

```json
{ "version": 1,
  "documents": {
    "/abs/path/README.md": { "html": true, "at": 1789712345678 }
  } }
```

- Keyed by absolute path, like positions (ADR-0018 reasoning: a regenerated file keeps its
  grants). LRU, 2,000 paths. Atomic writes via `shell.writeFileAtomic`.
- A file written by v0.1.0 may carry an `imageHosts` array per document. It is ignored when the file
  is read, never acted on, and left in place until the next grant or revoke rewrites the file, which
  writes no `imageHosts`. The version stays 1, so an older Marxy reading a newer file sees no hosts.
- Loaded off the critical path: the first render of a document always uses the default policy
  **unless** `trust.json` has already been read this session. On the first document of a launch,
  if the file then turns out to grant HTML, the app re-renders once with the wide policy and
  restores the position (§08) — the same path as a live reload, under the same 100 ms budget.
  First text is never delayed by a trust lookup.
- The module: `apps/desktop/src/trust/trust.ts`
  (`loadTrust(shell): Promise<TrustStore>`, `grantsFor(path): Grants`,
  `grant(path, { html }): Promise<boolean>`, `revoke(path, 'html'): Promise<boolean>`), a pure store over the
  parsed JSON plus an injected writer, table-tested without a DOM.

## The notice (`apps/desktop/src/notices/blocked.ts`)

Built from `RenderResult.removed` after every render, as one line in `#marxy-notices` (§09):

| Removed | Notice text (counts pluralised) | Actions |
| --- | --- | --- |
| deferred images only | "4 images from img.shields.io and github.com were not loaded." | Dismiss |
| island elements only | "Some HTML in this document was simplified (div, details, img size)." | **Show this document's HTML** · Dismiss |
| both | "4 images from 2 hosts were not loaded, and some HTML was simplified." | **Show this document's HTML** · Dismiss |
| `http:` images | appended: "1 image over plain http is never loaded." | — |
| truncation | its own notice (above) | Show source |

The image part of a notice offers nothing to press: no host list, no checkboxes, no promise that
a later action will load them.

- Element names are listed from the removals whose `reason` is the allow-list (not comments,
  not declarations: those were never content). If every removed element is one `WIDE_POLICY`
  would *also* remove (e.g. only `<script>`), the HTML action is not offered: granting would
  change nothing, and offering it would teach readers that the button makes scripts run.
- Dismiss hides the notice for this document until it is next opened; it grants nothing.
- The notice exists for the document the reader is looking at only; it is recomputed on every
  render, so a live reload that adds a new host re-raises it.
- After the HTML grant: re-render with `WIDE_POLICY` (position kept); the notice is replaced by a
  transient summary for 4 s: "Showing HTML for README.md. Undo in the palette."

## Revoking

Palette operation (document-scoped, §03 command registry): **Stop showing HTML for this
document** (offered only when a grant exists). Revoking re-renders with the default policy. There is no global setting in v1: a grant is always a decision about one
document.

## Fetching

Not built; see ADR-0044 and B-20. No code path loads a remote image. The CSP in `tauri.conf.json`
does not list `https:` in `img-src`, so a document that reached the DOM with one would still not
load it.

## Tests

| Test | Where | Expect |
| --- | --- | --- |
| wide policy table | `sanitize/policy.test.ts` | each row above admitted by `WIDE_POLICY`, refused by `DEFAULT_POLICY`; `urlSchemes` deep-equal |
| script under wide | `sanitize/vectors.test.ts` | every existing vector passes under `WIDE_POLICY` too (run the suite twice, once per policy) |
| `javascript:` after opt-in | `vectors.test.ts` | `<a href="javascript:…">` inside `<details>` under `WIDE_POLICY` has no `href` |
| reserved prefix | `sanitize.test.ts` | island `id="marxy-fnref-1"` and `id="MARXY-x"` removed; renderer `marxy-fn-1` kept |
| deferral | `sanitize.test.ts` | `<img src="https://a/b.png">` → `data-marxy-remote="https://a/b.png"`, no `src`, removal has full `url`; `http:` → neither attribute, removal with `url` |
| forged deferral | `vectors.test.ts` | island `<img data-marxy-remote="https://evil">` → attribute absent |
| island src on removals | `render/pipeline.test.ts` | a removal from an island in `02-readme-real-world.md` has that island's `src` |
| truncation notice | `apps/desktop/test/trust.test.mjs` (Playwright) | a fixture with an unclosed `<script>` at line 5 shows the truncation notice naming line 5 and the remaining line count |
| `02-readme-real-world.md` | same | default: one notice naming the hosts and the simplified elements; the notice has no image action and Dismiss hides it; after "Show this document's HTML", `details`/`div[align]`/sized `img` present, zero requests from the page, `trust.json` written with `html: true` and no hosts |
| persistence | same | relaunch the headless entry with that `trust.json` → no notice, HTML shown on first render or after one re-render |
| revoke | same | revoke → default render, `trust.json` entry gone |
| store | `apps/desktop/src/trust/trust.test.ts` | LRU cap, a v0.1.0 file with `imageHosts` loads and loses them on the next write, corrupt file handling per §11 |
