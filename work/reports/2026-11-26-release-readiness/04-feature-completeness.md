# 04 Feature completeness (read-only probe of origin/main b16c76b3)

## Bottom line

The documented feature set is, in the places I sampled, implemented and covered by tests: no claimed
capability turned out to be a stub, `rg` finds no "not implemented / coming soon" strings in shipped
code, every key in the settings schema has a reader, and the everyday path (empty state, open, tabs,
find, save, save-as, close guard, settings, error cards, macOS menu with About and Keyboard Shortcuts) exists.
Nothing found is a hard blocker for a tag. The gaps are about the release itself, not features: the
README has no Install or Status section for someone who downloads a build (v0.1.0's README had both), there
is no CHANGELOG on main although the v0.1.0 release notes point to one, `release.yml` still builds only a macOS
arm64 DMG and its body text is a pre-release note, and the docs describe Windows and macOS behaviour that
nobody has used by hand on macOS or at all on Linux (STATE.md). Several v0.1.0 conveniences changed
shape (Mod+Shift+O outline chord, Mod+Shift+E external editor); none is lost outright. Method: I read the
docs and STATE.md, spot-checked implementation and test presence by file, not every claim line by line.

## Claimed features

| Feature | Implemented | Tested | Note |
|---|---|---|---|
| Many file kinds (md, text, code, data, logs, diffs, notebooks, mail, HTML, archives, PDF, images, media, fonts, sheets, docx, decks, certs, programs, SQLite) | yes | yes | `packages/core` kinds + `apps/desktop/src/viewers/`, `kinds/`; Rust decoders under `src-tauri/src/{archive,decode,facts,font,outlook,tables,legacy_office}`; corpus in `fixtures/` |
| Read / Source, place kept, exact bytes | yes | yes | `source/editor.ts`, `commands/view-mode.ts`, `commands/source-view.ts`; `apps/desktop/test/mode-swap`, `source-*` |
| Atomic save, refuse if changed on disk, save as, fork | yes | yes | `save.ts`; `src-tauri/src/atomic_write.rs`; test/`save*.test.mjs`, `explicit-save`, `save-as-onto-open` |
| Unsaved-changes guard on close/quit | yes | yes | `close.ts`, `commands/pane-close.ts`; test/`close-guard`, `pane-close-guard`, `close-teardown` |
| Find in Read, in Source, across files | yes | yes | `find/`, Search panel `left/panels/search.ts`; test/`find-*.test.mjs` |
| The Line (Mod+P) and its 12 scopes | yes | yes | `palette/`, `line/`, `index/`, `collection/` |
| Outline panel (headings, book contents, move/promote) | yes | yes | `left/panels/outline.ts`; test/`outline-rows` |
| Eight panels (Places, Metadata, Outline, Links, Search, Transforms, Export, Versions) | yes | yes | `left/panels/*` |
| Settings page + `config.toml` | yes | yes | `settings/settings.ts`, `packages/theme/src/settings-schema.ts`; test/`settings.test.mjs`, `settings-schema.test.ts` |
| Themes, Studio, Look | yes | yes | `studio/`, `look/`, `packages/theme` |
| Transforms (50) | yes | yes | `packages/core/src/transforms` |
| Export (html, PDF via print, md, txt, JSONL, zip) | yes | yes | `export/`, `left/panels/export.ts`; test/`export-dialog` |
| Copy-as forms, Clip, HTML paste to Markdown | yes | partial | `commands/copy-as.ts`, `paste/`; macOS/Windows native clipboard only (`src-tauri/src/pasteboard`), Linux pastes plain text (documented) |
| Remote images / raw HTML only on consent (Trust) | yes | yes | `trust/`; test/`trust*.test.mjs`; CSP in `tauri.conf.json`; `src-tauri/src/remote.rs` |
| Versions (earlier copies) | yes | yes | `versions/`, panel |
| Margin notes, tray, reply page | yes | yes | `notes/`, `tray/` |
| Tabs, two panes, reopen closed tab, drag | yes | yes | `frame/`, `pane/` |
| Empty state (a random commonplace passage) | yes | yes | `commonplace/pieces/` |
| Folder page, compare page, changes page | yes | yes | `frame/folder-page.ts`, `changes/` |
| macOS native menu incl. Help > Keyboard Shortcuts, About | yes | yes | `src-tauri/src/main.rs` ~1116-1364, 2248; `menu/menu-commands.test.ts` |
| File associations (md + common source/text) | partial | no | `tauri.conf.json` lists only md and text/source extensions; PDFs, images etc. are readable but not associated (Windows list is separate, `installer-hooks.nsh`) |
| Second launch hands files to running window; drop a file | yes | yes | `RunEvent::Opened` main.rs:1661; `drop_windows.rs` |
| Proposals switches (11) | yes | partial | `packages/theme/src/proposals.ts` |

## Findings

### FEAT-01 [SHOULD] No user-facing install text or status on main
README.md "Quick start" is build-from-source only (Node 24, pnpm 11, Rust). v0.1.0's README had Status,
Install (DMG, `xattr -dr com.apple.quarantine`) and "Pre-v1" text. The only quarantine note is in
`docs/development.md:21-22`. A tagged release will have a DMG that macOS refuses to open at first.
Fix: add a short Install/Status section to README.md (platform, unsigned/ad hoc, quarantine step, no updater).

### FEAT-02 [SHOULD] No CHANGELOG on main
The v0.1.0 release body says "See CHANGELOG.md"; `git ls-files` shows no CHANGELOG on main, and
`release.yml:60` has a fixed releaseBody. The old changelog covers a defunct architecture (A-01..A-17).
Fix: add a CHANGELOG.md with a 0.2.0 entry that says the codebase was replaced (#773), and edit
`releaseBody`. Also check that the version in `apps/desktop/src-tauri/tauri.conf.json:4` (still 0.1.0) and
package/Cargo versions match the tag.

### FEAT-03 [SHOULD] Release workflow ships macOS arm64 DMG only; docs and bundle targets say more
`release.yml:18-19` builds `aarch64-apple-darwin`, `dmg`. `tauri.conf.json` targets dmg, appimage, deb, nsis;
STATE.md says Linux has never been built and Windows has had no person at the window since round 9 installer.
Intel macOS: not built (same as v0.1.0). Fix: say in the release notes that only Apple-silicon macOS is
published and that Windows/Linux are source builds; do not claim Linux support in the notes.

### FEAT-04 [SHOULD] Nobody has used the app on macOS, the only published platform
STATE.md: "Run by a person: not yet" (todo M2); 14 browser test files fail on macOS WebKit (M4); no real-window
check exists for macOS. The docs' macOS-specific claims (native menu, Cmd chords, CF clipboard, HEIC) are
unverified by a person. Fix: a 20-minute hand pass of the everyday path before tagging (see section below).

### FEAT-05 [LATER] Docs present Windows behaviour in general voice
- `docs/using-marxy.md:160-163` scrollbar styling is "In the Windows app"; fine, correctly scoped.
- `using-marxy.md:398` `external_editor` default "none: Notepad on Windows". On macOS/Linux with no key set,
  the command fails with "no external_editor is set in config.toml" (`src-tauri/src/commands/os.rs:350`).
  Docs say "set a command here", which is accurate but the default case is a notice rather than the system
  opener; v0.1.0 fell back to the system opener ("using `external_editor` or the system opener").
  Smallest fix: doc line says outright that macOS and Linux need the key; or fall back to `open` on macOS.
- `file-kinds.md:64-65, 148-149` Windows kinds (.lnk, .exe cards, CBS logs) are read everywhere; fine.
- `using-marxy.md:266` Linux paste and `keys.md:92` F11 are called out. No other Windows-only presented-as-general claim found.

### FEAT-06 [LATER] v0.1.0 features that changed or are gone
Compared with v0.1.0's CHANGELOG/README:
- Outline chord: Mod+Shift+O (narrow right-edge list) is replaced by the Outline panel (Alt+3 via the rail). Not lost, moved.
- Open in external editor: v0.1.0 Mod+Shift+E; now Mod+Alt+E (`keys.md:81`); Mod+Shift+E is Places (`keys.md:98`). Old muscle memory changes.
- Palette is now the Line (Mod+P / Mod+K), with scopes; commands still listed via `>`.
- Text size Mod+=, Mod+-, Mod+0 kept (`commands/appearance.ts:111-136`); light/dark commands kept.
- v0.1.0's stated promises "no tab bar", "no plugin API" no longer hold: there is a tab row and user `[[command]]` programs.
- Per-reader "justify with Knuth-Plass" claim: current typesetter is ragged-right plus hyphenation/hanging punctuation
  (`docs/themes-and-type.md:233-247`); justification via `data-marxy-look-align="justify"` is the browser's, not the typesetter's.
  Nothing a v0.1.0 user relied on that I could find is missing outright; the old ADR set (`docs/adr/`) and `docs/plan.md` are gone.

### FEAT-07 [LATER] Half-built signals are few and are in the tracker, not the UI
- `rg -n -i 'not (yet )?implemented|coming soon|TODO|FIXME|XXX'` over apps/ and packages/ (non-test): only
  false positives (`todo` variables in pdf.ts, outlook layout, memory shell) and a test helper
  `packages/core/src/transforms/testing/rows.ts:24` (test-only). No disabled-command placeholders found.
- Settings: `CATEGORIES` includes `collections` with no row (`settings-schema.ts:15-22`, drawn only if it has a row, so invisible). Every other schema key has a non-schema reader (spot-checked all 20 keys with rg).
- Known unlanded work that touches users: round 16 (line and container budgets, so a hostile huge-line text file is not yet budgeted) and wave 5 (geometry table, near-reader typesetting) are on the Windows machine only (STATE.md, M1). Not in the tag.
- 14 macOS browser-test files fail (M4): a test gap, not a feature gap, but it means some macOS UI behaviour has no green automated cover.

### FEAT-08 [LATER] Docs undocumented in the other direction
Features in code the docs barely mention: Linux `[linux] weight_offset` is documented; the `harness/`, `testing/`,
`depths/` modules are internal. Not checked exhaustively (budget). The `file-kinds.md` is a single very long table cell format (lines 268-272) that a user cannot scan; cosmetic.

## Everyday path (new user)

| Step | Exists | Evidence |
|---|---|---|
| First launch, no file | yes: a typeset passage; Line's first row is "Open a file" | `commonplace/`, `using-marxy.md` Pages that are not documents |
| Open dialog, drop, Open With, CLI, second launch | yes | Mod+O; `drop_windows.rs`; `RunEvent::Opened` main.rs:1661 |
| Open a folder | partial | folder as a page and "Add a folder" in Places; no separate File > Open Folder noted in docs |
| Recent files | yes | Line lists recent and pinned; `layout.json` restores panes at launch |
| Tabs/panes/windows | yes (single window by design; docs say panes, two max) | `frame/`, `pane/` |
| Find in page | yes | Mod+F, `find/` |
| Save / Save as / Fork | yes | `save.ts` |
| Unsaved guard | yes, as a notice in the pane, not a modal | `close.ts` |
| Settings | yes, Mod+, | `settings/` |
| Help / About | macOS: Help > Keyboard Shortcuts and native About; Windows/Linux: no menu bar, keys and the Line only | main.rs:1295; `using-marxy.md:447` |
| Unreadable file | yes, a card with the reason | `using-marxy.md` Opening files |
| Check for updates | no (by design, no updater; `settings/privacy.test.ts:52` bars the plugin) | |

## Suggested pre-tag hand pass (macOS, 20 minutes)
Launch with no file; Mod+O a .md, a .pdf, a .csv; edit in Source and Mod+S; close with unsaved; Save as;
Mod+F; open a folder; Settings change of theme; right-click Export > PDF (system print); Help menu.
