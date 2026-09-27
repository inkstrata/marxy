# ADR-0038 — The shell can hide the window controls at rest

- **Status:** proposed
- **Date:** 2026-09-27
- **Follows:** ADR-0010 (privileged work goes through `shell-api`), ADR-0026 (the v1 surface is frozen;
  a later member needs its own record), ADR-0006 (no GPL code). Constraint 6 in
  `docs/design-language.md`: chrome at rest is zero.

## Context

`apps/desktop/src-tauri/tauri.conf.json` sets no `titleBarStyle`, so macOS paints an opaque title
bar over every page. `Shell` has `setTitle` and nothing that can move the traffic lights. Hiding
them at rest and bringing them back when the reader points at the top edge, or opens the palette,
is a privileged window operation. `scripts/check-boundaries.mjs` allows `@tauri-apps` and raw
`invoke(` only under `apps/desktop/src/shell`, so the page cannot do it itself.

Readest, a Tauri 2 ebook reader, does this in its reader view: an overlay title bar, a zero-height
title-bar container at rest (which parks the controls above the window), and a reveal strip at the
top edge. Readest is AGPL-3.0. It is prior art to study. It is not code to take.

AppKit re-lays out the title bar on every `NSWindow.setTitle` and drops the traffic lights back to
their default place. Any correction that crosses IPC paints one wrong frame, so the title and the
control layout have to be set in one main-thread pass. That pass can only live in the shell.

## Decision

`Shell` gains one member:

```ts
setWindowControls(opts: { readonly visible: boolean; readonly stripHeight: number }): Promise<void>;
```

`stripHeight` is CSS pixels. The controls are centred in that strip. On a platform that draws no
native controls in the page's area, the member resolves and does nothing.

`setTitle` keeps its current signature and gains a guarantee: a title change never moves or
reveals the window controls. The shell sets the title and re-applies the control layout in the
same main-thread pass.

## Alternatives rejected

- **Keep the native bar.** It is permanent chrome. Constraint 6 fails on every page.
- **A transparent bar with the controls always visible.** The controls are still permanent chrome.
- **`data-tauri-drag-region` alone.** It drags the window. It cannot hide the controls.

## Consequences

- MARXY-268 accepts this record and adds the member, in a pull request that does not implement
  the title bar. The in-file null and test shells resolve the member and do nothing, so call sites
  do not have to change in that pull request.
- MARXY-269 implements it on macOS. Linux and Windows keep the native frame (`docs/scope.md`).
- The reveal strip is no taller than the gap above the first line of text, so it cannot cover a
  selection. The only triggers are the pointer in that strip and a summoned surface (the palette).
  Not a timer, and not scroll.

## What would falsify it

A taste review that finds the reveal strip harder to live with than the native bar, or a Tauri
release that hides the traffic lights at rest without a shell call. Either one supersedes this
record. Copying Readest's source would falsify it immediately (ADR-0006).
