---
key: MARXY-268
design: [06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-268]
---
# MARXY-268 — Accept the window-controls ADR and add the shell member

**Design:** [06-shell](../../design/06-shell.md) §Window chrome at rest · **ADRs:** [ADR-0038](../../adr/0038-window-controls.md) (proposed; this story accepts it), ADR-0010, ADR-0026, ADR-0006 · **Delta:** [2026-09-27-unblock](../deltas/2026-09-27-unblock.md) · **Depends on:** nothing. **Unblocks:** MARXY-269.

**Outcome.** The shell can hide and reveal the window's native controls on request, and promises that changing the title never disturbs them. Nothing the reader sees changes in this story.

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
  Extend the `setTitle` comment: a title change never moves or reveals the window controls.
  Add the member as `async () => {}` to both in-file shells (the null shell and the test shell, near the existing `setTitle: async () => {}`).
- `docs/adr/0038-window-controls.md`: status becomes accepted, with the date and this key. Do not rewrite the decision.
- `docs/adr/README.md`: the 0038 row says accepted.
- `CHANGELOG.md`: one Unreleased line ending `(MARXY-268)`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `pnpm typecheck` | green, with no call-site edits outside `packages/shell-api` |
| `node scripts/check-story.mjs --strict` | the frozen file is accepted because the ADR is in the change |

## Acceptance → check
Row acceptance 1–5. `pnpm typecheck` checks the member. Reading the ADR checks the status.

## Do not
- Implement anything in `apps/desktop`.
- Add any other member to `Shell`.
- Copy or paraphrase Readest source. The ADR already records the behaviour.
