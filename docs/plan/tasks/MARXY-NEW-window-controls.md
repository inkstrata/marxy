---
key: MARXY-NEW-window-controls
design: [06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-NEW-window-controls]
---
# MARXY-NEW-window-controls — Add window controls to the shell-api so the title bar can hide at rest (ADR)

**Design:** [06-shell](../../design/06-shell.md) · **ADRs:** ADR-0010 (shell-api is frozen), ADR-0026 (every addition after the v1 amendment needs its own ADR), ADR-0006 (no GPL code) · **Delta:** [2026-09-27-tauri-research](../deltas/2026-09-27-tauri-research.md) · **Depends on:** nothing. **Unblocks:** MARXY-NEW-title-bar-at-rest.

**Outcome.** The shell can hide and reveal the window's native controls on request, and promises that changing the title never disturbs them. Nothing the reader sees changes in this story; it is the contract the title-bar story builds on.

## Why a contract change
`docs/design-language.md` constraint 6 says chrome at rest is zero, but `apps/desktop/src-tauri/tauri.conf.json` sets no `titleBarStyle`, so macOS draws an opaque title bar over every page. Hiding the traffic lights at rest and bringing them back when the reader points at the top edge is a privileged window operation, so it has to go through `Shell` (`scripts/check-boundaries.mjs`: no `@tauri-apps` or raw `invoke(` outside `apps/desktop/src/shell`). `Shell` has only `setTitle`. `packages/shell-api/src/` is in `scripts/registry.json` `frozen`, so the member arrives with an ADR in a PR that touches nothing else, as MARXY-94 did.

## Files and signatures
- `packages/shell-api/src/index.ts`:
  ```ts
  /**
   * Show or hide the window's native controls (the macOS traffic lights) and size the strip they sit in.
   * `stripHeight` is in CSS px; the controls are centred in it. Resolves as a no-op where the
   * platform draws no native controls in the page's area.
   */
  setWindowControls(opts: { readonly visible: boolean; readonly stripHeight: number }): Promise<void>;
  ```
  Extend the `setTitle` comment: *a title change never moves or reveals the window controls.*
  Add the member as `async () => {}` to both in-file shells (the null shell and the test shell, near the existing `setTitle: async () => {}`).
- `docs/adr/0038-window-controls.md`: take the next free number. MARXY-248's PR #221 claims 0037.
- `docs/adr/README.md`: one index row.
- `CHANGELOG.md`: one Unreleased line ending `(MARXY-NEW-window-controls)`.

## The ADR says
- **Decision:** the member above, and the `setTitle` guarantee.
- **Why the shell:** AppKit re-lays out the title bar on every `NSWindow.setTitle`, dropping the traffic lights back to their default place. Readest (issue #6222) found that any correction crossing IPC paints one wrong frame, so the title and the layout have to be set in one main-thread pass. That can only be done in the shell.
- **Alternatives rejected:** keeping the native bar (breaks constraint 6); a transparent overlay bar with always-visible controls (the controls are permanent chrome); `data-tauri-drag-region` alone (drags the window but cannot hide the controls).
- **Prior art:** Readest's reader view, **studied, not copied**. Readest is AGPL-3.0, so ADR-0006 forbids taking its code.

## Tests → expected
| Check | Expect |
| --- | --- |
| `pnpm typecheck` | green, no call-site edits |
| `node scripts/check-story.mjs --strict` | frozen file accepted because the ADR is in the change |

## Acceptance → check
Row acceptance 1–5; each is checked by `pnpm typecheck`, `check-story --strict` and reading the ADR.

## Do not
- Implement anything in `apps/desktop` in this PR.
- Add any other member to `Shell`.
- Copy or paraphrase Readest source.
