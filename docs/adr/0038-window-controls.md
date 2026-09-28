# ADR-0038 — Window controls hide at rest through the shell

- **Status:** accepted (lands with MARXY-268)
- **Date:** 2026-09-27
- **Follows:** ADR-0010 (privileged work behind `shell-api`), ADR-0026 (post-v1 shell members need their own ADR), ADR-0006 (no GPL code), `docs/design-language.md` constraint 6 (chrome at rest is zero)
- **Evidence:** `docs/plan/deltas/2026-09-27-tauri-research.md`; Readest reader-view behaviour studied 2026-09-27 (AGPL-3.0, not copied)

## Context

`docs/design-language.md` constraint 6 says chrome at rest is zero: no toolbar, no tab bar, no
sidebar. On macOS, Marxy still shows an opaque native title bar because `tauri.conf.json` sets
no `titleBarStyle`, so a strip sits above every page. Hiding the traffic lights at rest and
bringing them back when the reader points at the top edge (or summons the palette) is a privileged
window operation. ADR-0010 and `scripts/check-boundaries.mjs` forbid `@tauri-apps` and raw
`invoke(` outside `apps/desktop/src/shell`; the UI must call `Shell`.

`Shell` already has `setTitle`. On macOS, AppKit re-lays out the title bar on every
`NSWindow.setTitle`, dropping the traffic lights back to their default place. Readest (issue #6222)
found that any correction that crosses IPC paints one wrong frame, so the title and the control
layout have to be set in one main-thread pass in the native shell. The contract must therefore
expose layout of the native controls separately from the title string, and promise that a title
change never moves or reveals those controls.

## Decision

1. **`Shell` gains one member** (implemented in MARXY-269; contract-only in MARXY-268):

   ```ts
   setWindowControls(opts: { readonly visible: boolean; readonly stripHeight: number }): Promise<void>;
   ```

   Show or hide the window's native controls (the macOS traffic lights) and size the strip they
   sit in. `stripHeight` is in CSS px; the controls are centred in it. Resolves as a no-op on
   platforms that draw no native controls in the page's area.

2. **`setTitle` is documented** so implementors and callers know: a title change never moves or
   reveals the window controls. The window may still have a real title for the Window menu and
   VoiceOver; only the chrome strip is under `setWindowControls`.

## Consequences

- MARXY-269 implements the member in Rust and `apps/desktop/src/shell/tauri.ts`, configures
  `titleBarStyle` / overlay chrome, and drives visibility from pointer intent and the palette.
- Null and test shells resolve `setWindowControls` immediately so contract-only work typechecks
  without desktop call-site edits.

## Rejected

- **Keep the native opaque title bar.** Permanent chrome above the page; breaks constraint 6.
- **A transparent overlay bar with always-visible traffic lights.** The controls remain chrome at
  rest; only their background is gone.
- **`data-tauri-drag-region` alone.** Drags the window but cannot hide the native controls.

## Prior art

Readest's reader view (overlay title bar, zero-height strip at rest, reveal on pointer at the top
edge) was **studied, not copied**. Readest is AGPL-3.0; ADR-0006 forbids taking its source.
