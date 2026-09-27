# Plan delta — 2026-09-27, Tauri app UI and process research

> Filed at the author's request after reading a research pass on Tauri prior art (UI patterns,
> CI and release engineering, reader typography). The pass itself was not committed, so the
> findings this delta acts on are restated here with their sources. Landing key **MARXY-267**,
> with its own `no-dispatch` row. It ran in `../marxy-wt/MARXY-267`, cut from `origin/main` at
> `814b976`.

## What the research found, checked against the tree

Most of its recommendations are already true of Marxy:

| Recommendation | Already here |
| --- | --- |
| Cache Rust builds in CI | `Swatinem/rust-cache@v2` in `ci.yml`, `cache-on-failure` |
| Signing and notarization as their own step | `release.yml`, MARXY-52; MARXY-22 parked on the account |
| `prefers-reduced-motion` | MARXY-241 |
| Per-engine screenshot baselines, not one Chromium baseline | MARXY-30 |
| Gate measurement on `document.fonts.ready` | `apps/desktop/src/app.ts` |
| Token-based theming, user themes | `--marxy-*`, MARXY-177 |
| Persist reading state locally | MARXY-38, MARXY-195 |
| Baseline grid from measured layout | `packages/typeset/src/grid.ts` |

Two gaps remain, and this delta files stories for them.

1. **The title bar breaks constraint 6.** `apps/desktop/src-tauri/tauri.conf.json` sets no
   `titleBarStyle` or `decorations`, so macOS draws the opaque native bar over every page.
   `docs/design/06-shell.md` covers only `setTitle`. The research said no app hides its title bar
   at rest. That is wrong: **Readest**, a Tauri 2 ebook reader, does exactly this in its reader
   view, with an overlay title bar, a 0-height title-bar container at rest, and a reveal strip at
   the top edge. Readest is **AGPL-3.0**, so it is prior art to study, never code to take
   (ADR-0006).
2. **Cargo runs without `--locked`.** Node installs with `--frozen-lockfile`; `cargo build`,
   `cargo clippy` and `tauri build` do not hold Rust to its lockfile.

## What this pass does

| Key | Phase | Depends on | Why this shape |
| --- | --- | --- | --- |
| MARXY-NEW-window-controls | 3 | — | `Shell` is frozen (`scripts/registry.json`, ADR-0026). The new `setWindowControls` member and the `setTitle` guarantee arrive with an ADR in a contract-only PR, as MARXY-94 did |
| MARXY-NEW-title-bar-at-rest | 3 | window-controls, MARXY-184 | The implementation. MARXY-184 is in review and holds `main.rs`, `capabilities/default.json` and `shell/tauri.ts` |
| MARXY-NEW-locked-cargo | ops | MARXY-247 | MARXY-247 (PR #220) holds `ci.yml` |

The author asked for two stories. The title bar becomes two because the contract rule forces it.

**Phases 0, 1 and 2 in `orchestration/deps.json` are unchanged.** The two product rows are in
phase 3, the open phase, under MARXY-40. The CI row is in the ops lane, which never holds a phase.

## Not filed, and why

- **`sccache`, a per-crate clippy matrix:** there is one crate, and the cache is already on.
- **A bundle-size gate:** ADR-0032 measures without gating. The research found no Tauri project that gates on it either.
- **A duospaced or commissioned reading face:** the typography handbook is the authority (ADR-0033). This research adds no evidence to it, so it waits for a taste review to ask.
- **A theme marketplace or import flow:** no prior art, and outside v1 scope.
- **Checking the hang amounts against OpticalMargin** (hyphen 1.0, quotes 0.8, comma 0.6): worth a look, but too small for a story. `packages/typeset/src/hang.ts` uses a protrusion table.

## Sources

- Readest: `apps/readest-app/src-tauri/src/macos/traffic_light.rs`, `src/store/trafficLightStore.ts`,
  `src/hooks/useTrafficLight.ts`, `src/app/reader/components/HeaderBar.tsx`, issues #5584 and #6222
  (github.com/readest/readest, read 2026-09-27; AGPL-3.0).
- Tauri window customisation: v2.tauri.app/learn/window-customization/.
- `--locked`: doc.rust-lang.org/cargo/commands/cargo-build.html; corrode.dev/blog/tips-for-faster-ci-builds/.
