---
key: MARXY-NEW-title-bar-at-rest
design: [06-shell, 09-app-shell]
depends: [MARXY-NEW-window-controls, MARXY-184]
verify: [pnpm precheck, pnpm done MARXY-NEW-title-bar-at-rest]
---
# MARXY-NEW-title-bar-at-rest — The title bar is zero at rest and appears on intent

**Design:** [06-shell](../../design/06-shell.md) · [09-app-shell](../../design/09-app-shell.md) · [design-language](../../design-language.md) constraint 6 · **ADR:** the window-controls ADR from MARXY-NEW-window-controls; ADR-0006 · **Delta:** [2026-09-27-tauri-research](../deltas/2026-09-27-tauri-research.md) · **Depends on:** MARXY-NEW-window-controls (the `Shell` member), MARXY-184 (holds `main.rs`, `capabilities/default.json` and `shell/tauri.ts`).

**Outcome.** When Marxy is at rest, the page runs to the top edge of the window. There is no title bar and no traffic lights. Pointing at the top edge, or opening the palette, brings the window controls and a drag strip back. They go again shortly after the pointer leaves. The window still has a real title for the Window menu and VoiceOver.

## The model: Readest's reader view (behaviour only)
Readest is AGPL-3.0. **Read it to understand what it does, and write none of its code** (ADR-0006). What to reproduce:
- macOS: `decorations(true)` + `TitleBarStyle::Overlay`, title text hidden, real title kept.
- **At rest:** the title-bar container is set to 0 height, which parks the controls above the window top.
- **Reveal:** an invisible strip at the top takes the pointer. Its height is capped at where the text starts, so it never covers the first line or blocks a selection. Entering it shows the controls, centred in the strip.
- **Hide:** deferred about 100 ms so crossing between targets does not flash. **Cancel the timer on teardown.** Readest #6222 was an orphaned hide timer that hid the controls on the next view.
- **Pinned state:** while the palette (and later the outline) is open, the controls stay up. Readest keeps them up while its sidebar is pinned, for the same reason.
- **Drag:** mousedown on the revealed strip starts a window drag. Interactive children are excluded, or they lose focus to the drag.

## Files and signatures
- `apps/desktop/src-tauri/tauri.conf.json`: macOS window gets `"titleBarStyle": "Overlay"` and `"hiddenTitle": true`. Keep `"title": "Marxy"`.
- `apps/desktop/src-tauri/src/window/mod.rs` (new): `set_window_controls(window, visible: bool, strip_height: f64)` and `set_title(window, title)`. The second sets the title **and** re-applies the layout in the same main-thread closure (`run_on_main_thread`). Re-apply on resize, theme change and full-screen exit.
  - Centring: `y = max(0, (strip − button_height) / 2 + natural_y)`. `natural_y` is the close button's `frame.origin.y`, **read once and cached**: re-reading it after resizing the container drifts (Readest's note on runaway growth).
  - Own the button layout yourself. Do not also call Tauri's `set_traffic_light_position`; the two fight on every redraw.
  - AppKit access through `objc2` / `objc2-app-kit` (MIT or Apache-2.0). Add them to `scripts/allowlists/dependencies.json`. `gate:licences` must pass.
- `apps/desktop/src-tauri/src/main.rs`: register the module and commands.
- `apps/desktop/src-tauri/capabilities/default.json`: `core:window:allow-start-dragging` plus the new commands.
- `apps/desktop/src/shell/tauri.ts`: implement `setWindowControls`, route `setTitle` to the native `set_title`.
- `apps/desktop/src/chrome/` (new): the reveal strip and state machine, `installWindowChrome(shell, article, palette): () => void`, which returns its teardown.
- `apps/desktop/src/app.ts`, `apps/desktop/src/palette/`: install it; palette open/close notifies it.
- `packages/theme/src/base.css`: the strip's transition, off under `prefers-reduced-motion: reduce`.
- `scripts/registry.json`: any new class or data attribute (`marxy-chrome-strip`, …) goes here first.
- `apps/desktop/scripts/verify-window-controls.mjs`: builds nothing. It reads the close button's offset from the window top with `osascript` (System Events `position of button 1 of window 1` minus the window's position) and prints `hidden` or the offset. It is used for the taste-review kit and by hand, so it is not on the PR path.
- `docs/design/06-shell.md` §Window chrome, `docs/design/09-app-shell.md` (the palette pins the chrome).

## Do this, in order
1. Rust module with the centring unit test.
2. Config and capability; `tauri.ts`.
3. `chrome/` state machine with `window-chrome.test.mjs` against a fake `Shell`.
4. Mount in `app.ts`; palette hooks.
5. Reduced motion; registry.
6. Taste-review captures (rest, revealed, full screen, 400 px-tall window; dark and light) and the queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| `cargo test` centring (44, 16, 6) | 20 |
| fake Shell, pointer into strip | `setWindowControls({ visible: true, … })` |
| pointer out, 100 ms | `{ visible: false }` |
| teardown with a hide pending | no call after teardown |
| palette open / close | visible / back to rest |
| strip height on every corpus doc | ≤ first line box top |
| mousedown on a button inside the strip | no `startDragging` |
| `prefers-reduced-motion: reduce` | computed `transition-duration` 0s |

## Acceptance → check
Row acceptance 1–11. Items 2–4 and 7 are checked by `window-chrome.test.mjs`, 5 by the Rust unit test, 9 by `check-deps` and `gate:licences`, 1, 6 and 8 by `verify-window-controls.mjs` in the taste kit, and 10 by the queue row.

## Do not
- Copy or closely adapt Readest code.
- Add a toolbar, buttons or a tab bar to the strip. It holds the window controls, a drag area and at most the document title in quiet type. Do **not** add the title unless the taste row asks for it.
- Reveal on a timer or on scroll. The only triggers are the pointer at the edge or a summoned surface.
- Touch Linux or Windows window chrome. Both stay native until after v1 (`docs/scope.md`).
- Put the native check on the PR path. It needs System Events access that CI runners do not promise.
