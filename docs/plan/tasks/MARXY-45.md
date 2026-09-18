---
key: MARXY-45
design: [06-shell, 12-trust, 10-gates-and-testing]
depends: [MARXY-97, MARXY-47]
verify: [pnpm precheck, pnpm done MARXY-45]
---
# MARXY-45 — Final CSP and capability set; the no-network gate over the packaged renderer

**Design:** [06-shell](../../design/06-shell.md) §CSP, §Capabilities, §Asset protocol · [12-trust](../../design/12-trust.md) · [10-gates-and-testing](../../design/10-gates-and-testing.md) §The app harness entry · **ADRs:** ADR-0009, ADR-0027 (accepted by this story with MARXY-97) · **Depends on:** MARXY-97 (the last `img-src` source), MARXY-47 (themes, so theme `url()`s are in the gate).


**Review:** touches a CODEOWNERS path under ADR-0028 (sanitiser, `tauri.conf.json` or `capabilities/`), so it waits for Ian's review as well as the signed one.
**Outcome.** The shipped app's content security policy is the final one in §06, its capabilities are exactly the list there, and a gate proves — over the built renderer, not a copy of it — that no corpus document, no hostile theme and no grant makes the page itself touch the network.

## Files and signatures
- `apps/desktop/src-tauri/tauri.conf.json` — the §06 CSP verbatim; `assetProtocol.enable = true`, `scope = []`.
- `apps/desktop/src-tauri/capabilities/default.json` — the §06 list plus one `allow-<command>` per command in §06's table that exists; nothing else.
- `scripts/check-csp.mjs` + `scripts/check-csp.test.mjs` — parses the CSP from `tauri.conf.json`; fails on `*`, `'unsafe-eval'`, any `http:`/`https:` source other than `http://asset.localhost`, `http://ipc.localhost`, `http://marxy-remote.localhost`, any directive outside the §06 set, `script-src` other than `'self'`; checks capabilities against an allow-list file `scripts/allowlists/capabilities.json`.
- `scripts/gate-no-network.mjs` — run against `apps/desktop/dist/app.html` (the app harness over the **production** renderer bundle) in addition to the render entry: every corpus file × {no grants, HTML granted, every image host granted}, plus `fixtures/themes/hostile/` loaded as the user theme.
- `fixtures/themes/hostile/theme.toml` + `theme.css` — `url(https://…)`, `url(//…)`, `@import url(https://…)`, `@font-face { src: url(http://…) }`, `url(../../../etc/passwd)`, `image-set(…)`, `url(data:…)` (allowed; must not count as a request).
- `packages/core/src/sanitize/document-origin.ts` — the comment's open question is closed: ADR-0027 §5's image root; `GATE_DOCUMENT_DIRECTORY` documented as the gate's image root.

## Do this, in order
1. CSP + capabilities; `check-csp` with a self-test that feeds it five bad policies.
2. Hostile theme fixture.
3. Gate over `dist/app.html` with the memory shell (its `fetchRemoteImage` returns `data:` so grants are exercised without network); request interception counts every request that is not `data:`/`blob:` or same-origin to the harness server's `dist/`.
4. `document-origin.ts` comment and constant doc; nothing else in `sanitize/`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `check-csp.test.mjs` | the five bad policies fail, the real one passes |
| gate, all modes | zero requests; theme warnings recorded for each hostile `url()` |
| neutralise the loader's `url()` rewrite | the gate fails on the hostile theme |
| add `https:` to `img-src` | `check-csp` fails |

## Acceptance → check
CSV: CSP has no wildcard and no http(s) source → `check-csp`; the gate runs against the built renderer → gate log naming `dist/app.html`; zero requests over the corpus including themes with `url()` → gate.

## Do not
Loosen the CSP for any test. Allow the `fs` plugin. Add a capability not in §06.
