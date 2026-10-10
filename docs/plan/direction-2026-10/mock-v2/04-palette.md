# 04 Command palette

One field for everything. Open [04-palette.html](04-palette.html); the palette opens over a guide to its modes, and every example in the guide opens it with that query. ⌘K opens it on every prototype page.

## Purpose

Marxy has hundreds of files, dozens of commands and a long list of transforms. The palette makes all of them reachable without a mouse and without remembering where anything lives. Its preview pane is what makes it more than a launcher: you see a file's opening lines, a section's text, or a transform's actual output on your text before committing.

## Anatomy

| Region | Contents |
|---|---|
| Input | Search icon, query, Esc hint |
| Mode chips | One per prefix; clicking swaps the prefix and keeps the query |
| Results | Grouped (Recent, Suggested, Files, Commands, …); matched characters highlighted; icon, title, secondary line, shortcut or age on the right |
| Preview | Depends on the result type (below) |
| Footer | Key hints and the filter syntax |

## Modes

Seven modes, picked by the first character of the query. Transforms are not a mode: they are the group "Transform" under `>` (⌘/ opens it there), and Extract is the group "Extract".

| Prefix | Mode | Results | Enter | ⌘Enter |
|---|---|---|---|---|
| none | Everything | Empty: recent files and suggested commands. Typed: files, then commands | Open or run | Open in a split |
| `>` | Commands | Every command with its group and shortcut: Navigate, File, View, Copy, Source, Extract, Transform | Run (a transform: copy the result) | ⌘Enter replaces the text, for a transform |
| `#` | Headings here | Headings of the open document, indented by level | Jump | – |
| `@` | Sections everywhere | Every heading in every indexed document | Open at that line | Open in a split |
| `/` | Content search | Matching lines inside files across the collection, with the match marked | Open the file at that line | Open in a split |
| `~` | Folders and repositories | Folders and repositories with paths and counts | Open in the Library | – |
| `:` | Line | Go to line n | Jump | – |

## File filters

Filters combine with free text in Everything mode: `kind:report`, `kind:transcript`, and `in:notes` (collection id or name). Unknown filters are ignored rather than erroring.

## Previews

| Result | Preview |
|---|---|
| File | Type, words and near-duplicate chips, then the first forty lines rendered in the file's own type (code and data highlighted) |
| Command | Name, description or group, shortcut, how to rebind |
| Transform | Name, description, and the transform's output on the current selection or the first 1,400 characters of the document |
| Heading or section | The section's text rendered |
| Collection | Path, file count, watching |

## Ranking

1. A substring match beats a scattered match; a match at the start of the string or of a word gets a bonus.
2. In scattered matches, consecutive characters and word starts score higher.
3. Longer strings are penalised slightly, so a short exact title beats a long one containing it.
4. In the app, recency and frequency add a capped boost, and pinned commands lead the empty state.

## Keys

| Keys | Action |
|---|---|
| ⌘K | Open (Everything); ⌘P is an alias |
| ⇧⌘P | Open in Commands |
| ⌘/ | Open on `>Transform` |
| `/` | Content search (type it first) |
| ⇧⌘O | Open in Headings |
| ⌃G | Open in Line |
| ↑ ↓ | Move |
| ↵ | Choose |
| ⌘↵ | Open in split or replace text |
| ⌥↵ | Open in a new tab |
| ⌘C | Copy the path or transform result without choosing |
| Esc | Close |

## Behaviour details

- The palette remembers the last mode used within a session but always opens empty from ⌘K.
- Typing a prefix switches mode in place; deleting it returns to Everything.
- Transform previews run on at most the first 1,400 characters, so a long document never stalls typing; Enter runs on the full text.
- Results update on every keystroke; the app debounces index queries at 30 ms and keeps the previous results visible until new ones arrive, so the list never flashes empty.

## Accessibility

The palette is a dialog with a labelled input and a listbox; the highlighted item is announced; mode chips are toggle buttons with pressed state; the preview is a live region only when the user pauses on an item for half a second, to avoid chatter.

## Open questions

- Should `@` search body text as well as headings, or stay headings-only and leave full text to the Library?
- Should transforms chained in the palette (`>Transform: emoji then slack`) be supported?

## Files commands

The commands mode lists **New file** (⌘N), **New file in this folder…**, **Fork this file** (⇧⌘N) and **Copy as…** (⇧⌘C). The empty state's Recent group is the sidebar's recent list. Files show the custom kind glyph, tinted for code. The clipboard studio is descoped, so nothing in the palette links to it. `kind:log` and `kind:terminal` filter to logs and terminal captures.
