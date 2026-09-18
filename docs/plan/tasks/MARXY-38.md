# MARXY-38 — Reading position persisted per file across launches; config file

**Design:** [08-position-and-watching](../../design/08-position-and-watching.md) §Persistence, [11-config-and-storage](../../design/11-config-and-storage.md) · **Depends on:** MARXY-34.

## Do this
1. `positions.json` via `storage.ts` (LRU 5,000, debounced 500 ms, on close); restore on open when the file is long enough.
2. `packages/theme/src/config.ts`: `parseConfig(bytes) → Config` with defaults, clamps, unknown-key report (`smol-toml`); the app reads it at startup and watches it; `size` written back on `Mod+=`/`Mod+-` by editing the one line.
3. `[linux] weight_offset` override wired into `offset.ts`.

## Tests
Unit: config defaults/clamps/unknown keys; `size` write preserves other bytes. Playwright/smoke: reopen a document → same first visible block within one line; corrupt `positions.json` → renamed `.bad-*`, app starts at the top, no error dialog.
