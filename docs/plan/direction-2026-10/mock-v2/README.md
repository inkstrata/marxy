# Marxy mock v2: interface prototypes

Marxy is a reader for source of any kind. This is Galley's design, kneaded for Marxy: source first, no session tracking or tagging, and a workspace that folds away to a single column while you read. It is a Tauri desktop app (macOS first) with a render panel for reading, a source panel that is a real editor, copy and transform tools, a library that indexes folders you point it at, a command palette, a layout for each type of content, and a theme picker that informs every view.

This folder holds clickable HTML prototypes, a companion Markdown spec for each, and four cross-cutting documents. The typography builds on the Reader Typography Handbook in the parent folder (`../docs/`).

## Open the prototypes

From this directory (`mock-v2`):

```
python3 tools/serve.py 8797
```

Then open http://localhost:8797/ for the index. `serve.py` is a plain static server that turns off caching, so edits to the shared files show on reload; `python3 -m http.server 8797` works too but browsers may keep stale copies of `shared/`. The pages also open straight from disk; they need an internet connection for the web fonts and the icon set.

Press ⌘K (⌘P too; Ctrl K elsewhere) on any page for the palette: `>` commands (⇧⌘P), ⌘/ transforms, `/` content search. Theme, type set, text size and settings persist across pages in your browser; the index page has a theme switcher.

## Fold-up

The workspace has two states.

- **Folded** is for reading: only the document column.
- **Unfolded** is the full workspace: sidebar, toolbar and tabs, inspector, status bar.

Toggle with ⌘\ (Ctrl \ elsewhere) or the palette command "Fold / Unfold workspace". When folded, pausing the pointer at the left, right or top screen edge peeks the sidebar, inspector, or toolbar and tabs. Clicking in a peeked panel, or pressing its own shortcut (⌃⌘S sidebar, ⌥⌘I inspector), docks it. Escape (when nothing else is open) or ⌘\ folds again. 01-workspace starts folded. The last unfolded arrangement is remembered; the window always launches folded.

## What is in here

| File | What it is |
|---|---|
| [index.html](index.html) | Index of everything, with a theme switcher |
| [01-workspace.html](01-workspace.html) · [md](01-workspace.md) | The main window: starts folded and unfolds into the full workspace |
| [02-source.html](02-source.html) · [md](02-source.md) | The source editor |
| [03-content-modes.html](03-content-modes.html) · [md](03-content-modes.md) | Twelve content types (logs and terminal captures among them), each with its own layout, tools and typography |
| [04-palette.html](04-palette.html) · [md](04-palette.md) | The command palette and its seven modes |
| [05-collections.html](05-collections.html) · [md](05-collections.md) | The library |
| [07-themes.html](07-themes.html) · [md](07-themes.md) | Themes and type sets, with previews across every view, token inspector and editor |
| [08-settings.html](08-settings.html) · [md](08-settings.md) | Every setting, searchable, applied as you change it |
| [FEATURES.md](FEATURES.md) | The complete feature set, by area, with release tiers and the prototype that shows each feature |
| [TYPOGRAPHY.md](TYPOGRAPHY.md) | Typography for each content type, type sets, coupling rules and measured line lengths |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How to build it with Tauri v2 |
| [shared/README.md](shared/README.md) | The engine every prototype page uses |
| `tools/audit_contrast.py` | WCAG contrast audit of every theme |

### Later, not in this direction

| File | What it is |
|---|---|
| [09-macos.html](09-macos.html) · [md](09-macos.md) | Menu bar, toolbar quick actions, Finder Quick Actions, Services, Quick Look, Shortcuts and the rest |

### Descoped for now

| File | What it is |
|---|---|
| [06-clipboard.html](06-clipboard.html) · [md](06-clipboard.md) | Clipboard studio: good ideas, too much scope; copying lives in the reading and source views instead |

## Sidebar, new files, copying, kinds

- **Sidebar.** A foldable Recent list (last eight documents), Library views (Pinned, Changed since you read), Repositories (a quiet count of files changed since you read) and Folders. Every repository and folder opens inline as a tree to any depth (← → collapse and expand). Right-click a folder: New file here.
- **New and fork.** The toolbar and tab-bar **+**: New file (⌘N, an untitled scratch buffer that writes nothing until Save As), New file in this folder…, Fork this file (⇧⌘N, writes `name (fork).md` beside the original). All work folded.
- **Copying.** Render: ⌘C with no selection copies the document; ⇧⌘C is Copy as (selection, else the block under the pointer, else the document); hovering a block shows a copy button at its top right. Source: Copy file and Copy as… in the header, and a gutter menu (Copy line, Copy lines with path:line). A quiet toast names the format and size.
- **Kinds.** Logs and terminal captures are source types with their own typography (mono 13.5 / 1.6, as written), rendering and tool strips. Every kind has one custom glyph; code files tint theirs with the language colour.

Read [FEATURES.md](FEATURES.md) first for the whole product, then open the prototypes in order.

## What is real and what is simulated

Real in the prototypes: Markdown rendering with source-line mapping, syntax highlighting, content-type detection, the text transforms, every copy format (written to your clipboard), the collect stack, the palette and its ranking, find, source editing with structural operations, line diffs, the measured line length, themes and type sets, and fold-up.

Simulated, and labelled where they appear: the file system (path checks run against a fixed list, and the changed-on-disk bar appears only on demand from the sample), operating-system surfaces (Finder, Services, Quick Look), and anything that saves or exports.

## Checking the themes

```
python3 tools/audit_contrast.py
```

Run from this directory. It prints each theme's body-text and lowest code-token contrast and exits non-zero if any pair falls below its WCAG threshold. Add `--md` for the Markdown table used in the docs.

## Conventions

- Colours come only from the tokens in `shared/tokens.css`; every page works in all eight themes.
- Lists of rows rather than card grids.
- No emoji in the interface or the documents.
- Each prototype page has a companion `.md` with its anatomy, every control, keyboard map, states, the settings it reads and open questions.

## Rounds 5 and 6

- **Opening a file never leaves the page**: tabs in 01, the Source editor in place in 02, an in-page document view in 04 and 05. Only "Open in Workspace" goes to 01.
- **Sidebar**: the button at the left of the toolbar, ⌃⌘S, the palette ("Show / Hide sidebar"), or rest at the left edge to peek.
- **Copy and Export** sit side by side in the toolbar (Copy is a split button with Copy as; Export opens PDF, Image, HTML, Word, clean Markdown and Print sheets). Reveal in Finder and Open in external editor (⇧⌘E) are on the title's right-click menu and the palette. No collect mode, no stack, no theme button.
- **Extract** has four items; tool strips have at most four buttons per kind.
- **Source** has a 16px column ruler (ticks along the bottom, numbers beside the tens), and never decorates the reader's text to judge it.

## Round 7 keys

⌘K or ⌘P palette · ⇧⌘P commands · ⌘/ transforms (`>Transform`) · `/` in the palette: content search · ⌘E Read ↔ Source (⌘1–⌘3) · ⇧⌘E open in external editor · ⌥⌘R reveal in Finder · ⌃⌘I metadata · ⌃⌘S sidebar · ⌘\ fold. Extract has no key or button (verb menu, palette). Toolbar: New, Copy, Export, Transform, Find, Inspector.
