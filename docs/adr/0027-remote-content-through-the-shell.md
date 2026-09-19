# ADR-0027 — Remote images reach the page through the shell, only on consent; the webview never touches the network

**Status:** proposed (lands with MARXY-97 and MARXY-45) · **Source:** design pass 2026-09-18 (Phase 3 runway); ADR-0009, `docs/scope.md` (rendering)

## Context

Two commitments collide in Phase 3.

- `docs/scope.md` puts "remote images blocked with a visible opt-in" in v1, and ADR-0009 §3
  promises a per-document opt-in for remote images. A README's badges and screenshots are the
  commonest remote content a reader will meet.
- MARXY-45's acceptance, and `docs/design/06-shell.md`'s final CSP, say the CSP has **no
  `http(s)` source**. ADR-0009 §3 sketches the same shape (`img-src asset: data:`).

If the opt-in works by letting the webview load `https:` images, the CSP must carry `https:` for
every document, forever, and the only thing standing between a hostile README and a read receipt
is the sanitiser. That is one boundary where ADR-0009 promised two. A CSP cannot be widened per
document at runtime in Tauri: it is set when the webview loads.

A second question was left open by MARXY-12 (`packages/core/src/sanitize/document-origin.ts`):
the sanitiser keeps `../sibling/diagram.png` and `/local.png`, while the no-network gate fails any
request that leaves the document's directory. One of the two rules has to change.

## Decision

1. **The CSP never lists an `http:` or `https:` source, for any document.** The webview has no
   network. `scripts/gate-no-network.mjs` keeps asserting zero requests over the corpus, with and
   without every opt-in applied.
2. **A consented remote image is fetched by the shell** (`fetchRemoteImage(url)`, ADR-0026) and
   handed to the page as a `marxy-remote:` URL served from memory by a custom URI-scheme handler
   (`http://marxy-remote.localhost/` on platforms where Tauri maps custom schemes that way). The
   CSP's `img-src` gains exactly `marxy-remote:` and its localhost form.
3. The fetch is narrow, and every property is tested in Rust:
   - `https:` only; `http:` is refused (`unsupported`). A reader who opts in to images is not
     opting in to a plaintext request anyone on the network can read.
   - `GET`, no cookies, no `Referer`, no `Origin`, no credentials, a fixed `User-Agent: marxy`,
     no redirects to another host (same-host redirects, at most 3).
   - At most 10 MB, 10 s total; `Content-Type` must start `image/`; the bytes must be an image
     `imagesize` recognises (SVG is accepted by content type and served as `image/svg+xml`,
     which an `<img>` never executes).
   - In-memory cache for the session, keyed by URL; nothing written to disk.
4. **Consent is per document path and per host.** The notice (design §12) names the hosts; the
   reader allows them for this document. A later version of the same file that references a new
   host shows the notice again for that host only. Consent is stored in `trust.json` (§11) and
   can be revoked from the palette.
5. **Local images resolve within the image root**: the repository root the document is indexed
   under (ADR-0012), else the document's directory. `/x.png` resolves against the image root
   (GitHub's meaning in a repository); `../x.png` is allowed while it stays inside the image
   root; anything that escapes is treated as remote-and-refused. The shell's asset scope is the
   image root (`allowAssetScope`), so the scope and the app's path check are the same rule.
   `document-origin.ts`'s `GATE_DOCUMENT_DIRECTORY` becomes the gate's image root, and the gate
   fails a request that leaves *that*, which is the rule the sanitiser already implements.

## Consequences

- The only code in marxy that opens a socket is one Rust function, reached only after a reader
  clicked "Load images from …" for a named host. That function is the whole audit surface for
  "nothing phones home".
- A new Rust dependency for HTTPS (`ureq` 3, MIT/Apache-2.0, `rustls` with the platform
  verifier). The licence gate decides; if any transitive crate fails it, the story switches to
  the `native-tls` feature and says so.
- Remote images decode after the text has painted; their boxes are reserved from `width`/`height`
  attributes where the document gives them, else at one line box and snapped when they decode
  (the only permitted layout shift, and only after an explicit reader action).
- Tracking pixels still work once a reader consents to their host. That is what consent means; the
  notice lists hosts precisely so a reader can decline `tracker.example`.

## Rejected

- **`img-src https:` in the CSP, gated by the sanitiser.** One boundary instead of two, for every
  document, to serve an opt-in most documents never use.
- **Per-document CSP via a `<meta>` tag.** A meta CSP can only tighten, never loosen, the header
  policy, and Tauri's policy is the header.
- **Drop the remote-image opt-in from v1.** Badge-heavy READMEs are the first content type in
  priority order; ADR-0009 already records that stripping them makes readers think marxy is broken.
- **Allow `http:` on consent.** A plaintext fetch leaks the reader's interest to the network, not
  just to the host they consented to.
