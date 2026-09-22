---
key: MARXY-47
design: [05-theme, 11-config-and-storage]
depends: [MARXY-20, MARXY-138]
verify: [pnpm precheck, pnpm done MARXY-47]
---
# MARXY-47 — Theme loader, CSS `url()` rewrite, config `theme` key

**Design:** [05-theme](../../design/05-theme.md) §Loader · [11-config-and-storage](../../design/11-config-and-storage.md) (`setTopLevelKey`) ·
**Split 2026-09-21** (`docs/plan/deltas/2026-09-21-marxy-47-split.md`) · **Depends on:** MARXY-20 (base.css and
the default theme), MARXY-138 (asset scope for rewritten `url()`) · **ADRs:** ADR-0008, ADR-0009.

**Outcome.** `loadTheme` reads `theme.toml` + `theme.css`, rewrites local `url()` through `rewriteUrls`,
clamps manifest fields, and exposes `setTopLevelKey` for the one config line the shell story writes.
Nothing here touches `apps/desktop` or the harness — that is `MARXY-177`.

## Files and signatures
- `packages/theme/src/loader.ts` — `loadTheme`, `applyTheme`, `applyVariant`; `loader.test.ts`.
- `packages/theme/src/css-urls.ts` — `rewriteUrls(css, { base, assetUrl }): { css, warnings }`; `css-urls.test.ts`.
- `packages/theme/src/config.ts` — `setTopLevelKey(bytes, key, tomlValue)`; tests beside MARXY-38's file.
- `fixtures/themes/quiet/` — valid small theme. `fixtures/themes/contract-2/` — `contract = 2`.
- `scripts/registry.json` — only if theme package tests need a registry touch.

## Do this, in order
1. `rewriteUrls` with its table first (security-bearing).
2. `loadTheme` (manifest, warnings, clamps).
3. `setTopLevelKey` with byte-preservation tests.

## Tests → expected
| Check | Expect |
| --- | --- |
| `css-urls.test.ts` | local `url()` → `assetUrl`; remote/`@import` → removed + warning; `data:` kept; comment/string untouched |
| `loader.test.ts` | contract-2 warning; clamped measure |
| `setTopLevelKey` | every byte outside the edited line identical; append before first `[table]` with file line ending |

## Acceptance → check
CSV: `css-urls.test.ts`, `loader.test.ts`, `config` byte-preservation tests. Hostile gate is MARXY-45, not here.

## Do not
Wire `startUserTheme` or open `theme.css` as a document (shell story). Parse CSS with a regex over the whole file.
Add `fixtures/themes/hostile/`. Edit `docs/plan/jira-issues.csv` on this branch.
