---
key: MARXY-250
design: [06-shell, 09-app-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-250]
---
# MARXY-250 — Runtime styles and KaTeX survive the release CSP

**Design:** [06-shell](../../design/06-shell.md) · [09-app-shell](../../design/09-app-shell.md) · **Related:** MARXY-45 (final CSP) · **Delta:** [2026-09-27-seams](../deltas/2026-09-27-seams.md)

**Outcome.** The palette, formulas, hyphenation and user themes look the same in the shipped app as in development.

## What is wrong today
Tauri rewrites the served CSP per load: every `<style>` in the HTML gets a nonce, and `'nonce-…'` is appended to `style-src` (`tauri-utils` `html.rs` `inject_nonce_token`; `tauri` 2.11.5 `manager/mod.rs` `replace_csp_nonce`). A nonce makes WebKit ignore `'unsafe-inline'`. Verified in Playwright WebKit with [h1-release-csp.mjs.txt](../deltas/evidence/2026-09-27-seams/h1-release-csp.mjs.txt):
| Under the served policy | Result |
| --- | --- |
| `document.createElement('style')` | refused, CSP violation logged |
| `style="…"` in markup (KaTeX) | refused (`height: auto` for `17px`) |
| `adoptedStyleSheets` | applied, even under `style-src 'self'` |
| CSSOM `el.style.x =` | applied |
| markup `style` with `style-src-attr 'unsafe-inline'` added | applied |
The release app shows it: a line breaks inside "without" with no hyphen.

## Files and signatures
Creation sites to move to `adoptedStyleSheets`: `packages/theme/src/loader.ts` (`applyTheme`), `packages/typeset/src/apply.ts` (`#marxy-hyphen-style`), `apps/desktop/src/render/math.ts` (`#marxy-katex`), `apps/desktop/src/palette/view.ts`, `apps/desktop/src/render/headless.ts`. Keep the registry ids as the sheets' keys.
- `apps/desktop/src-tauri/tauri.conf.json` — `style-src-attr 'unsafe-inline'`; `style-src` drops `'unsafe-inline'` (design [06-shell](../../design/06-shell.md) §CSP).
- `apps/desktop/test/shell-boundary.test.mjs` — update whatever still expects a runtime `<style>` element.
- `apps/desktop/test/release-csp.test.mjs`, `scripts/check-csp.mjs`.

## This attempt
Commit `8e837326` on the story branch is the implementation. Do not rewrite it. The stall was after that commit. Open the pull request and fix only a red gate. `shell-boundary.test.mjs` is in Paths.

- `apps/desktop/test/shell-boundary.test.mjs` — stop pinning the old CSP string. Compare `tauri.conf.json` to `loadConfiguredCsp()` from `scripts/check-csp.mjs`. Commit `8e837326` on this story's branch already does that. Open the pull request from that commit and drop its `docs/plan/jira-issues.csv` hunk. Do not start a fourth attempt.

## Tests → expected
| Check | Expect |
| --- | --- |
| built renderer under configured CSP + style nonce | palette, KaTeX, hyphen, user theme styled; zero violations |
| planted `createElement('style')` | `check-csp --selftest` fails |
