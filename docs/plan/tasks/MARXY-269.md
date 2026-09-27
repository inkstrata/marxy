---
key: MARXY-269
design: [06-shell, 09-app-shell]
depends: [MARXY-268, MARXY-184]
verify: [pnpm precheck, pnpm done MARXY-269]
---
# MARXY-269 — The title bar is zero at rest and appears on intent

**Design:** [06-shell](../../design/06-shell.md) §Window chrome at rest · [09-app-shell](../../design/09-app-shell.md) · [design-language](../../design-language.md) constraint 6 · **ADR:** [ADR-0038](../../adr/0038-window-controls.md) (accepted by MARXY-268); ADR-0006 · **Delta:** [2026-09-27-unblock](../deltas/2026-09-27-unblock.md) · **Depends on:** MARXY-268 (the `Shell` member). MARXY-184 has merged; the dependency keeps this story on top of the native menu's `main.rs`.

**Outcome.** When Marxy is at rest, the page runs to the top edge of the window. There is no title bar and no traffic lights. Pointing at the top edge, or opening the palette, brings the window controls and a drag strip back. They go again shortly after the pointer leaves. The window still has a real title for the Window menu and VoiceOver.

## The model (behaviour only)
Readest is AGPL-3.0. Read it to understand what it does, and write none of its code (ADR-0006). What to reproduce, already decided in ADR-0038 and design §06:
- macOS: overlay title bar, title text hidden, real title kept.
- At rest the title-bar container is 0 height, which parks the controls above the window.
- An invisible strip at the top takes the pointer. Its height stops at the first line of text.
- Hide is deferred about 100 ms. Cancel the timer on teardown.
- While the palette is open, the controls stay up.
- Mousedown on the revealed strip starts a window drag. Mousedown on an interactive child does not.

## Files and signatures
- `apps/desktop/src-tauri/tauri.conf.json`: macOS window gets `"titleBarStyle": "Overlay"` and `"hiddenTitle": true`. Keep `"title": "Marxy"`.
- `apps/desktop/src-tauri/src/window/mod.rs` (new): `set_window_controls(window, visible: bool, strip_height: f64)` and `set_title(window, title)`. The second sets the title and re-applies the layout in the same main-thread closure. Centring: `y = max(0, (strip − button_height) / 2 + natural_y)`, with `natural_y` read once and cached. Do not also call Tauri's `set_traffic_light_position`.
- `apps/desktop/src-tauri/src/main.rs`: register the module and commands.
- `apps/desktop/src-tauri/Cargo.toml`: `objc2` and `objc2-app-kit`, MIT or Apache-2.0 only.
- `apps/desktop/src-tauri/capabilities/default.json`: `core:window:allow-start-dragging` plus the new commands.
- `apps/desktop/src/shell/tauri.ts`: implement `setWindowControls`. Route `setTitle` to the native command that re-applies the layout.
- `apps/desktop/src/chrome/`: `installWindowChrome(shell, article, palette): () => void`, returning its teardown.
- `apps/desktop/src/app.ts`: install it after a document opens.
- `apps/desktop/src/palette/`: palette open and close notify the chrome.
- `packages/theme/src/base.css`: the strip's transition, `0s` under `prefers-reduced-motion: reduce`.
- `scripts/registry.json`: any new class or data attribute, before it is used.
- `scripts/allowlists/dependencies.json`: the new crates.
- `apps/desktop/test/window-chrome.test.mjs`: fake `Shell`.
- `apps/desktop/scripts/verify-window-controls.mjs`: reads the close button's offset with `osascript` and prints `hidden` or the offset. Not on the pull-request path. CI runners do not promise System Events.
- `docs/design/06-shell.md`: keep §Window chrome true to what shipped.
- `docs/taste-review/queue.md`: one row.
- `CHANGELOG.md`: one Unreleased line ending `(MARXY-269)`.

## Do this, in order
1. Rust module and the centring unit test.
2. Config, capability, `tauri.ts`.
3. `chrome/` and `window-chrome.test.mjs`.
4. Mount in `app.ts`. Palette hooks.
5. Reduced motion. Registry. Licence allow-list.
6. Taste captures: rest, revealed, full screen, and a 400 px-tall window, dark and light.

## Tests → expected
| Check | Expect |
| --- | --- |
| `cargo test` centring with strip 44, button 16, natural 6 | 20 |
| pointer into the strip | `setWindowControls` called with `visible: true` |
| pointer out, then 100 ms | `visible: false` |
| teardown while a hide is pending | no call after teardown |
| palette open, then close | visible, then back to rest |
| strip height on a corpus document | at most the top of the first line box |
| mousedown on a button inside the strip | no `startDragging` |
| `prefers-reduced-motion: reduce` | computed `transition-duration` is `0s` |

## Acceptance → check
Row items 2–4 and 7 are `window-chrome.test.mjs`. Item 5 is the Rust unit test. Item 9 is `gate:licences`. Items 1, 6 and 8 are `verify-window-controls.mjs` in the taste kit, not in CI. Item 10 is the queue row.

## Do not
- Copy or closely adapt Readest code.
- Add a toolbar, buttons or a tab bar. The strip holds the window controls and a drag area. Do not add the document title unless the taste row asks for it.
- Reveal on a timer or on scroll.
- Touch Linux or Windows window chrome.
- Put the `osascript` check on the pull-request path.
