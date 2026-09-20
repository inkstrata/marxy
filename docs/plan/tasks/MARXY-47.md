---
key: MARXY-47
design: [05-theme, 11-config-and-storage, 09-app-shell, 08-position-and-watching]
depends: [MARXY-20, MARXY-37, MARXY-38, MARXY-95, MARXY-138]
verify: [pnpm precheck, pnpm done MARXY-47]
---
# MARXY-47 — User theme loading under the contract; a theme opens as a document

**Design:** [05-theme](../../design/05-theme.md) §Loader, §App side · [11-config-and-storage](../../design/11-config-and-storage.md) (`theme` key, `setTopLevelKey`) · [09-app-shell](../../design/09-app-shell.md) §Source mode (per-file-type default) · [08-position-and-watching](../../design/08-position-and-watching.md) §Re-layout · **Depends on:** MARXY-20 (base.css and the default theme), MARXY-37 (Source mode), MARXY-38 (config parsing), MARXY-95 · **ADRs:** ADR-0008, ADR-0009.

**Outcome.** A reader points `theme = "~/themes/quiet"` at a folder with `theme.toml` and `theme.css`; marxy applies it after the text appears, re-sets the page without losing their place, and re-applies it whenever the files change. Opening that `theme.css` in marxy offers "Use this theme", which writes the one config line. A theme that tries to fetch from the network gets a warning and fetches nothing.

## Files and signatures
- `packages/theme/src/loader.ts` — `loadTheme`, `applyTheme`, `applyVariant` (§05 Loader); `loader.test.ts`. `smol-toml` is already pinned.
- `packages/theme/src/css-urls.ts` — `rewriteUrls(css, { base, assetUrl }): { css, warnings }`: a small tokenizer over CSS that finds `url(`…`)` (quoted and unquoted), `@import`, and `image-set(` arguments, skipping comments and strings, never a regex over the whole file; `css-urls.test.ts`.
- `packages/theme/src/config.ts` — add `setTopLevelKey(bytes, key, tomlValue)` (MARXY-38 created the file; this story adds the function and its tests only).
- `apps/desktop/src/theme/user-theme.ts` — `startUserTheme` (§05 App side).
- `apps/desktop/src/theme/theme-document.ts` — the "This is a marxy theme" notice when the opened path is `theme.css`/`theme.toml` beside its sibling.
- `apps/desktop/src/commands/view.ts` or a new `commands/theme.ts` — none needed beyond the notice action; do not add palette commands for themes in v1.
- `fixtures/themes/quiet/` — a valid small theme (changes `--marxy-color-*` and `--marxy-measure` only). `fixtures/themes/contract-2/` — `contract = 2`.
- `apps/desktop/test/user-theme.test.mjs` (app harness).

## Do this, in order
1. `rewriteUrls` with its table first (below); it is the security-bearing part.
2. `loadTheme` (manifest, warnings, clamps).
3. `setTopLevelKey` with byte-preservation tests (CRLF config, key absent, key present, key after a table header must not be touched).
4. `startUserTheme`: scope, load, apply after `first_text` in idle, relayout with position kept, watch.
5. Theme-as-document notice and "Use this theme".

## Tests → expected
| Check | Expect |
| --- | --- |
| `css-urls.test.ts` | `url(fonts/a.woff2)` → `assetUrl(dir/fonts/a.woff2)`; `url("https://x")`, `url(//x)`, `url(http://x)`, `@import "x.css"`, `@import url(https://x)` → removed + one warning each; `url(../../etc/passwd)` → removed (escapes the dir); `url(data:…)` kept; a `url(` inside a comment or a string untouched; `image-set("a.png" 1x, "https://x" 2x)` → remote candidate removed |
| `loader.test.ts` | §05 Tests bullets (warning for `contract = 2`, clamped measure) |
| `setTopLevelKey` | every byte outside the edited line identical; appended before the first `[table]` with the file's own line ending |
| harness: config `theme = "/t/quiet"` with the fixture | `#marxy-theme` present after `ready`; first text painted **before** the theme applied (mark order); same first visible block before and after the relayout |
| harness: write a new `theme.css` via `shell.emit` | re-applied within 200 ms |
| harness: open `/t/quiet/theme.css` | Source mode; the notice; "Use this theme" writes `theme = "/t/quiet"` to `/config/marxy/config.toml` (memory shell) |
| `contract-2` | the warning notice; theme still applied |

## Acceptance → check
CSV: applies on launch and on change with re-layout → the two harness cases; contract mismatch warns → `contract-2`; opening `theme.css` lands in Source mode → the open case; a theme `url()` to the network is blocked (gate) → `css-urls.test.ts` here and MARXY-45's gate over `fixtures/themes/hostile/`.

## Do not
Put the user theme on the startup path. Invert or derive a dark palette from a light-only theme (§05: fall back to the default theme's values). Parse CSS with a regex over the whole file. Write any config key but `theme`.
