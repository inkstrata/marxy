# ADR-0041 — The frozen `Shell` gains `onCloseRequested` and `confirmClose`

**Status:** accepted 2026-09-28 (MARXY-49) · **Source:** ADR-0010, ADR-0026

## Context

MARXY-49 (explicit save) needs to warn the reader before a window with unsaved edits closes,
and let them save or discard rather than silently lose bytes. `apps/desktop/src-tauri/src/main.rs`
already intercepts the OS close request (`WindowEvent::CloseRequested`), calls `api.prevent_close()`,
and emits a `marxy:close-requested` Tauri event so the webview can decide; a `close_confirmed`
command lets a previously-blocked close proceed.

`packages/shell-api` is frozen (ADR-0010; amended once for v1 by ADR-0026, which says "every
later addition needs its own ADR"). The two boundary rules in `apps/desktop/test/shell-boundary.test.mjs`
that exist to keep switching shells cheap — `invoke(` and `@tauri-apps` imports appear only under
`apps/desktop/src/shell`, and that directory exports only `shell` and `createMemoryShell` — mean
the close-confirmation flow cannot listen for the Tauri event or call `close_confirmed` directly
from the app-level close-guard module (`apps/desktop/src/close.ts`, which is not a shell
implementation: it decides *whether* to let a close proceed, using `documentIsDirty` and `save`,
neither of which is shell plumbing).

## Decision

Add two members to `Shell`:

| Member | Signature | First caller |
| --- | --- | --- |
| `onCloseRequested` | `(cb: () => void): void` — the window's own close was requested (OS close box, Cmd+W, Cmd+Q) | MARXY-49 |
| `confirmClose` | `(): Promise<void>` — let a previously-requested close proceed | MARXY-49 |

`apps/desktop/src/shell/tauri.ts` implements them with `listen('marxy:close-requested', …)` and
`invoke('close_confirmed')`, exactly as the close-guard code did before this ADR. `createMemoryShell`
implements `onCloseRequested` by recording listeners and exposes a harness-only `emitCloseRequested()`
to fire them, matching the existing `emit`/watch pattern for filesystem events. `apps/desktop/src/close.ts`
calls only `host.shell.onCloseRequested` and `host.shell.confirmClose`.

## Consequences

- `apps/desktop/src/close.ts` and `apps/desktop/src/save.ts` move out of `apps/desktop/src/shell/`
  (to `apps/desktop/src/`, alongside `title.ts`): neither implements the shell, so the directory's
  export allowlist correctly excludes them once the raw `invoke`/`listen` calls are gone.
- A second shell (ADR-0010's escape route) implements two more small methods; no other file
  changes.
- After this lands the interface is frozen again; the next addition needs its own ADR.
