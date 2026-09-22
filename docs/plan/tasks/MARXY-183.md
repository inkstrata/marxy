---
key: MARXY-183
design: [06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-183]
---
# MARXY-183 — Single instance, second launches, and macOS/Linux open events route to the running window

**Design:** [06-shell](../../design/06-shell.md) §Single instance and second launches ·
**Depends on:** nothing · **Delta:** [2026-09-21-mac-shell-gaps](../deltas/2026-09-21-mac-shell-gaps.md) ·
**ADRs:** none changed — this implements an already-frozen `packages/shell-api` member
(`onOpenFiles`), it does not extend the contract.

**Outcome.** A second `marxy other.md` launch, a Finder double-click/"Open With → marxy" on a
`.md` file, and a drag onto marxy's Dock icon while it is already running all reach the running
window and replace its open document — none of the three exists today: `Cargo.toml` carries no
Tauri plugins, and `apps/desktop/src/render/stub.ts`'s `onOpenFiles` is a no-op. `docs/design/06-shell.md`
already specifies the mechanism (`tauri-plugin-single-instance` + `RunEvent::Opened`) and
mis-credits it to MARXY-33, which shipped the cold-start waterfall instead — this story builds
the mechanism for real and corrects that doc reference (criterion 5).

## Files and signatures
- `apps/desktop/src-tauri/Cargo.toml` — add `tauri-plugin-single-instance`.
- `apps/desktop/src-tauri/src/main.rs` — `.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| { … }))`
  forwarding `argv`/`cwd` to the running instance; a `RunEvent::Opened { urls }` arm in the
  builder's `run` closure for macOS Finder/Dock opens.
- `apps/desktop/src-tauri/capabilities/default.json` — whatever permission the single-instance
  plugin's docs require (usually none beyond the plugin being registered; check the plugin's
  own README before adding anything not named there).
- `apps/desktop/src-tauri/tauri.conf.json` — `bundle.macOS.fileAssociations` (or the Tauri 2
  equivalent key) declaring `.md`/`.markdown` as document types; the Linux side of the same
  declaration (`.desktop` `MimeType=text/markdown`) if `tauri.conf.json` carries it, else note in
  the PR body which packaging file (MARXY-16's `.deb`/`.AppImage` config) needs the matching line
  and leave a one-line TODO there rather than editing a file outside this story's `Paths`.
- `apps/desktop/src/shell/tauri.ts` — replace the stub `onOpenFiles` wiring with
  `listen('marxy:open-files', cb)`, matching the frozen `Shell` signature exactly (no new
  members — `onOpenFiles` is already in `packages/shell-api/src/index.ts`).
- `apps/desktop/src/render/stub.ts` — the no-op `onOpenFiles` stays as the memory-shell's
  implementation (used by non-Tauri tests); do not delete it, only stop it being the only one.
- `apps/desktop/src/app.ts` — wherever the app currently opens the CLI-argument path on launch,
  register `onOpenFiles` so a later event replaces the open document the same way.
- `docs/design/06-shell.md` — the single-instance/`RunEvent` rows' `Story` column corrected from
  MARXY-33 to MARXY-183 (criterion 5).

## Do this, in order
1. Add the plugin dependency (Cargo + `main.rs`); confirm with `cargo test` that the app still
   builds and that a single-instance app registers under the identifier `tauri.conf.json` already
   sets — the plugin needs no new identifier of its own.
2. Wire the plugin's callback to emit `marxy:open-files` with the same payload shape
   `onOpenFiles`'s existing type expects (check `packages/shell-api/src/index.ts` for the exact
   signature before writing the Rust side; do not invent a shape).
3. Add the `RunEvent::Opened` arm for macOS Finder/Dock opens, emitting the same event so both
   paths converge on one Rust→TS boundary.
4. Declare the document type association in `tauri.conf.json`.
5. Replace the stub in `apps/desktop/src/shell/tauri.ts`.
6. Write `apps/desktop/test/single-instance.test.mjs` (or extend `shell-boundary.test.mjs` if that
   is the house pattern for a shell-boundary test — check before adding a new file) driving all
   three entry points against a fake shell and asserting the same open-document code path runs
   for each (criterion 4).
7. Fix the `docs/design/06-shell.md` reference.

## Tests → expected
| Check | Expect |
| --- | --- |
| second launch with a fake single-instance callback firing `argv=["marxy","other.md"]` | the fake shell's `onOpenFiles` handler receives `other.md` and the app state opens it, replacing whatever was open |
| `RunEvent::Opened` fake with a file URL | same code path, same assertion |
| Dock-drop fake (same as `RunEvent::Opened` on macOS — no separate Rust path) | same assertion; the test may just be a second case over the same fake, since criterion 3 says Dock-drop-while-running is indistinguishable from a Finder open |
| `apps/desktop/test/shell-boundary.test.mjs` | still green; `onOpenFiles` still referenced only from `src/shell/tauri.ts` |
| `docs/design/06-shell.md` | single-instance/`RunEvent` rows say MARXY-183, not MARXY-33 |

## Acceptance → check
The five criteria on the CSV row, in order: (1) second-launch forwarding + focus + document
replace; (2) document-type association reaching the same open path as (1); (3) Dock-drop running
vs. not-running, both converging on the same path as (1)/CLI-open; (4) `onOpenFiles` implemented
for real, one test driving all three entry points against a fake shell; (5) the design-doc
correction.

## Do not
Add a second window, a tab, or any multi-document UI — v1 is one window; every one of these
entry points **replaces** the open document. Add a new `shell-api` member — `onOpenFiles` already
exists; if its signature turns out to be wrong for what the plugin actually delivers, stop and
say so rather than routing around the contract with an extra field (that needs ADR-0026, not this
story). Touch `apps/desktop/src-tauri/Cargo.toml`'s other dependencies. Edit
`docs/plan/jira-issues.csv` or `orchestration/deps.json` on this branch — this card's `depends: []`
already matches `deps.json`.
