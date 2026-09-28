---
key: MARXY-293
design: [06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-293]
---
# MARXY-293 — Give allow_asset_scope a real containment check against the open document's root

**Design:** [06-shell](../../design/06-shell.md) · **ADRs:** ADR-0027 (remote images and local-image containment through the shell) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** allow_asset_scope refuses a directory outside the open document's root instead of granting a recursive read scope to anything that exists.

## Why
`allow_asset_scope` (`fs.rs`) calls `scope_directory`, which only checks `dir.is_dir()`, then grants the Tauri asset-protocol scope recursively for that directory. ADR-0027 §5 says local images resolve within the image root and "the shell's asset scope is the image root ... so the scope and the app's path check are the same rule" — but the Rust side never checks that rule itself; it trusts the caller entirely. The one caller today (`render/images.ts`) always passes the open document's own directory, so this is not reachable through the current call graph, but the command has no backstop of its own, and the Rust shell doesn't currently track "the open document's root" at all — that lives only in the JS layer (`app.ts`'s `openPath`/`documentDir`).

## Files and signatures
- `apps/desktop/src-tauri/src/commands/fs.rs`: `scope_directory` (or `allow_asset_scope`) checks `dir` against a tracked document root, refusing anything outside it.
- `apps/desktop/src-tauri/src/main.rs`: a way for the Rust side to know the current document root — likely set alongside whatever the shell already does when a document opens (check `open_file`/the existing IPC surface for the right hook rather than inventing a new one).

## Tests → expected
| Check | Expect |
| --- | --- |
| `allow_asset_scope` with a dir outside the tracked root | refused (`ShellError`), not silently granted |
| `allow_asset_scope` with the tracked root itself, or a subdirectory of it | succeeds as today |

## Acceptance → check
Row acceptance 1–4, checked by the new Rust tests and `pnpm precheck`.

## Do not
- Change the `Shell`/`shell-api` TypeScript interface — `allowAssetScope(dir: string): Promise<void>` keeps its signature; this is a Rust-side validation tightening only.
