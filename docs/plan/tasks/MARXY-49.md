---
key: MARXY-49
design: [01-buffer, 09-app-shell, 06-shell, 08-position-and-watching]
depends: [MARXY-43, MARXY-37, MARXY-34, MARXY-94]
verify: [pnpm precheck, pnpm done MARXY-49]
---
# MARXY-49 — Explicit save, byte-faithful and atomic, from either mode

**Design:** [01-buffer](../../design/01-buffer.md) §Dirty state and the disk, §Save · [09-app-shell](../../design/09-app-shell.md) §Window title, §Notices · [06-shell](../../design/06-shell.md) `writeFileAtomic`, `setTitle`, `saveDialog` · [08-position-and-watching](../../design/08-position-and-watching.md) (own-write detection) · **Depends on:** MARXY-43 (edits exist), MARXY-37 (Source mode edits), MARXY-34 (watch, `savedHash`), MARXY-94 · **ADRs:** ADR-0004, ADR-0001.

**Outcome.** After toggling a task or editing in Source mode, the title shows ` •`; `Mod+S` writes exactly the new bytes, atomically, and the dot goes. Nothing else about the file changes. Closing with unsaved changes asks once, in a notice, never a modal.

## Files and signatures
- `apps/desktop/src/shell/save.ts` — `save(ctx, opts?)` per §01 §Save.
- `apps/desktop/src/commands/document.ts` — `save` (`Mod+S`), `save-as` (`Mod+Shift+S`); one line in `commands/index.ts` if the file is new.
- `apps/desktop/src/title.ts` — `updateTitle(state)` → `shell.setTitle('<name> — marxy' + (dirty ? ' •' : ''))`.
- Close interception: Rust `CloseRequested` handler that asks the webview (`marxy:close-requested` event) and closes only on `quit`/`close_confirmed`; app side in `apps/desktop/src/shell/close.ts`.
- Rust: `set_title`, `save_dialog` (`tauri-plugin-dialog`, MIT/Apache-2.0); map `atomic_write.rs` refusal strings to `ShellError { code: 'permission' | 'io' }` (add a `kind` to the error the module returns rather than parsing messages).
- Tests: `apps/desktop/test/save.test.mjs` (app harness), Rust tests for the error mapping, `pnpm gate:fidelity` extended with save-after-operation.

## Do this, in order
1. Error kinds from `atomic_write.rs` → `ShellError`.
2. `save()` and the two commands; the Source-mode fold (§09 leaving Source) before writing.
3. Title.
4. Close interception and the notice.
5. Own-write: after save, the watch echo (same `savedHash`) is ignored — assert it.

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
Autosave. Write when clean. Take bytes from CodeMirror when the text did not change. Show a native dialog for anything but the save-as file picker. Add a dirty indicator anywhere but the title.
