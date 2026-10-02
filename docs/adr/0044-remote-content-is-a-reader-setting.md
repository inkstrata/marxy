# ADR-0044 — Remote content is a reader setting: three values, one notice, a hardened mode for the few

- **Status:** accepted (author, 2026-10-02)
- **Date:** 2026-10-02
- **Supersedes:** ADR-0027's default path (§1 the CSP never lists `https:`, §2 the Rust fetcher and
  the `marxy-remote:` scheme, §4 per-document, per-host consent). ADR-0027 §3 (the narrow fetch) and
  §5 (local images resolve within the image root) stand, the first as the fetcher's spec.
- **Amends:** ADR-0009 §3 (the CSP no longer fixes `img-src` for every document) and D-A24
  (`trust.json`). Commitment 3 in `AGENTS.md` is kept verbatim.
- **Evidence:** `docs/research/audit-2026-10/10-overfit-decisions.md` §3.1 and §3.5.

## Context

Commitment 3 says nothing phones home by default and remote images wait for the reader. ADR-0027
honoured it with a CSP that never lists `https:`, a Rust fetcher behind `shell-api`, and consent
per document and per host. Today that mechanism blocks the feature it was built to unlock:
`fetchRemoteImage` is declared in `packages/shell-api/src/index.ts` and stubbed in
`apps/desktop/src/shell/memory.ts`, but `apps/desktop/src/shell/tauri.ts` does not implement it, no
Rust command exists, and nothing in the app calls it. A README's badges render as empty boxes. The
consent store (`apps/desktop/src/trust/trust.ts`) and its notices exist; the fetch they would
unlock does not. The user is a first-class owner of their data and tools, so the commitment is
consent, and a config line is consent.

## Decision

1. **Commitment 3 stands.** No request leaves the machine without a reader action: a config
   line, or a yes in a notice.
2. **Two tri-state settings in `config.toml`** (`docs/design/11-config-and-storage.md`, parsed by
   `packages/theme/src/config.ts`): `remote_images = "never" | "ask" | "always"` and
   `html = "narrow" | "ask" | "wide"`. Both default to `ask`. `html = "wide"` is ADR-0009's opt-in,
   as a setting. There is no per-host list.
3. **In `ask`, one dismissible notice per document**, naming how many images were held and offering
   "Load for this document". Yes applies for that document until it is closed. Nothing is stored.
4. **The CSP is widened by reloading the webview.** Tauri fixes the CSP at load, so
   `apps/desktop/src-tauri/tauri.conf.json` keeps `img-src` without `https:`, and the shell
   reloads the webview with `img-src https:` added when the setting is `always` or the reader said
   yes. The reload reopens the document at its reading position (ADR-0018). The `tauri.conf.json`
   CODEOWNERS entry stays: this file is the security floor.
5. **The Rust fetcher exists only behind `hardened = true`**, for readers at risk. In that mode the
   CSP stays closed and images come through ADR-0027 §2–§3. It is not built until someone asks.
6. **The no-network gate is slimmed.** `scripts/gate-no-network.mjs` asserts zero requests over the
   corpus with `remote_images = "never"`, and that is all. The observability report and the
   assertion-set self-check go (`packages/core/scripts/gate-observability.ts`,
   `gate-assertions.ts`, `unobservable-classes.test.ts`).
7. **Themes may `url()` local assets inside their own directory**, as `packages/theme/src/css-urls.ts`
   already rewrites them. Remote `url()` and `@import` stay refused.
8. **Deleted.** `trust.json` per-host grants; `apps/desktop/src/trust/` (`trust.ts`, `trust.test.ts`);
   `apps/desktop/src/notices/trust-copy.ts`; `apps/desktop/src/commands/trust.ts` and its call
   `wireTrustRevokeCommands`; and in `apps/desktop/src/app.ts` the grant functions
   `grantHtmlForOpenDocument`, `grantImageHostsForOpenDocument`, `revokeTrust`, `applyTrustChange`,
   `startTrustLoad`, `trustGrantsFor` and `maybeRerenderForLateTrust`. `notices/blocked.ts` keeps
   one notice and loses the host list. `docs/design/13-trust.md` is rewritten to match.

## Consequences

- A README with badges shows them for a reader who set `always`, and shows one quiet notice for a
  reader on `ask`. A reader on `never` sees exactly what they see today.
- A hostile README can cause a request once the reader said yes. That is what consent means; the
  sanitiser (ADR-0009 §1) still removes script, forms and event handlers whatever the setting.
- `trust.json` files on disk are ignored, not read or deleted. Nothing migrates.
- The Flatpak's no-network permission (D-A34) is a release decision for the Linux release (ADR-0046).
- The one extra webview load on consent must stay inside the open-document budget on a warm index
  (recorded, not gated, ADR-0032).
- Remote images decode after the text paints, as ADR-0027's consequences already say.

## Rejected

- **Keep ADR-0027 as the default and finish the fetcher.** It is two boundaries for a threat most
  readers do not have, built before the feature it protects works.
- **A per-host allow-list inside `config.toml`.** The same ceremony, moved to a file.
- **`img-src https:` always.** It removes the choice for the reader who wants `never`.

## How we would know this was wrong

1. Readers on `ask` say yes on nearly every document: default to `always`, or drop the notice.
2. The reload on consent costs a visible flash on a long document: add `hardened` as the cheap path.
3. A report of a read receipt from a reader on `never`: the zero-request gate failed to see it.
