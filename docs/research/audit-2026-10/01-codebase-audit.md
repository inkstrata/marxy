# 01 — Codebase audit

**Date:** 2026-10-01. **Scope:** the product code only: `packages/core`, `packages/typeset`,
`packages/theme`, `packages/shell-api`, `apps/desktop/src` (TypeScript) and
`apps/desktop/src-tauri/src` (Rust), at `origin/main` `4526b811`. Scripts, the orchestrator and the
documentation appear only where they shape product code.

**Abstract.** Marxy's product code is about 22,500 lines, carefully written, strictly typed, and green:
typecheck, lint, 1,191 passing unit and browser tests and `cargo check` all pass. The core idea is real.
Every AST node carries byte provenance, it reaches the DOM on attributes a document cannot forge, and
operations splice the buffer through it. What a reader can do end to end is narrower than the code
suggests. Just over half of the v1 scope list (17 of 31 items) is shipped and reachable. The rest is built but not wired
(outline, light theme, text size, several palette commands), half-built (remote-image grants that can
never load anything), or missing (find in Rendered mode, external editor). Two defects matter more than
any gap. The palette's index is delivered once and never again, so a launch without a document, or a
second repository, leaves search empty. And every edit re-walks the whole repository and throws the
result away. The architecture is sound below the app and weak at the top. `apps/desktop/src/app.ts` is a
1,399-line module with 33 module-level variables and about ten responsibilities. The one-document-store
decision (ADR-0037) that would fix it is proposed and unimplemented. Single-document state is spread over
seven modules. That, not the no-tab-bar rule, is what stands between today's code and split view and
collections. The recommendation is to fix the two defects, build the store for N documents, wire what is
already built, and delete about 1,700 lines of dead or parallel code before adding features.

---

## Findings at a glance

The ranked list is in "For the synthesis" at the end. In short:

- **Two defects.** The palette's index is delivered once and never again (§1.3). Every render re-walks the
  repository and discards the result (§1.3).
- **Distance to v1.** Of 31 scope items, 17 are shipped and reachable, 4 are built but not reachable,
  5 are partial and 5 are missing (§1.4).
- **Architecture.** Provenance is real (§2.1). `app.ts` is a god module, and ADR-0037's store is unbuilt
  (§2.2, §2.3).
- **Dead and parallel code.** About 1,700 lines can go, including an uncompiled Rust indexer and a second
  render pipeline that the aesthetics gate measures (§3.2).
- **Over-fit.** The no-network posture costs roughly 1,100 to 1,300 lines of app code beyond the sanitiser. The
  frozen contracts are routed around (§6).
- **Health.** Everything is green (§5).

---

## 1. What a reader can actually do today

### 1.1 How the app is assembled

The path runs as follows.

- **`main.ts:9-19`.** `bootApplication` calls `startApp` and mounts the palette. On the real shell it
  also maps native menu ids to replayed key chords.
- **`startApp` (`app.ts:1304-1399`).** It resets module state, wires save, the close guard, open-files
  and the trust commands, then runs `boot` in the `serially` queue.
- **`boot` (`app.ts:1232-1297`).** With no file, it shows a passage from the bundled Commonplace (38
  pieces). With a file, it runs read → `createBuffer` → `parseMarkdown` → `renderDocumentSafeHtml` →
  `innerHTML` → notices → grid pass, then waits for a real paint and emits `first_text`.
- **`finishDocumentOpen` (`app.ts:1120-1141`).** It typesets and restores the persisted position. At
  idle it runs `runDeferredStartup`: images, KaTeX, Shiki in a worker, then the index walk. After that it
  loads the user theme, registers the watch and sets the title.
- **Input** is handled by four separate keyboard listeners:
  - the palette's `Mod+P`, pin and history keys (`palette/view.ts:457-490`);
  - `Mod+E` (`app.ts:314-323`);
  - link back-navigation (`selection/view.ts:108-121`);
  - the registry dispatcher (`selection/bind.ts:66-93`), which runs only commands that have a `key`.

  The palette's `>` mode lists only `op.*` commands (`palette/view.ts:91-95`). A command with no key is
  therefore reachable from no UI.
- **The shell** has 18 commands (`main.rs:815-834`). A native menu exists on macOS only (`main.rs:536-703`).

### 1.2 Capability inventory

"Reachable" means a person can trigger it from the built app with keyboard, mouse or the OS. "Built,
not reachable" means the code exists and is tested, but only a test harness can call it.

| Capability | Status | Evidence |
| --- | --- | --- |
| Open a file from argv, second launch, Finder/`open -a`, file association | Shipped | `app.ts:1238-1260`, `main.rs:795-797` (single-instance), `main.rs:851-860` (`RunEvent::Opened`), `tauri.conf.json` `fileAssociations` |
| Open File… dialog | Shipped on macOS only | `main.rs:703-723`; no menu on Linux |
| Drag a file onto the window | Missing | no `drag-drop` listener in `apps/desktop/src` or `main.rs` |
| Launch with no document | Shipped (frontispiece) | `app.ts:1251-1257`; palette index empty for the session (§1.3) |
| CommonMark + GFM, frontmatter, math, alerts | Shipped | `packages/core/src/parse`, `render/alerts.ts`; the 652 spec examples need a developer-fetched file (`conformance.test.ts:3-5`) |
| Sanitised HTML; per-document "show HTML" opt-in | Shipped | `sanitize/`, `notices/blocked.ts`, `trust/trust.ts` |
| Remote images: blocked with a notice | Shipped | `render/images.ts` (desktop) `stripNonLocalImages` |
| Remote images: per-host grant | Half-built: the grant persists, nothing loads | no `fetchRemoteImage` in `shell/tauri.ts`; notice text "Images will load when Marxy can fetch them." (`notices/blocked.ts:203-206`) |
| Revoke HTML or image grants | Built, not reachable | `commands/trust.ts` has no `key`; the palette lists only `op.*` (`palette/view.ts:91-95`); only `test/trust.test.mjs:230` calls it |
| Local images with reserved dimensions | Shipped | `render/images.ts`, `commands/fs.rs` `image_size` |
| Code highlighting (24 grammars, 47 aliases) | Shipped; no language detection | `highlight/languages.generated.ts`; `render/highlight.ts:111` "no colour is guessed" |
| KaTeX on first use | Shipped | `render/math.ts:69` dynamic import |
| Knuth–Plass ragged-right, hanging punctuation, hyphenation | Shipped | `packages/typeset`, `app.ts:948-970` |
| Baseline grid | Shipped | `typeset/src/grid.ts`, `app.ts:630-762` |
| Rendered ↔ Source toggle with position kept (`Mod+E`) | Shipped | `app.ts:256-300` |
| Code files open in Source | Shipped | `source/default-mode.ts` |
| Find in Source | Shipped (CodeMirror search) | `source/editor.ts:110,144` |
| Find in Rendered (`Mod+F`) | Missing | `#marxy-find` in `index.html:29` is never populated |
| Outline (`Mod+Shift+O`) | Built in core, not wired | `core/src/outline/outline.ts` exports `outlineFrom`; nothing in `apps/desktop/src` imports it; `#marxy-outline` (`index.html:28`) is empty |
| Palette: fuzzy over titles, headings, paths | Shipped for the first document's repository only | §1.3 |
| MRU, pins, back/forward | Shipped | `palette/session.ts`, `palette/history.ts`, `palette/keys.ts` |
| Reading position across launches | Shipped | `position/`, `PositionPersistence` |
| Live reload with position, rename follow, delete notice | Shipped | `app.ts:823-905` |
| Relative markdown links open in Marxy, with back | Shipped inside the document's directory only | `selection/view.ts:150-165`; `imageRoot = documentDir` (`render/images.ts:25`) |
| Node selection, parent, next and previous block | Shipped | `commands/selection-nav.ts` |
| Span selection that operations can act on | Missing | `Selection` `text` kind carries a string, no byte range (`selection/selection.ts:11`); `operationInputFor` returns null for it (`selection/input.ts:13-15`) |
| Copy section, copy code clean (`Mod+C`, palette `>`) | Shipped | `selection/bind.ts:70-82`, `core/src/operations` |
| Toggle task (click), align table pipes (palette `>`) | Shipped | `render/tasks.ts`, `operations/align-table-pipes.ts` |
| Undo/redo of operations (`Mod+Z`, `Mod+Shift+Z`) | Shipped | `commands/document.ts`, `commands/edits.ts` |
| Save, Save As; close guard | Shipped | `save.ts`, `close.ts` |
| Toggle line numbers in Source | Built, not reachable | `commands/source-view.ts:39` has no key; only `window.marxyRunCommand` in a test calls it |
| Jump to source from a selection | Built, not reachable | same file, line 59 |
| User theme from `config.toml` `theme =`, live reload | Shipped | `theme/user-theme.ts` |
| Light variant | Built, not reachable | CSS in `packages/theme/default/theme.css`; `index.html` hardcodes `data-marxy-variant="dark"`; config `variant` is parsed (`theme/src/config.ts:68-70`) but the app reads only `theme` (`user-theme.ts:153-164`); only `render/headless.ts:307` applies a variant |
| Text size (`Mod+=`/`-`/`0`, config `size`) | Built (config parse), not reachable | parsed in `config.ts:72-74`; applied only in `render/headless.ts:315` |
| Linux weight offset | Shipped as a constant guess | `app.ts:1236` passes `null` version, so Linux always gets 100 (`theme/offset.ts:17-23`); `webkitVersion` is unimplemented |
| Open in external editor (`Mod+Shift+E`) | Missing | `revealInExternalEditor` unimplemented in `shell/tauri.ts` |
| About document | Missing (native macOS About only) | `main.rs:678` |
| Window controls hidden at rest (ADR-0038) | Missing | contract member `setWindowControls` added; no implementation, no `titleBarStyle` in `tauri.conf.json` |
| Settings UI, content search, split, multiple windows | Not in v1 scope; absent | — |

### 1.3 Two defects, reproduced

Both come from the same seam: the index is idle-time startup work, not a service with an owner.

**The palette never sees a second index.** `main.ts:11-14` creates a local `indexEntries`, passes a
callback that overwrites it, and calls `palette.setIndexEntries` once after `startApp` resolves. Any later
index build lands in the local variable. A probe built the palette harness (`test/palette-boot.html`)
and ran three scenarios over a memory shell with repositories `/a` and `/b` ([C9]):

```
control: launch with /b/README.md: query="notes" rows=1 ["Notes"]
launch with no document, then open /b/README.md: query="notes" rows=0 []
launch with /a/README.md, then open /b/README.md: query="notes" rows=0 []
```

The reader-facing consequences:

- Launching Marxy from the Dock or the app launcher, then opening a file, leaves "jump between documents"
  empty for the whole session.
- Opening a document in a second repository searches the first one.
- On Linux, a no-document launch has no menu and no drag target. The only way to open anything is a
  second command-line launch or a file-manager double-click.

**Every render re-walks the repository.** `rerenderFromBuffer` and `rerenderOpenDocument`
(`app.ts:550-572`, `976-992`) both schedule `runDeferredStartup`. Its `index` step walks the root with
one `readDir` IPC call per directory. It reads every `.gitignore` and every markdown file
(`idle-work.ts:141-176`, `228-268`). The same probe, with three in-memory edits through
`handle.commitEdit` ([C10]):

```
three in-memory edits (commitEdit): {"before":{"index_loaded":1,"readDir":2,"readFile":3},"after":{"index_loaded":4,"readDir":8,"readFile":7}}
```

Each checkbox tick, Source fold, trust grant and live reload costs one full repository walk, and the
result is discarded. In the real shell each `readFile` also keeps a full copy of the bytes in
`lastRead` for the session (`shell/tauri.ts:95`). So a walk holds every markdown file in memory.
Timing on a large repository is the performance agent's measurement. The structure is the bug.

### 1.4 The v1 scope list against the inventory

Each "v1 ships" clause of `docs/scope.md` is split into its separable items.

| Scope item (`docs/scope.md`) | Today |
| --- | --- |
| Open by argument, double-click, `open -a` | Shipped |
| Open by drag | Missing |
| Watch and live-reload with position, atomic replace, delete, move | Shipped |
| CommonMark + GFM passing the spec suite | Shipped; the spec suite is not in CI |
| Byte-faithful save | Shipped |
| HTML sanitised; discoverable per-document opt-in | Shipped |
| Rendered default and Source; instant switch with position | Shipped |
| Markdown opens Rendered; code opens Source | Shipped |
| Index the enclosing repository with ignore rules | Partial: first document only (§1.3) |
| Palette over titles, headings, paths, per keystroke | Partial: same |
| MRU, pinning, back and forward | Shipped |
| Reading position across launches | Shipped |
| Operations mechanism + four operations, palette-reachable, single-step undo | Shipped |
| ~20 grammars with language detection | Partial: 24 grammars, no detection |
| Soft-wrap with hanging indent; copy clean | Shipped |
| Images with reserved dimensions | Shipped |
| Remote images blocked with a visible opt-in | Partial: blocked; the opt-in loads nothing |
| KaTeX on first use, on the grid | Shipped |
| Knuth–Plass ragged-right, hanging punctuation, hyphenation | Shipped |
| Bundled Literata and JetBrains Mono | Shipped |
| Linux weight offset | Built as a constant; the measured table is unused |
| Default dark theme on the type scale | Shipped |
| Light variant | Built, not reachable |
| User themes under the contract | Shipped |
| Outline, summoned, tracking scroll | Built in core, not wired |
| Find landing at the reading position in Rendered | Missing |
| Full keyboard navigation | Partial: no outline, find, size or external-editor keys |
| Open in external editor | Missing |
| macOS signed, notarized DMG | Missing: release builds unsigned until secrets exist (`.github/workflows/release.yml:28-45`); no tag or release exists ([C11]) |
| Linux AppImage | Built by the release workflow, never released |
| Flatpak | Missing (`tauri.conf.json` targets `dmg`, `appimage`, `deb`) |
| *Text size (design §09 keymap)* | Built (config parse), not reachable |
| *About surface with attributions (plan phase 4)* | Missing |
| *Window chrome zero at rest (brief, design-language constraint 6)* | Missing |

**Tally.** The first 31 rows come from `docs/scope.md`. Of those, 17 are shipped, 5 partial, 4 built but
not reachable or applied (the weight-offset table, the light variant, the outline, and an AppImage that
was never released), and 5 missing. The last three rows come from the design keymap, the phase 4 plan and
the brief. They add 1 built item (text size) and 2 missing ones. Nothing on the list is blocked by an unknown. Each missing item has a
design section, and most have core code already.

The gap AGENTS.md admits ("the machinery is further along than the product") is visible in the
proportions. Product source is 22,474 lines. Tests next to it are 18,714 lines, plus 8,504 lines of
browser tests. `scripts/` holds 14,797 lines and `orchestration/` 15,406 ([C1]). Of 4,126 file changes on
`main`, 701 (17%) touched product source ([C12]).

---

## 2. Architecture as built vs as designed

### 2.1 What follows the design

| Design point | In code | Verdict |
| --- | --- | --- |
| ADR-0003: one buffer, one AST, byte provenance on every node | `core/src/contracts/ast.ts`; `parse/invariants.ts` checks it over the corpus and generated cases; `buffer/buffer.ts` splices | Real |
| ADR-0023: provenance on attributes a document cannot forge | `render-html.ts:51-53` `prov()` on every element made for a node, inline included; the sanitiser strips `data-marxy-*` from document HTML (`sanitize/policy.ts:296`) | Real |
| ADR-0004: editing is a pure `string → string` over a byte range | `contracts/operation.ts`; four operations at 21–166 lines each | Real, and cheap to extend |
| ADR-0020: core and typeset are shell-free | `scripts/check-boundaries.mjs`; core has no DOM imports | Real |
| ADR-0018: reading position is a source coordinate | `position/`, `app.ts:1063-1077` | Real |
| D-A35: `main.ts` is `startApp(shell)`; behaviour tested through a memory shell | `main.ts`, `shell/memory.ts`, `harness/app-harness.ts` | Real |
| D-A15: Source is CodeMirror 6, bytes kept unless edited | `source/buffer-commit.ts`, `app.ts:264-287` | Real |

Provenance is the asset. Byte ranges reach the DOM, a click resolves to a node, the node to a range, and
the range to a splice. Collections, split view and click tools all need exactly this, and it exists.

### 2.2 Where the code has drifted or the design is unbuilt

| Design point | Code | Gap |
| --- | --- | --- |
| ADR-0037 (proposed): one store owns the open document; changes are transitions; `dispatch` reaches them | `apps/desktop/src/document/` absent; `AppHandle.dispatch` is `dispatch() {}` (`app.ts:1346`) | Unbuilt. Document state lives in `app.ts` (33 `let`s), `selection/view.ts` (10), `commands/edits.ts` (4), `save.ts`, `close.ts`, `palette/history.ts`, plus `window.__marxyPalette`, `__marxyJumpCarrier`, `__marxyOpenSynced` and others ([C5]) |
| §09: `apps/desktop/src/state.ts` holds a state machine | absent | Unbuilt |
| D-A26: every reader action is a `Command` that the palette and key map both read | The palette lists only `op.*`; `Mod+E` (`app.ts:314`), `Mod+P` and history (`palette/view.ts:457-490`) and link history (`selection/view.ts:108-121`) are separate listeners | Drifted: four keyboard listeners, and two back-stacks on the same chord |
| D-A16 / §07: index walked in Rust with `ignore`, matched with `nucleo`, persisted per root, refreshed in the background | A TypeScript walk over `readDir` IPC (`idle-work.ts`, MARXY-196); no persistence (core's `index-model/persist.ts` is unused by the app); no refresh | Drifted; the Rust index (`src-tauri/src/index/mod.rs`) was written (MARXY-35) and never wired |
| D-A23: image root is the repository root | `imageRoot: documentDir` (`render/images.ts:25`) | Drifted; it also confines relative links to the document's directory |
| D-A22 / ADR-0027 (proposed): the shell fetches granted remote images | `fetchRemoteImage` is in the frozen contract and the memory shell, not in Tauri | Unbuilt, with a UI that suggests otherwise |
| D-A9: weight offset keyed to the runtime WebKitGTK version | `webkitVersion` unimplemented; `null` passed (`app.ts:1236`) | Unbuilt |
| ADR-0038 (accepted): window controls hide at rest | contract member only | Unbuilt |
| §00 "No web workers in v1" | Shiki runs in `render/highlight.worker.ts` | Drifted, for the better |
| D-A33: "About" is a bundled markdown document | absent | Unbuilt |

### 2.3 `app.ts` is a god module

```
1,399 lines; 74 top-level functions; 33 module-level `let`; 34 distinct import sources   [C4]
```

| Lines (approx.) | Responsibility |
| --- | --- |
| 1–163 | Types: `AppShell` (a frozen-contract `Pick` plus ten more members, two of them outside the contract), `AppHandle` |
| 165–332 | View mode, Source mount, mode toggle, the `serially` queue, the `Mod+E` listener |
| 334–386, 584–605, 1232–1297 | Startup measurement: frame counter, render evidence, harness detection, paint wait, `first_text` |
| 388–579 | Trust: grant, revoke, summary bookkeeping, two re-render paths, notices |
| 607–780 | Grid pass scheduling, reading anchor, resize observer, typesetter lifecycle, teardown |
| 782–905 | Live reload: retries, local-edit detection, rename follow, watch registration |
| 907–992 | Commit edit, title, Source fold, the second re-render path |
| 995–1077 | Reading-position and palette-history persistence |
| 1079–1190 | The open path |
| 1192–1230 | Frontispiece |
| 1299–1399 | `startApp`: wiring save, close guard, open-files, trust commands |

Its state is module-global, so `startApp` resets about fifteen pieces of module state by hand (`app.ts:1312-1330`). There
can be one document per JavaScript realm, and two of anything is impossible without a rewrite. Two
functions re-render from the buffer with near-identical bodies, `rerenderOpenDocument` (`550-572`) and
`rerenderFromBuffer` (`976-992`). A third function named `rerenderOpenDocument`, with different meaning,
lives in `render/tasks.ts:17`. `grantImageHostsForOpenDocument` re-runs the whole render only to recompute
notices (`app.ts:526-528`). `refreshTitle` and `foldSourceIntoBuffer` dynamically import
`commands/edits.ts`, which is already imported statically at the top, so no code is split.

### 2.4 Other structural observations

- **One static import cycle of seven modules:** `commands/document.ts → commands/edits.ts →
  render/tasks.ts → selection/bind.ts → commands/index.ts`, plus `registry.ts` and `save.ts` ([C6]). It
  works because the uses are inside functions. It is the shape a store would remove.
- **Package boundaries are nominal.** 28 desktop files hold 52 deep imports of
  `@marxy/<pkg>/src/...` rather than the package index ([C7]). The most imported are core's
  `index-model/paths.ts`, a general path utility filed under the index (11 imports), and
  `render/images.ts` (10), whose `isInsideImageRoot` also serves as the watch filter in
  `shell/tauri.ts:154`.
- **Test plumbing lives in production modules.** There are 20 distinct `window.__marxy*`/`window.marxy*`
  globals ([C5]) and three mutation switches read from `process.env` (`MARXY_86`, `_87` and `_196`, in
  `palette/search.ts`, `palette/view.ts` and `startup/idle-work.ts`). One of them inserts a tab strip
  into the live DOM (`palette/view.ts:136-147`).
- **The aesthetics gate measures a different page.** `render/headless.ts` (412 lines, entry at `:302`)
  re-implements parse → render → post-passes → typeset for `scripts/gate-aesthetics.mjs` and
  `test/variant-render.test.mjs`. It applies variant and size, which the app does not. It skips
  highlighting, KaTeX, trust notices and the frontispiece, which the app does not. A taste or
  layout-shift result from this path is evidence about this path, not about the app.

---

## 3. Module quality

### 3.1 Per package

```
package | product files | product lines | test lines beside it | largest file         [C2]
```

| Package | Files | Lines | Tests beside | Largest | Cohesion and notes |
| --- | --- | --- | --- | --- | --- |
| `packages/core` | 67 | 6,498 | 8,098 | `sanitize/sanitize-html.ts` (588) | Good. Parse, render, sanitise, operations, outline, position, index-model, highlight. `index-model/paths.ts` and `render/images.ts` are used as general utilities. `position/snapshot.ts` and `sanitize/index.ts` are unreachable from the app. |
| `packages/typeset` | 11 | 1,280 | 230 | `index.ts` (334) | Good, self-contained, with a per-paragraph fallback. The default engine is the in-house `ragged.ts`; `justif/core` breaks lines only when `engine: 'justif'`, which nothing sets (`index.ts:144`), and in practice it supplies the hyphenation patterns (`hyphenate.ts:52-53`). |
| `packages/theme` | 6 | 1,324 | 376 | `base.css` (502) | Good. `css-urls.ts` (284 lines) exists for the no-network rule. `config.ts` parses keys the app ignores. |
| `packages/shell-api` | 1 | 132 | 0 | `index.ts` | Types only. 29 members, 9 unimplemented by Tauri (§6.2). |
| `apps/desktop/src` | 78 | 9,167 | 1,047 (+8,504 in `test/`) | `app.ts` (1,399) | Weak at the top (§2.3). Leaf modules (`palette/search.ts`, `render/*`, `source/*`, `notices/*`) are small and focused. `palette/view.ts` (760) carries about 230 lines of legacy test-only model (`:531-760`). |
| `apps/desktop/src-tauri/src` | 10 | 3,737 (1,179 tests inline) | — | `main.rs` (1,053) | Careful. `atomic_write.rs` (836) preserves ACLs and xattrs. `index/mod.rs` is not compiled. `main.rs` mixes commands, watch table, paint deadline, menu and close logic. |

### 3.2 Dead, unreachable and parallel code

Two methods were used. The first walked static and dynamic imports from `apps/desktop/src/main.ts`
([C3]): 141 of 159 product files are reachable. The second searched for exported names referenced
nowhere else ([C8]): 6 values have no reference anywhere and 8 more are referenced only by tests, out of
629 exports. Unused exports are rare. The dead weight is whole files and whole paths.

| Item | Lines | Status | Action |
| --- | --- | --- | --- |
| `src-tauri/src/index/mod.rs` | 573 | Not declared in `main.rs` (no `mod index;`), so it is not compiled into the app; its 8 tests pass when compiled alone but no CI job runs them ([C13]) | Delete, or wire it as the collection indexer (§7) |
| `render/headless.ts` + `render/stub.ts` + `render/vite.config.ts` | 497 | A second pipeline for gates (§2.4) | Replace with the app harness (`startApp(memoryShell)`) |
| `palette/palette.ts` + `palette/index.ts` + `palette/view.ts:531-760` | ~375 | A legacy palette model and a hand-written headless DOM used only by `palette/*.test.ts` | Delete with those tests; the browser tests cover the live palette |
| `source/mode-toggle.ts` + `source/index.ts` | 71 | Unreachable; only `harness-entry.ts` and a test import them | Delete |
| `core/position/snapshot.ts` + `core/position/index.ts` barrel | 100 | Unreachable from the app | Check, likely delete |
| Unused exports: `notePaletteOpen`, `paletteKeystrokeP95`, `setSelectionRuntime`, `sectionSelection`, `enteringSourceDoc`, `setTabWidthResolver` | small | No reference | Delete |
| `Selection` kinds `section` and `document` | — | Never constructed by the UI (`selection.ts:9-10`); a heading click yields a `node` | Keep `document` if "select all" is added; otherwise trim |
| Mutation switches and `window` hooks | ~60 | Test plumbing in product code | Inject from tests instead |

Total dead or parallel code that can go: about 1,700 lines (573 + 497 + ~375 + 71 + 100 from the rows
above, plus the small items), without touching a feature.

### 3.3 Deferral markers

`scripts/allowlists/deferrals.json` lists two markers, and both are stale. The stories named to remove
them have merged:

| Marker | File | `removedBy` | That story |
| --- | --- | --- | --- |
| "Placeholder until MARXY-34/MARXY-38" | `startup/idle-work.ts:127` | MARXY-196 | merged, `0afcab67` (#229) |
| "Typesetting is a later story" | `core/position/reload.ts:23` | MARXY-23 | merged, `6f2fe95e` (#62) |

There are no `TODO`, `FIXME` or `HACK` markers in product code ([C14]). The real deferrals are carried
by contract members with no implementation (§6.2) and DOM mounts with nothing in them (`#marxy-outline`,
`#marxy-find`).

### 3.4 Error handling and type safety

```
package            any  as-unknown-as  as-never  @ts-directive  getElementById(..)!  `as X` casts  empty catch   [C15]
packages/core        2              0         2              0                    0            18           15
packages/typeset     0              0         0              0                    0            13            0
packages/theme       0              0         0              0                    0             4            3
packages/shell-api   0              0         0              2                    0             0            0
apps/desktop/src     0             13         1              0                   13            78           23
```

- **TypeScript is strict.** Every package's `tsconfig.json` sets `"strict": true`, and `any` is almost
  absent. Casts cluster where the app reaches through `window` for globals (`app.ts:1003`, `1361`;
  `commands/source-view.ts:16`, `65`).
- **Errors are mostly handled on purpose.** A failed post-pass cannot take the page (`guarded`,
  `idle-work.ts:119-125`). A failed open clears all document state and shows the message as text
  (`app.ts:1177-1189`).
- **Many empty catches are deliberate probes** ("no ignore file here", "not a git directory"). Some
  swallow real failures silently: the trust load (`app.ts:411-413`), the theme reload
  (`user-theme.ts:138-142`) and `readOpenFileWithRetry` (`app.ts:796`). A `MARXY_DEBUG` log line would
  help.
- **All 13 non-null `getElementById(…)!` assertions are on `#doc`.** They hard-wire one article per
  window (§7).

### 3.5 Rust

| File | Lines | Tests inline | `unwrap` / `expect` outside tests | `unsafe` | Threads |
| --- | --- | --- | --- | --- | --- |
| `main.rs` | 1,053 | 184 | `table.remove(&key).expect("entry")` (`:336`, guarded by a `get_mut` just above); `.expect("error while building marxy")` (`:836`) | 0 | paint-deadline thread per render (`:396-411`) |
| `atomic_write.rs` | 836 | 374 | none found outside tests | 6, all Linux `listxattr`/`getxattr`/`setxattr` FFI calls (`:301-400`) | none |
| `watch/mod.rs` + `spawn_notify.rs` | 801 | 326 | none found outside tests | 0 | one `notify` thread per watched root, ref-counted in a `Mutex<HashMap>` (`main.rs:249-345`) |
| `commands/fs.rs` | 323 | 152 | none found outside tests | 0 | — |
| `index/mod.rs` | 573 | 122 | — | 0 | not compiled |

The thread model is simple and correct for one window. Commands are synchronous except `save_dialog`,
`watch_root` and `unwatch_root`. Watch threads poll a directory diff on `notify` signals, with a 200 ms
timeout. Global state is three `OnceLock<Mutex<…>>` tables and two atomics. Errors cross IPC as plain
`String` in `read_file`, `watch_root` and `unwatch_root`, and as `ShellError` elsewhere. The TypeScript
side regex-matches the strings (`shell/tauri.ts:37-41`). One oddity: `tauri_plugin_dialog::init()` is
registered twice on macOS (`main.rs:794` and `:803`).

---

## 4. Dependencies

```
pnpm ls -r --depth 0    cargo tree --depth 1 --locked --offline    [C16]
```

| Package | Runtime dependencies | Notes |
| --- | --- | --- |
| `packages/core` | `@shikijs/core`, `@shikijs/engine-javascript`, `@shikijs/langs` 4.4.3; `mdast-util-from-markdown`, `-gfm`, `-frontmatter`, `-math`; `micromark-extension-gfm`, `-frontmatter`, `-math`; `micromark-util-decode-string` | Shiki uses the JavaScript regex engine, not Oniguruma WASM. Grammars are lazy per language. Bundle weight is the performance agent's measure. |
| `packages/typeset` | `justif` 0.9.1 | See below |
| `packages/theme` | `smol-toml` 1.8.0 | Small |
| `apps/desktop` | 13 `@codemirror/*` packages (8 language modes), `@tauri-apps/api` 2.11.1, `katex` 0.18.7 | CodeMirror and KaTeX are dynamic imports (`app.ts:229`, `render/math.ts:69`) |
| Rust | `tauri` 2.11.5 (`protocol-asset`), `tauri-plugin-single-instance`, `-clipboard-manager`, `-dialog`, `notify` 8, `imagesize` 0.13, `serde`, `serde_json` | 312 unique crates in the normal-dependency tree ([C16]) |

Findings:

- **No declared dependency is unused.** Every runtime package is imported by product code ([C17]).
- **There are two highlighting systems.** Shiki colours Rendered code blocks and CodeMirror's Lezer
  modes colour Source. They are separate grammars, with 24 languages on one side and 8 on the other, and
  two colour mappings. That is defensible, since the CodeMirror modes are needed for editing, but the same
  file looks different in the two modes.
- **`justif` is young.** Its first npm version was published 2026-07-15. It has had 25 versions since, the
  latest 0.9.2 on 2026-09-30, and one maintainer ([C18]). Marxy pins 0.9.1 through the lockfile. The risk
  is small in practice. The default breaker is Marxy's own `ragged.ts`. `justif/core` runs only on an
  engine option nothing sets. What the app really takes from `justif` is the `en-us`/`en-gb` hyphenation
  patterns (`hyphenate.ts:52-53`). Vendoring those patterns would remove the dependency outright.
- **The allow-list is aspirational.** `scripts/allowlists/dependencies.json` names 13 crates that are not
  in `Cargo.toml`, among them `ignore`, `nucleo-matcher`, `notify-debouncer-full`, `objc2*`, `webkit2gtk`,
  `dirs`, `open` and `sha1_smol`. It also names 6 npm packages no `package.json` declares ([C17]). Its
  forbidden list bans `reqwest` and `hyper`. Implementing ADR-0027's shell-side image fetch would need one
  of them, or `ureq`.
- **Bundle-relevant:** KaTeX with its CSS, CodeMirror with 8 language modes, Shiki grammars, two
  variable font families, and the 38-piece Commonplace (64,783 bytes of markdown, [C19]). Sizes and
  timings are left to `05-performance-audit.md`.

---

## 5. Build and run health

All runs were in the worktree at `4526b811` on 2026-10-01.

| Check | Command | Result | Last lines |
| --- | --- | --- | --- |
| Typecheck | `pnpm typecheck` | Pass, 3.0 s wall | `apps/desktop typecheck: Done` |
| Lint | `pnpm lint` | Pass, 12.7 s | `biome-contract: ok` |
| Unit and browser tests | `pnpm -r test` | Pass, 6 min 5 s wall | core: `tests 763 / pass 762 / skipped 1`; theme `81/81`; typeset `44/44`; desktop `304/304`; then the deliberate `MARXY_86_MUTATION` run `tests 19 / fail 8`, which the script requires to fail (`test $? -eq 1`) |
| Rust | `cargo check --locked --offline` (separate target dir) | Pass, 0 warnings, 40 s cold | ``Finished `dev` profile [unoptimized + debuginfo] target(s) in 39.84s`` |
| Orphan Rust module | `rustc --edition 2021 --test src/index/mod.rs` | Compiles; `test result: ok. 8 passed` | not run by CI |

The suite is healthy, and slow where it drives a browser. Desktop tests took 329 s of the 365 s total,
mostly Playwright WebKit against a Vite build per file. One skipped core test is a story-scoped guard
(`the three-dot diff does not contain contracts or sanitize`) that self-skips outside its story. That is
process logic inside the product test suite.

---

## 6. Code over-fit to decisions the author now questions

The question for each decision is how much code exists only because of it, how tangled that code is,
and what simplifying it would cost or free. Line counts are product source unless marked otherwise
([C20]).

### 6.1 The no-network posture (ADR-0009, ADR-0027, design 13)

| Piece | Lines | Needed without the posture? |
| --- | --- | --- |
| CSP in `tauri.conf.json` | 1 | Yes. A strict CSP is cheap and protects against document script whatever the network stance. |
| Sanitiser: `sanitize-html.ts`, `policy.ts`, `urls.ts`, `escape.ts` | 1,089 | Mostly yes. Rendering untrusted HTML needs it regardless. |
| `sanitize/document-origin.ts` | 51 | No. It encodes a gate's origin assumption "for MARXY-45 to reconcile". |
| Remote-image classification in `core/render/images.ts` | ~80 of 277 | Partly. Local image resolution stays. |
| `trust/trust.ts` (per-document grants, `trust.json`) | 225 | Only for the HTML opt-in |
| `notices/blocked.ts`, `notices/trust-copy.ts` | 370 | Mostly no. Most of it words grant, summary and revoke states. |
| `commands/trust.ts` | 57 | No, and it is unreachable anyway |
| Trust section of `app.ts` | 192 (`388-579`) | No. Grant bookkeeping, `grantSummary` in-flight counters, re-renders. |
| `render/images.ts` (desktop) `stripNonLocalImages` | ~40 of 105 | Partly |
| `packages/theme/src/css-urls.ts` | 284 | No. It rewrites theme `url()` to local assets only. |
| `scripts/gate-no-network.mjs` (not product) | 396 | No |
| **Product lines answering "No" or "Partly"** | **about 1,100 (without `trust.ts`) to 1,300 (with it)** | |
| Tests for the above (not product) | 3,317 | — |

**Entanglement: high in `app.ts`, low elsewhere.** Trust state decides the render policy on every render
(`renderPolicyFor`, `app.ts:395-397`). It fires two re-render paths and the notice region, and it runs
late (`maybeRerenderForLateTrust`), which can re-render the page after first text.

**Cost and payoff.** Removing only the remote-image grant branch removes the half-built feature, about
250 lines across `notices/`, `trust.ts`, `app.ts` and `core/render/images.ts`. It also removes a promise
the UI cannot keep. Loosening the posture further, for example by allowing remote images by default or
per collection, needs either the shell fetch from ADR-0027 or a CSP `img-src https:` change. That is
about one Rust command, or one config line plus the deletion of the grant UI. The sanitiser and CSP
should stay. They are where the safety is, and they cost little.

### 6.2 The frozen contracts

The frozen files are `core/src/contracts/` (146 lines), `shell-api/src/index.ts` (132) and
`theme/tokens.contract.json` (277). They are pinned by a hash compare in the root `test` script
(`package.json`, `test:contracts-frozen`), with an ADR needed for any change.

- **Frozen does not mean implemented.** Of 29 `Shell` members, Tauri implements 20 ([C21]). The other 9
  are `stat`, `listRoot` and `fuzzy` (both deprecated), `repositoryRoot`, `openDialog`,
  `revealInExternalEditor`, `setWindowControls`, `webkitVersion` and `fetchRemoteImage`.
- **Frozen is routed around.** The app does not program to `Shell`. It programs to
  `AppShell = Pick<Shell, …11 members> & { …10 more }` (`app.ts:80-105`). Eight of the ten redeclare `Shell`
  members with different optionality or types. Two, `peekFile` and `recordRead`, are outside the
  contract and exist only on Tauri. `tauri.ts` exports its own type of the same shape. ADR-0039 exists
  only to share stub shells that satisfy the frozen type. The freeze protects a document, not the
  boundary the code uses.
- **The AST and operation contracts are good and stable.** `IndexEntry` is the one that will pinch.
  Its comment reads "What the palette searches; never contents", and `INDEX_LIMITS.recentRoots = 12`
  already anticipates several roots. A collection or content search changes it.

**Cost and payoff.** Unfreezing removes no product code. It removes a process step: an ADR and a
hash-pinned PR per change. It would let `Shell` become the type the app actually uses, which would delete
`AppShell` and the parallel type in `tauri.ts`. Keep the contracts as reviewed interfaces. Drop the hash
pin until v1.

### 6.3 The Linux weight offset

| Piece | Lines |
| --- | --- |
| `theme/offset.ts` | 38 |
| `--marxy-weight-offset` uses in CSS | 9 (`base.css` 7, `tokens.css` 1, `frontispiece.css` 1) |
| config `linux.weight_offset` parse | ~5 (`config.ts:99-101`), not applied by the app |
| `scripts/gate-font-attrs.mjs` (not product) | 38 |

This is small and well contained. It is not over-fit in code. The problem is that it is unfinished. The
version table (`75/125/100`) is never consulted because `webkitVersion` does not exist, so every Linux
build gets `+100`, an unmeasured value. Either implement `webkitVersion`, about 15 lines of Rust, or keep
the constant and delete the table.

### 6.4 The no-tab-bar rule (ADR-0011)

| Piece | Lines |
| --- | --- |
| `TAB_BAR_*`, `documentHasTabBar`, `applyTabBarMutation` (`palette/view.ts:25-28`, `131-147`) | ~25 |
| Legacy `hasTabBar` (`palette/view.ts:540-548`) | ~9 |
| `test/palette.test.mjs:162` | 1 assertion |

The rule's code is trivial. What it shaped is larger and not attributable to it alone. The app assumes
one visible document: one `#doc`, one scroller (`document.documentElement`), one Source mount. Removing
the rule frees 35 lines. Adding tabs or splits needs the store work in §7, whatever the rule says.

### 6.5 The Knuth–Plass typesetter (ADR-0007)

| Piece | Lines | Entanglement |
| --- | --- | --- |
| `packages/typeset/src` | 1,280 | Self-contained, DOM-only, with a per-paragraph fallback to engine wrapping |
| Typeset and grid glue in `app.ts` (`607-780`, `948-970`) | ~200 | High. The grid pass rebuilds the block list that reading position, anchors and live reload read. Background passes are coalesced to avoid a quadratic case (`app.ts:692-699`), and an anchor is re-held after each pass because reflow moves the page. |
| `justif` dependency | — | Hyphenation patterns in practice (§4) |
| Break marks in the DOM (`.marxy-lb`, `.marxy-hyphen` spans with generated content) | — | Designed so copy and find see unchanged text (`typeset/src/apply.ts:1-6`). Any span-level selection or find must step over them. |

**Cost and payoff.** Removing it would delete about 1,500 lines and most of the anchor and coalescing
logic in `app.ts`. It would also remove the product's one demonstrable typographic differentiator. A
cheaper middle path keeps the package, adds `typeset = false` to the config (the fallback path already
exists), and moves the glue out of `app.ts` into a per-article `RenderedView` (§8). Then a split pane gets
its own typesetter for free, because `attach(article)` is already per element.

### 6.6 One more: the startup measurement apparatus

The brief did not list this, but the pattern is the same. About 90 lines of `app.ts` exist to prove
`first_text` honestly: the frame counter, `renderEvidence`, `no_text`/`no_paint`, `inHarness` and the
paint wait (`334-361`, `584-605`, `1259-1297`). With them come `paint-signal.mjs` (102 lines) and about
85 lines of `main.rs` for the paint deadline and its selftest (`364-411`, `488-528`). The code has 22
`shell.mark` calls, and `scripts/registry.json` registers 35 marks. ADR-0032 has since made the numbers
record-only. The apparatus could move behind one `measure` module and stop shaping the open path.

---

## 7. Fitness for the three feature directions

Three other documents (06, 07, 08) go deep. This section only states what the code gives and what
it fights.

| | Helps | Fights |
| --- | --- | --- |
| **Collections + search bar** | `core/index-model` is pure, root-parametrised and tested (walk, ignore, deny list, 50k ceiling, headings). `IndexEntry.root` and `INDEX_LIMITS.recentRoots` anticipate many roots. `palette/search.ts` already ranks the current root first and is fast. Persistence code exists (`index-model/persist.ts`). A Rust walker exists, uncompiled (`src-tauri/src/index/mod.rs`). Pins and MRU persist (`history.json`). | The index has no owner. It is startup idle work, delivered once (§1.3). Watches cover only the open document's directory, so a collection would go stale. No index persistence is wired. `IndexEntry` is frozen and says "never contents". The walk is one IPC call per directory and one per markdown file. A collection of several repositories multiplies it. |
| **Split view** | Core is pure and per-document. `typeset.attach(article)`, `snapToGrid(article)`, `buildNodeMap(ast)` and `buildBlocks(article, map)` all take their element or AST as an argument. Provenance attributes are per element, so two articles do not collide. `serially` already serialises transitions. | Everything above core is a singleton. There are 33 module `let`s in `app.ts`, and `selection/view.ts` has a single `ctx`. `commands/edits.ts` keeps one history and one saved fingerprint. `#doc` is hard-coded in 28 places across 7 files. The scroller is `document.documentElement`. There is one Source mount and one trust notice region. The palette opens "the" document. ADR-0037 is the prerequisite, and it must be written for N documents, not one. |
| **Click text tools** | The operation contract is pure `string → string` over a byte range. Each operation is 21–166 lines plus a table test. `Applicability` already includes `'span'`. `clipboardWrite` carries text and HTML. Inline elements carry provenance. Undo works for operations. "Chrome at rest is zero" allows UI that appears on a selection. | Selection is node-granular (D-A2). A text selection is `{ kind: 'text', text }` with no byte range, so no operation can act on it (`selection/input.ts:13-15`). Mapping a DOM `Range` to bytes inside a text node is not identity: smart typography, entity decoding, the typesetter's break spans and hyphens all sit between the bytes and the glyphs. The palette lists only `op.*`, and commands without a key are unreachable. A toolbar would also need a reachable command surface. |

The common prerequisite is a document store with an owner, plus an index service with an owner. Neither
feature is blocked by the no-network posture, the typesetter or the tab rule.

---

## 8. Ranked recommendations

The list is ordered for a person, or a small fleet, resuming feature work. Each item names its files.

1. **Fix the index ownership defects first** (rough effort: days).
   - Move the index out of `runDeferredStartup` (`startup/idle-work.ts:105-115`) into an
     `index/service.ts` keyed by root. It walks once per root, persists with the existing
     `core/index-model/persist.ts`, refreshes on a watch of the root, and publishes through a subscription
     the palette reads.
   - Delete the one-shot hand-off in `main.ts:11-14`.
   - Stop `rerenderFromBuffer` and `rerenderOpenDocument` from re-walking.
   - Stop `shell.readFile` from caching bytes for index reads (`shell/tauri.ts:95`): use `peekFile`.
   - This is a bug fix and the foundation for collections.
2. **Build ADR-0037's store for N documents, and make `app.ts` a composition root** (rough effort: one to two weeks).
   - Create `apps/desktop/src/document/store.ts`: one store per open document, holding path, disk, buffer,
     AST, node map, history, mode, anchor and version. Transitions go through `dispatch`. Delete the
     module state in `selection/view.ts`, `commands/edits.ts` and `save.ts`.
   - Create `apps/desktop/src/view/rendered-view.ts`: one per article element. It owns the typesetter, the
     grid scheduling, the anchor, the resize observer and the scroller. This lifts `app.ts:607-780`.
   - Create `trust/controller.ts`, lifting `app.ts:388-579`, and `startup/measure.ts`, lifting the
     measurement code.
   - `app.ts` should end under 300 lines.
   - Make the `serially` queue per store.
   - This is the prerequisite for split view and the cure for the seven-module cycle.
3. **Wire what is built** (rough effort: days).
   - Let the palette list every registry command whose `when` holds, not only `op.*`
     (`palette/view.ts:91-95`). That one change makes save, undo, trust revoke, line numbers and jump to
     source reachable.
   - Move `Mod+E` and both history listeners into the registry.
   - Apply config `variant` and `size` in the app; the code to copy is in `render/headless.ts:305-318`.
   - Wire `outlineFrom` into `#marxy-outline`.
   - Each is small, and together they close six scope items.
4. **Delete dead and parallel code** (about 1,700 lines; §3.2).
   - Delete `src-tauri/src/index/mod.rs`, or wire it in item 1 if the Rust walker is preferred.
   - Delete `palette/palette.ts`, `palette/index.ts`, `palette/view.ts:531-760` and their tests;
     `source/mode-toggle.ts` and `source/index.ts`; `core/position/snapshot.ts`; the six unused exports;
     the two stale `deferrals.json` entries; the second `tauri_plugin_dialog::init()`.
   - Move the `MARXY_*_MUTATION` switches and `window.marxy*` hooks into test-only entries.
5. **Retire the parallel render path.** Point `scripts/gate-aesthetics.mjs` at the app harness
   (`harness/app-harness.ts` with `startApp(memoryShell)`) and delete `render/headless.ts`,
   `render/stub.ts` and `render/vite.config.ts` (497 lines). Gates should judge the page a reader sees.
6. **Resolve the remote-image half-feature.** Either implement `fetch_remote_image` in Rust (ADR-0027),
   which needs a small HTTP client the forbidden list currently bans, or delete the per-host grant branch
   (about 250 lines: `notices/blocked.ts`, `notices/trust-copy.ts`, `trust/trust.ts` `imageHosts`, the
   `grantSummary` logic in `app.ts`) and keep the plain "blocked" notice. Keep the sanitiser, the CSP and
   the HTML opt-in.
7. **Unfreeze the contracts until v1.** Replace the hash pin in `package.json` `test:contracts-frozen`
   with ordinary review. Make `Shell` the real interface: delete the 9 unimplemented members or implement
   them, fold `peekFile`/`recordRead` in, and delete `AppShell` and the duplicate type in
   `shell/tauri.ts`. Keep the AST and operation contracts as they are. They are good.
8. **Use the package boundaries.** Export what the app needs from each package index. Move
   `core/index-model/paths.ts` to `core/paths.ts`, and replace the 52 deep `@marxy/*/src/...` imports.
   It is mechanical, and it makes the next refactor safe.
9. **Keep the typesetter, make it optional, and vendor the hyphenation patterns.** Add `typeset = false`
   to the config, using the existing fallback. Vendor `justif`'s `en-us`/`en-gb` patterns, or keep the
   pinned version and drop the unused `engine: 'justif'` path (`items.ts`), so a young library is no
   longer on the critical path.
10. **Finish or drop the Linux weight table.** Implement `webkitVersion`, or delete the version rows in
    `theme/offset.ts` and document the constant.

What to keep untouched: `packages/core` parse, render and provenance; the operation contract and its four
operations; `atomic_write.rs`; the watch and live-reload logic; the reading-position model; the palette's
search and session modules; and the typesetter package itself. These are the best parts of the codebase,
and every feature direction stands on them.

---

## For the synthesis

1. The palette's index reaches the palette once per session (`main.ts:11-14`): a launch without a document, or a second repository, leaves search empty, and a browser probe confirms it.
2. Every edit, reload or trust change re-walks the whole repository and discards the result (`app.ts:976-992` → `idle-work.ts:105-115`); fixing index ownership is the first job and the foundation for collections.
3. Just over half of `docs/scope.md`'s v1 list is shipped and reachable (17 of 31 items); several more are built but unwired, and wiring them (outline, light variant, text size, a palette that lists all commands) is days, not weeks.
4. `apps/desktop/src/app.ts` is a 1,399-line god module with 33 module-level variables, and ADR-0037's document store is unbuilt; building that store for N documents is the prerequisite for split view and the main refactor to do before features.
5. Byte provenance from parse to DOM to splice is real and solid; it is the asset every feature direction (collections, split view, click tools) should build on, and it should not be loosened.
6. About 1,700 lines are dead or parallel and can go without touching a feature, including an uncompiled 573-line Rust indexer and a second render pipeline that the aesthetics gate measures instead of the real app.
7. The no-network posture costs roughly 1,100 to 1,300 lines of app code beyond the sanitiser; the per-host image grant persists a choice nothing acts on and should be implemented or removed, while the sanitiser and CSP should stay.
8. Frozen contracts are routed around rather than honoured: 9 of 29 `Shell` members are unimplemented, and the app programs to an ad hoc `AppShell`; unfreeze until v1 and make `Shell` the real interface.
9. The typesetter is well isolated, but its glue in `app.ts` is the most tangled code; keep it, make it optional, and take `justif` off the critical path by vendoring its hyphenation patterns.
10. Build health is good: typecheck, lint, 1,191 passing tests and `cargo check` are green, with strict TypeScript and almost no `any`.

---

## Appendix: commands

All commands were run from `/Users/ian/Dev/marxy-wt/MARXY-346` unless noted. Scratch scripts are in the
session scratchpad under `codebase-audit/`. Their full text is given where the result depends on them.

- **[C1] Line counts by area.**
  ```sh
  git ls-files packages/core/src packages/typeset/src packages/theme/src packages/shell-api/src apps/desktop/src apps/desktop/src-tauri/src \
    | grep -vE '\.test\.|/testing/|commonplace/pieces' | xargs cat | wc -l          # 22474
  git ls-files packages apps | grep -E '\.test\.' | xargs cat | wc -l              # 18714
  for d in apps/desktop/test scripts orchestration; do git ls-files $d | xargs cat | wc -l; done   # 8504 14797 15406
  ```
- **[C2] Per-package table.** For each directory: `git ls-files $d | grep -E '\.(ts|mjs|rs|css)$' |
  grep -vE '\.test\.|/testing/|\.d\.ts$'`, then `wc -l`, and the same for test files.
- **[C3] Reachability from `main.ts`.** `reach.mjs` follows static `import`/`export … from`, side-effect
  imports and `import('…')` from `apps/desktop/src/main.ts`, resolving `@marxy/*` to `packages/*/src`.
  Output: `product files: 159, reached from entry: 141, unreached: 18 (1283 lines)`. The highlight worker
  shows as unreached because it loads through `new Worker(new URL(...))`; it is live.
- **[C4] `app.ts` shape.**
  ```sh
  wc -l apps/desktop/src/app.ts; grep -cE "^(export )?(async )?function " apps/desktop/src/app.ts   # 1399, 74
  grep -cE "^let " apps/desktop/src/app.ts                                                     # 33
  grep -oE "from '[^']+'" apps/desktop/src/app.ts | sort -u | wc -l                            # 34
  ```
- **[C5] Module state and window globals.**
  ```sh
  grep -rnE "^let " --include='*.ts' apps/desktop/src | grep -v "\.test\." | wc -l    # 67 across 15 files
  grep -rnoE "__marxy[A-Za-z]+|w\.marxy[A-Za-z]+|window\.marxy[A-Za-z]+" --include='*.ts' apps/desktop/src | grep -v "\.test\." | sed 's/.*://' | sed 's/^w\./window./' | sort | uniq -c   # 20 names
  ```
- **[C6] Import cycles.** `cycles.mjs` runs Tarjan's SCC over static value imports reachable from
  `main.ts`: `modules: 51; static (value) import cycles: 1` and `[7] commands/document.ts,
  commands/edits.ts, commands/index.ts, commands/registry.ts, render/tasks.ts, save.ts, selection/bind.ts`.
- **[C7] Deep imports.**
  `grep -rhoE "from '@marxy/[a-z-]+/src/[^']+'" apps/desktop/src --include='*.ts' | grep -v test | wc -l`
  gives 52. `grep -rlE … | grep -v "\.test\." | wc -l` gives 28 files.
- **[C8] Unused exports.** `dead-exports.mjs` lists every `export function|const|class|interface|type` in
  product source and counts word-boundary references in other product, test and script files. Output:
  `exports: 629`, `no reference … 7 (values: 6)`, `referenced only from tests … 8 (values: 8)`. Grep-based,
  so it is lenient: a name in a comment counts as a use.
- **[C9] Palette index probe.** `palette-index-probe.mjs` builds `apps/desktop/test/palette-boot.html`
  with Vite, serves it, and launches Playwright WebKit through `scripts/playwright-webkit.mjs`. It boots
  `bootApplication` over a memory shell holding `/a` and `/b` repositories (each with `.git/HEAD`),
  optionally calls `handle.open('/b/README.md')`, waits 1.5 s, presses Mod+P, types `notes`, and counts
  `.marxy-palette-row`. Run from `apps/desktop`: `node <scratchpad>/codebase-audit/palette-index-probe.mjs`.
- **[C10] Re-walk probe.** `edit-reindex-probe.mjs` is the same harness. It boots on `/b/README.md`,
  then three times appends one byte with `window.marxySelection.createBuffer` and calls
  `handle.commitEdit`. It counts `mark index_loaded`, `readDir` and `readFile` calls from the memory
  shell's call log.
- **[C11] Releases.** `git ls-remote --tags origin` and `gh release list --limit 5` both returned nothing.
- **[C12] Change share.** `git log --format= --name-only origin/main | wc -l` gives 4126.
  `… | grep -cE "^(packages/[a-z-]+/src|apps/desktop/src|apps/desktop/src-tauri/src)/"` gives 701.
- **[C13] Orphan Rust module.**
  ```sh
  grep -n "^mod " apps/desktop/src-tauri/src/main.rs        # atomic_write, commands, error, watch, watch_notify — no index
  cd apps/desktop/src-tauri && rustc --edition 2021 --test src/index/mod.rs -o <scratch>/index-test && <scratch>/index-test
  # test result: ok. 8 passed; 0 failed
  git log --format='%h %ad %s' --date=short -- apps/desktop/src-tauri/src/index/mod.rs   # fd7f1424 2026-09-18 … (MARXY-35), no later change
  ```
- **[C14] Deferral markers.**
  `grep -rnE "TODO|FIXME|XXX|HACK|later story|Placeholder|not yet|until MARXY" packages/*/src apps/desktop/src apps/desktop/src-tauri/src`
  over non-test files. `git log --oneline origin/main | grep -E "MARXY-(196|23)\b"` confirms both stories
  merged.
- **[C15] Type-safety counts.** `types.sh` greps non-test `.ts` per package for `: any|<any>|as any`,
  `as unknown as`, `as never`, `@ts-(ignore|expect-error|nocheck)`, `getElementById(…)!`,
  `\bas [A-Z]…` and `catch {` / `catch (e) {}`.
- **[C16] Dependencies.**
  ```sh
  pnpm ls -r --depth 0
  cd apps/desktop/src-tauri && cargo tree --depth 1 --locked --offline
  cargo tree --locked --offline -e normal --prefix none | sort -u | wc -l   # 312
  ```
- **[C17] Allow-list vs declared.** A node script compares `scripts/allowlists/dependencies.json` with
  every `package.json` and `Cargo.toml`. `npm allow-listed 49 not declared anywhere: 6 …`;
  `cargo allow-listed 22 not in Cargo.toml: 13 …`. Each runtime dependency was grepped in product source:
  all are imported.
- **[C18] justif history.** `npm view justif time --json` reports 25 versions, the first created
  `2026-07-15T03:45:00.486Z` and the last `0.9.2 2026-09-30T04:26:53.125Z`. `npm view justif
  maintainers` lists one maintainer.
- **[C19] Commonplace.** `ls apps/desktop/src/commonplace/pieces | wc -l` gives 38.
  `cat apps/desktop/src/commonplace/pieces/*.md | wc -lc` gives 1283 lines and 64783 bytes.
- **[C20] Over-fit line counts.** `wc -l` on the files named in §6. `app.ts` ranges are from reading
  the file (`sed -n 388,579p`, `607,780p`). `grep -c weight-offset` on the CSS files gives
  `base.css` 7, `tokens.css` 1 and `frontispiece.css` 1.
- **[C21] Shell coverage.** A node one-liner extracts member names from `interface Shell` in
  `packages/shell-api/src/index.ts` and looks for each as a property in the object literal exported by
  `apps/desktop/src/shell/tauri.ts`: `Shell members: 29 implemented by tauri.ts: 20 missing: stat,
  listRoot, fuzzy, repositoryRoot, openDialog, revealInExternalEditor, setWindowControls, webkitVersion,
  fetchRemoteImage`.
- **Health runs (§5).** `pnpm typecheck`, `pnpm lint`, `pnpm -r test`, and
  `CARGO_TARGET_DIR=<scratch>/cargo-target cargo check --locked --offline` in `apps/desktop/src-tauri`.
  Each was wrapped in `time`, with the logs kept in the scratchpad.
