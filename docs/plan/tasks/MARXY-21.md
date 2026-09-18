---
key: MARXY-21
design: [05-theme, 00-architecture]
depends: [MARXY-20]
verify: [pnpm precheck, pnpm done MARXY-21]
---
# MARXY-21 — Bundle Literata and JetBrains Mono with the per-platform weight offset

**Design:** [05-theme](../../design/05-theme.md) §Weight offset, [00-architecture](../../design/00-architecture.md) §Waterfall · **Depends on:** MARXY-20.

## Outcome
Text is set in Literata and code in JetBrains Mono on both platforms; fonts are ready before `first_text`; Linux requests the weight-offset table's value.

## Do this, in order
1. `apps/desktop/src/fonts/fonts.css`: four `@font-face` rules (Literata roman + italic, JetBrains Mono, KaTeX later) with `src: url(./literata.ttf) format('truetype')`, `font-weight: 200 900`, `font-display: block`. Copy the files from `fonts/` at build (Vite `publicDir` or an import); do not duplicate licences (they stay in `fonts/`).
2. `apps/desktop/index.html`: `<link rel="preload" as="font" type="font/ttf" crossorigin href="…">` for the roman and mono faces; italic not preloaded.
3. `apps/desktop/src/main.ts`: `await document.fonts.ready` before the `first_text` mark (already the design; verify the mark order in the smoke check: `fonts_ready` mark then `first_text`).
4. `src/shell/tauri.ts` + `commands/os.rs`: `webkitVersion()` (Linux: `webkit2gtk::{major_version, minor_version, micro_version}`; other platforms `null`).
5. `apps/desktop/src/theme/offset.ts`: the §05 table → `document.documentElement.style.setProperty('--marxy-weight-offset', String(n))`, config override read later (MARXY-38); log the chosen value in a `weight_offset` mark.
6. `THIRD_PARTY_NOTICES.md`: generate (or extend `scripts/gate-licences.mjs --notices`) with the two OFL entries.

## Tests
| Test | Expect |
| --- | --- |
| smoke check | mark order `script_start < fonts_ready < first_text`; both families in `document.fonts` as `loaded` |
| screenshot sequence (Playwright on the headless entry, or the smoke check's capture) | no frame shows a fallback font (compare text width before/after fonts) |
| Rust | `webkit_version` returns `None` off Linux; on Linux CI returns `{2, 5x, _}` |
| offset | unit test of the table: `(linux, 2.52.6) → 75`, `(linux, 2.50.6) → 125`, `(macos, null) → 0` |

## Do not
Subset or rename a font. Load KaTeX fonts here.
