---
key: MARXY-49
design: [01-buffer, 09-app-shell, 06-shell, 08-position-and-watching]
depends: [MARXY-43, MARXY-37, MARXY-34, MARXY-94, MARXY-249, MARXY-195]
verify: [pnpm precheck, pnpm done MARXY-49]
---
# MARXY-49 — Explicit save, byte-faithful and atomic, from either mode

**Design:** [01-buffer](../../design/01-buffer.md) §Dirty state and the disk, §Save · [09-app-shell](../../design/09-app-shell.md) §Window title, §Notices · [06-shell](../../design/06-shell.md) `writeFileAtomic`, `setTitle`, `saveDialog` · [08-position-and-watching](../../design/08-position-and-watching.md) (own-write detection) · **Depends on:** MARXY-43 (edits exist), MARXY-37 (Source mode edits), MARXY-34 (watch, `savedHash`), MARXY-94, MARXY-195 (`app.ts`) · **ADRs:** ADR-0004, ADR-0001.

**Outcome.** After toggling a task or editing in Source mode, the title shows ` •`; `Mod+S` writes exactly the new bytes, atomically, and the dot goes. Nothing else about the file changes. Closing with unsaved changes asks once, in a notice, never a modal.

## Files and signatures
- `apps/desktop/src/save.ts` — `save(ctx, opts?)` per §01 §Save. Not under `src/shell`: it decides whether to write, and it does not implement the shell.
- `apps/desktop/src/close.ts` — close guard. Calls `shell.onCloseRequested` and `shell.confirmClose` only.
- `apps/desktop/src/commands/document.ts` — `save` (`Mod+S`), `save-as` (`Mod+Shift+S`); one line in `commands/index.ts` if the file is new.
- `apps/desktop/src/title.ts` — `updateTitle(state)` → `shell.setTitle('<name> — marxy' + (dirty ? ' •' : ''))`.
- Rust `CloseRequested` in `apps/desktop/src-tauri/src/main.rs` asks the webview (`marxy:close-requested`) and closes only on `quit` or `close_confirmed`. Keep the `RunEvent` import. MARXY-240 adds one invoke line, `commands::os::open_external`, in the same list; a rebase must keep both.
- Rust: `set_title`, `save_dialog` (`tauri-plugin-dialog`, MIT/Apache-2.0); map `atomic_write.rs` refusal strings to `ShellError { code: 'permission' | 'io' }` (add a `kind` to the error the module returns rather than parsing messages).
- Tests: `apps/desktop/test/save.test.mjs` (app harness), Rust tests for the error mapping, `pnpm gate:fidelity` extended with save-after-operation.
- `apps/desktop/src/app.ts` — wire save and close into the open document. `commitEdit` does not write. The watch echo after save uses `savedHash`. Title refresh goes through `title.ts`.
- `apps/desktop/src/commands/edits.ts` — stop the operation path from calling `writeFileAtomic`.
- `apps/desktop/src/main.ts` — close goes through the close handler, not a write on the way out.
- `apps/desktop/test/operations-edit.test.mjs` — the harness toggle records no write until `Mod+S`.
- `apps/desktop/src-tauri/capabilities/default.json` — the dialog and write permissions save needs.
- `packages/shell-api/src/index.ts` — `onCloseRequested(cb: () => void): void` and `confirmClose(): Promise<void>`, including the compile-time stub. ADR-0041, on this branch, is the record. Do not mark a second ADR.
- `docs/adr/0041-shell-close-confirmation.md` — the ADR already on the branch. Land it with this story. Do not edit an accepted ADR on main; this file is not on main yet.
- `docs/adr/README.md` — one index line for ADR-0041.
- `scripts/registry.json` — event `marxy:close-requested`.
- `packages/core/src/buffer/buffer.test.ts` — the fidelity-gate exemption also matches a diff that contains `apps/desktop/test/save.test.mjs`.

## Do this, in order
The worktree already has save, close, title, the Rust commands and `save.test.mjs`. Do not rewrite them. PR #278 is red on ubuntu gates because `main.rs` no longer imports `RunEvent` after the rebase. Restore that import and keep `commands::os::open_external` if the other branch added it. Drop this branch's edit of `docs/plan/jira-issues.csv`.

1. Restore the `RunEvent` import. Leave the save and close implementation in place.
2. Keep `onCloseRequested` and `confirmClose` on `Shell`, ADR-0041, and the `marxy:close-requested` registry event.

## Tests → expected
| Check | Expect |
| --- | --- |
| harness: toggle a task in `12-crlf-and-bom.md` copy, `Mod+S` | one `writeFileAtomic` recorded; written bytes differ from the original only inside the marker range; BOM and every `\r\n` intact |
| harness: `Mod+S` when clean | no write recorded |
| harness: Source mode, edit one line in a CRLF file, `Mod+S` | written bytes: that line changed, every line ending CRLF |
| harness: save refused (memory shell rejects `permission`) | persistent notice "Could not save … read-only." with Save as…; `saveDialog` queued path → write to it; title name updated |
| harness: watch echo after save | no reload, no conflict notice |
| title | ` •` after edit, gone after save, gone after undo to saved version |
| close while dirty | notice with both actions; second close request closes; "Save and close" writes then closes |
| `pnpm gate:fidelity` | the save-after-operation property green over the corpus (bytes outside the operation range identical on disk) |
| Rust | read-only target → `permission`; hard-linked → `permission` with the module's message; atomic rename verified by the existing module tests |

## Acceptance → check
CSV: save after an operation changes only the operation range → fidelity gate; unsaved state without chrome → title tests (and the DOM chrome-at-rest assertion still green); atomic rename verified → Rust tests + one write recorded.

## Do not
Autosave. Write when clean. Take bytes from CodeMirror when the text did not change. Show a native dialog for anything but the save-as file picker. Add a dirty indicator anywhere but the title. Edit `docs/plan/jira-issues.csv` in this story's pull request. Touch `packages/*/src/contracts/**`.
