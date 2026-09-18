---
key: MARXY-36
design: [07-index-and-palette, 09-app-shell]
depends: [MARXY-35]
verify: [pnpm precheck, pnpm done MARXY-36]
---
# MARXY-36 — Palette: MRU, fuzzy over path/title/headings, pinning, back/forward

**Design:** [07-index-and-palette](../../design/07-index-and-palette.md) §Palette, §History; [09-app-shell](../../design/09-app-shell.md) §Keyboard · **Depends on:** MARXY-35.

## Do this, in order
1. `apps/desktop/src/palette/palette.ts`: the `<dialog>` with input + list; the three states (empty, typing, operations — operations section wired in MARXY-42, show "no operations yet" until then); keys as in §07; heading hits navigate and scroll to the reading line.
2. `apps/desktop/src/history.ts`: `opens` with cap 500, MRU derivation, pins, in-memory back/forward stack with positions; `Mod+[`/`Mod+]`.
3. Every keystroke → `indexQuery` (no debounce); rows keyed by path; `palette_keystroke` mark measuring input event → rows painted (p95 over the last 50 keystrokes written to `results/perf.json` by the headless session script).
4. `keys.ts`: the §09 table entries for palette, history.

## Tests
Playwright (headless entry + stub shell with a fixture index of 20k entries): p95 keystroke < 16 ms reference tier; empty query shows pins then MRU; `Tab` toggles sections; `Enter` on a heading hit lands it at 40 % of the viewport; DOM assertion: no tab bar element exists. Unit: MRU derivation and caps.
