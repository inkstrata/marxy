# 12 — Trust: what a document is allowed to show, and how a reader widens it

ADR-0009 §2–3 and ADR-0027. The sanitiser is never off. By default a document gets the
markdown-equivalent allow-list and no remote content. A reader can grant a single document two
separate widenings, each named in a notice, each remembered for that document, and each
revocable:

| Grant | What it widens | Scope | Where it is decided |
| --- | --- | --- | --- |
| **HTML** | the allow-list, from `marxy-default` to `marxy-wide` (layout HTML READMEs use) | this document path | core: the policy passed to `renderDocumentSafeHtml` |
| **Images from a host** | the shell fetches `https:` images from that host (ADR-0027) | this document path × this host | app: the image post-pass; shell: `fetchRemoteImage` |

Neither grant ever permits script, event handlers, forms, frames, `style` attributes, `<style>`,
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
   URLs the sanitiser itself parsed out of a `src`. (A forged one would at worst request consent
   for a host; the app lists hosts from these attributes, so the reader sees it.)

   This means the DOM is **the same with or without image consent**. Granting images never
   re-renders; the post-pass fetches and sets `src`.

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
    "/abs/path/README.md": { "html": true, "imageHosts": ["img.shields.io", "user-images.githubusercontent.com"], "at": 1789712345678 }
  } }
```

- Keyed by absolute path, like positions (ADR-0018 reasoning: a regenerated file keeps its
  grants). LRU, 2,000 paths. Atomic writes via `shell.writeFileAtomic`.
- `imageHosts` are lowercase ASCII (punycode) hostnames, compared exactly. No wildcards, no
  "all hosts". A new host in a later version of the file is simply not in the list, so it stays
  deferred and appears in the notice.
- Loaded off the critical path: the first render of a document always uses the default policy
  **unless** `trust.json` has already been read this session. On the first document of a launch,
  if the file then turns out to grant HTML, the app re-renders once with the wide policy and
  restores the position (§08) — the same path as a live reload, under the same 100 ms budget.
  First text is never delayed by a trust lookup.
- The module: `apps/desktop/src/trust/trust.ts`
  (`loadTrust(shell): Promise<TrustStore>`, `grantsFor(path): Grants`,
  `grant(path, change): Promise<void>`, `revoke(path): Promise<void>`), a pure store over the
  parsed JSON plus an injected writer, table-tested without a DOM.

## The notice (`apps/desktop/src/notices/blocked.ts`)

Built from `RenderResult.removed` after every render, as one line in `#marxy-notices` (§09):

| Removed | Notice text (counts pluralised) | Actions |
| --- | --- | --- |
| deferred images only | "4 images from img.shields.io and github.com were not loaded." | **Load images from these hosts** · Dismiss |
| island elements only | "Some HTML in this document was simplified (div, details, img size)." | **Show this document's HTML** · Dismiss |
| both | "4 images from 2 hosts were not loaded, and some HTML was simplified." | **Show HTML and images** · **Details** · Dismiss |
| `http:` images | appended: "1 image over plain http is never loaded." | — |
| truncation | its own notice (above) | Show source |

- **Details** expands the notice in place into a short list: each host with its count and a
  per-host checkbox (checked), then the element names removed. Confirming grants the checked
  hosts. The list is plain DOM built with `textContent`; host names are shown in their punycode
  form **and** Unicode form when they differ, so a confusable host is visible as what it is.
- Element names are listed from the removals whose `reason` is the allow-list (not comments,
  not declarations: those were never content). If every removed element is one `WIDE_POLICY`
  would *also* remove (e.g. only `<script>`), the HTML action is not offered: granting would
  change nothing, and offering it would teach readers that the button makes scripts run.
- Dismiss hides the notice for this document until it is next opened; it grants nothing.
- The notice exists for the document the reader is looking at only; it is recomputed on every
  render, so a live reload that adds a new host re-raises it.
- After a grant: HTML → re-render with `WIDE_POLICY` (position kept); images → the post-pass
  fetches (below). Either way the notice is replaced by a transient summary for 4 s:
  "Showing HTML and images from 2 hosts for README.md. Undo in the palette."

## Revoking

Palette operations (document-scoped, §03 command registry): **Stop showing HTML for this
document**, **Stop loading images for this document** (both offered only when a grant exists).
Revoking re-renders with the default policy and drops fetched images (their `src` removed, alt
shown, box kept). There is no global setting in v1: a grant is always a decision about one
document.

## Fetching (app side, `apps/desktop/src/render/remote-images.ts`)

After the local image post-pass (§02 step 3):

```
for img of article.querySelectorAll('img[data-marxy-remote]') in visibility order:
   url = img.dataset.marxyRemote; host = new URL(url).hostname
   if host ∉ grants.imageHosts: continue                       // stays alt text, counted in the notice
   reserve the box: width/height attributes if present, else one line box tall, full measure wide
   img.src = await shell.fetchRemoteImage(url)                  // a marxy-remote: URL; never the https URL
   on decode: snapToGrid(img) (§04)
   on error: leave alt text; one aggregated transient notice "2 images from github.com could not be loaded"
```

At most 4 fetches in flight. A fetch that finishes after the document was replaced is dropped
(compare `buffer.version`).

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
| `02-readme-real-world.md` | same | default: one notice naming the hosts and the simplified elements; after "Show HTML and images" (stub shell serves a PNG for every `fetchRemoteImage`), `details`/`div[align]`/sized `img` present, zero requests from the page (the no-network harness is attached), `trust.json` written with `html: true` and the hosts |
| persistence | same | relaunch the headless entry with that `trust.json` → no notice, HTML shown on first render or after one re-render |
| revoke | same | revoke → default render, `trust.json` entry gone |
| store | `apps/desktop/src/trust/trust.test.ts` | LRU cap, punycode normalisation, new host not granted, corrupt file handling per §11 |
