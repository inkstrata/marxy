---
key: MARXY-244
design: [09-app-shell, 06-shell, 03-selection-and-operations]
depends: [MARXY-48]
verify: [pnpm precheck, pnpm done MARXY-244]
---
# MARXY-244 — Every command reachable from the keyboard, and open the file in the reader's editor at the line

**Design:** [09-app-shell](../../design/09-app-shell.md) §Keyboard map, §Open in external editor, §Keyboard completeness · [06-shell](../../design/06-shell.md) `revealInExternalEditor` → `reveal_in_editor` · [03-selection-and-operations](../../design/03-selection-and-operations.md) §The command registry · **Depends on:** MARXY-48 (the outline and find overlays this audit covers, and `commands/index.ts`, which both stories edit) · **ADRs:** ADR-0006 (the `toml` crate is MIT/Apache-2.0), ADR-0011, ADR-0026 · **Delta:** [2026-09-26](../deltas/2026-09-26.md) · **Sequencing:** `cross-phase`. `ready.mjs` holds it by path against MARXY-195, MARXY-196, MARXY-97 and MARXY-45 (`src-tauri/src/main.rs`, `src-tauri/src/commands`, `shell/tauri.ts`) while any of them is in progress.

**Outcome.** Nothing in Marxy needs a pointer, and a test proves it over the command list. `Mod+Shift+E` opens the file in the reader's editor at the line they are reading, and a path containing spaces or `;` can never become a shell command.

**Where this came from.** The second half of MARXY-48, split on 2026-09-26. `revealInExternalEditor` already exists in `packages/shell-api` and in the memory shell, so no contract changes. A draft from MARXY-48's first attempt is saved at the local ref `refs/wip/MARXY-48`. Read files from it with `git show refs/wip/MARXY-48:<path>`: `src-tauri/src/commands/os.rs`, `commands/app.ts`, `test/keyboard.test.mjs`, and the `shell/tauri.ts` and `commands/registry.ts` hunks. It is a starting point, not a pass. Its `chordMatches` in `palette/keys.ts` duplicates `selection/bind.ts` `keyMatches`, which MARXY-48 fixes; drop it.

## Files and signatures
- `apps/desktop/src/commands/app.ts`: `appCommands()` with `editor.reveal` (`Mod+Shift+E`). It computes `line` as design §09 says: in Rendered mode, the 1-based buffer line of the reading position's block start; in Source mode, the cursor's line.
- `apps/desktop/src/commands/registry.ts`: `AppContext.shell` gains `revealInExternalEditor`.
- `apps/desktop/src/commands/index.ts`: add `...appCommands()`.
- `apps/desktop/src/palette/keys.ts`: history travel binds through the registry (§03, last paragraph). No chord string lives here unless it is also a command `key`.
- `apps/desktop/src-tauri/src/commands/os.rs`: `reveal_in_editor(path, line)` reads only `external_editor` from `config.toml` on each call (the `toml` crate). A pure `editor_argv(template: Option<&str>, file: &str, line: Option<u32>, os: Os) -> Vec<String>` splits on whitespace **without a shell** and substitutes `{file}`/`{line}` inside tokens; with no template it returns the platform opener. The command spawns with `std::process::Command`, detached. Register it in `commands/mod.rs` and `main.rs`'s `generate_handler!`.
- `apps/desktop/src/shell/tauri.ts`: `revealInExternalEditor` invokes `reveal_in_editor`. On error the app shows the §09 notice text.

## Do this, in order
1. `editor_argv` and its cargo tests, then `reveal_in_editor`, the `Cargo.toml`/`Cargo.lock` entry and registration.
2. `shell/tauri.ts` plus the `editor.reveal` command and its notice on failure.
3. `keys.ts` binds history through the registry, with `keys.test.ts`.
4. `keyboard.test.mjs`, the audit over `commands()`.
5. The accessibility checklist from §09, pasted into the PR body.

## Tests → expected
| Check | Expect |
| --- | --- |
| cargo: `editor_argv(Some("code --goto {file}:{line}"), "/a b;c.md", Some(12), _)` | `["code", "--goto", "/a b;c.md:12"]` |
| cargo: `editor_argv(None, "/x.md", Some(3), MacOs)` / `Linux` | `["open", "-t", "/x.md"]` / `["xdg-open", "/x.md"]` |
| cargo: a spawn failure | `Err`, no panic; no `sh`/`-c` token in any argv |
| `keys.test.ts` | every chord in `keys.ts` is some command's `key` |
| `keyboard.test.mjs` | every command with a `key` runs from a synthetic keydown; every command is listed in the palette when `when` holds; `Tab` reaches the article, then its links in order, never an invisible element; `Esc` returns focus to the article from the palette, the outline and find |
| `keyboard.test.mjs`: `Mod+Shift+E` in `01-long-technical.md` scrolled to a heading | memory shell records `revealInExternalEditor` with the open path and that heading's 1-based line |

## Acceptance → check
CSV 1 → `keyboard.test.mjs` audit. 2 → `keys.test.ts`. 3 and 4 → cargo tests. 5 → the `Mod+Shift+E` case. 6 → PR body checklist. 7 → `pnpm check:boundaries`, `gate:no-network`, `CHANGELOG.md`.

## Do not
Pass the template through `sh -c` or any shell. Read any `config.toml` key other than `external_editor`. Add a second chord matcher (use `selection/bind.ts` `keyMatches`). Add single-letter bindings. Edit `outline/`, `find/`, `app.ts` or `selection/bind.ts` (MARXY-48's). Touch `packages/*/src/contracts/**`.
