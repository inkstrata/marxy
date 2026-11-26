# Keys

Every key and chord, by where it applies. "Mod" is Ctrl on Windows and Linux and Cmd on macOS. The
authoritative lists are in code: each command's `key` in the registry (`apps/desktop/src/commands/`,
gathered by `commands()` in `commands/index.ts`), the pane chords (`PANE_CHORDS` in
`apps/desktop/src/pane/keys.ts`) and the Line's chords (`apps/desktop/src/palette/chords.ts`).

## How keys are dispatched

1. Pane chords and the Line's chords are caught first, on the window, by physical key.
2. Then the command registry (`installCommandKeys`, `apps/desktop/src/selection/bind.ts`): the first
   command whose key matches and whose condition holds runs. Then the focused viewer's own keys.

Single-character keys and two-key sequences (`g g`) are **page keys**: they act only when the page or
nothing has focus, the `verbs` setting is on, and no field, editor, menu, dialog or list has focus. A
sequence's second key must come within 900 ms. Inside a field or the Source editor only global chords
act. A few Source chords are written with `Ctrl` and exist on macOS only.

## The cursor

| Key | Does |
| --- | --- |
| `j` / `k` | next / previous part at this level |
| `l` / `h` | into the part / out to its holder (a heading stands for its section) |
| `J` / `K` | grow / shrink a run of parts |
| `]` / `[` | next / previous top-level heading |
| `g g` / `G` | first / last part |
| `Enter` | the verb menu for the part (or for any selection); it names every verb the verb bar does |
| `Esc` | leave "only this" or a lens, then clear the cursor |
| Alt+Shift+↓ / Alt+Shift+↑ | extend to the next block / select the parent block |

## Verbs on the part under the cursor

| Key | Does |
| --- | --- |
| `c` | copy the part's bytes exactly |
| `C` | copy it as a quote with its `path:lines` |
| `e`, Mod+Enter | edit the block in place |
| `t` | tick or untick the task |
| `\` | show the part in Source (a viewer flips to its bytes) |
| `o` | open the part in a tab of its own (an archive entry, an attachment, a cell) |
| `r` | read it another way |
| `x` / `X` | x-ray: the part as stored / reveal the markup the reading left out |
| `z` / `Z` | fold the section / fold every section to its second level |
| `v` | only this part on the page (again or Esc to show everything) |
| `d` | remove the part (staged) |
| Alt+↑ / Alt+↓ | move the part past its neighbour (a section moves with its heading) |
| `<` / `>` | promote / demote a heading with its section |
| `u` / `U` | undo / redo |
| `y` / `T` | collect into the tray / open the tray |
| `n` / `Y` | write a margin note / open the reply page of the file's notes |
| `R` | read the unsaved changes as a patch |

## The Line and its scopes

| Key | Opens |
| --- | --- |
| Mod+P, Mod+K | the Line on Go (again to select its text; Esc closes) |
| Mod+Shift+P | commands (`>`) |
| Mod+/ | transforms |
| `@` `/` `#` `:` `!` `%` `~` `&` (on the page) | the Line in that scope: headings, find, search the workspace, line, change the text, lens, compare, read as |

In the Line: Enter chooses, Mod+Enter opens beside, Alt+Enter takes the scope's second choice (for
find: show only what matches), Tab keeps the result in its panel, Mod+. pins a file, Esc closes.

## Documents

| Key | Does |
| --- | --- |
| Mod+O | open files |
| Mod+N | new scratch document |
| Mod+Shift+N | fork this file beside itself |
| Mod+S | save (or open the changes page first when `review_changes` is on) |
| Mod+Shift+S | save as |
| Mod+Z / Mod+Shift+Z | undo / redo |
| Mod+F | find in the page |
| Mod+Alt+F | find and replace (Source) |
| Mod+Shift+C | Copy as… |
| Mod+V (Read) | paste the clipboard as a new scratch document |
| Mod+Alt+Shift+V | paste as plain text (Source) |
| Mod+Alt+E | open in the external editor |

## View and window

| Key | Does |
| --- | --- |
| Mod+E | switch between Read and Source; the caret is in the editor, at the reading line or where it was left |
| `g r` | Markdown from 5 MB: show rendered (the whole page, parsed first), or again back to lines |
| Mod+1 / Mod+2 / Mod+3 | Read / Read and Source side by side / Source |
| Mod+[ , Alt+← / Mod+] , Alt+→ | back / forward |
| Mod+\ | the page alone (hide rail, drawer and tabs) |
| F11 (Windows and Linux; macOS keeps it for the system) | full screen: the window fills the screen and the page is alone; F11 again, or Esc when nothing else wants it, leaves |
| Mod+Alt+\ / Mod+Shift+\ | open beside / close the pane |
| Mod+Alt+← / Mod+Alt+→ | focus the left / right pane |
| `b`, Mod+B (outside an editor) | cycle the left section: open, rail, hidden |
| Mod+Alt+B | show or hide the Metadata panel |
| Alt+1 … Alt+8 | Places, Metadata, Outline, Links, Search, Transforms, Export, Versions |
| Mod+Shift+E / Mod+Shift+F / Mod+Alt+R / Mod+Alt+V | Places / Search / Transforms / Versions |
| Mod+Alt+T / Mod+Alt+C / Mod+, | Look (the Studio) / Clip / Settings |
| `g t` / `g T` (also Ctrl+Tab / Ctrl+Shift+Tab on macOS) | next / previous tab |
| `g ]` / `g [`, Mod+Alt+] / Mod+Alt+[ | open the next / previous file in this file's folder, in the folder page's order, in the same tab; none past either end (the chords are left to a Source editor, where Cmd+Alt+[ and ] fold on macOS) |
| Alt+W | close the tab |
| Mod+Shift+T | reopen the last tab closed |
| Mod+= / Mod+- / Mod+0 | text larger / smaller / default |
| Mod+Alt+N | focus the newest notice |

## Looks

| Key | Does |
| --- | --- |
| `a` | the look pop-over (looks, size, measure, leading, day or night, lean back) |
| `A` | open the Studio |
| `+` or `=` / `-` / `0` | text larger / smaller / the look's own (they stand aside on a viewer page) |
| `N` | day or night |
| `B` | lean back |

## Source editor

CodeMirror's default, history and search keys, minus the chords the app owns, plus:

| Key | Does |
| --- | --- |
| Mod+S / Mod+Shift+S | save / save as |
| Mod+B / Mod+I | bold / italic (Markdown) |
| Mod+L, Mod+D, Mod+Shift+L, Mod+Shift+K | select the line, select the next occurrence, select every occurrence, delete the line |
| Ctrl+Shift+[ / Ctrl+Shift+] (Cmd+Alt+[ / ] on macOS) | fold / unfold |
| Alt+↑ / Alt+↓ | move lines |
| Enter / Mod+Enter in the replace field | replace one / preview "Replace all…" |

The block editor (`e`) opens with the caret at the end of the block's text, after any list or quote marker, and leaves with Esc or Mod+Enter, folding the text in as one undo step.

## Panels

Tab on the page hands the keys to the open panel; Tab or Esc gives them back. In a panel: `j` `k` and
the arrows move, `l` opens or descends, `h` folds or goes up, Enter opens the row's verb menu, `O` opens
beside, Space ticks, `/` goes to the field, and each row's own single-letter verbs are shown in the
panel's foot ([using-marxy.md](using-marxy.md#panels)).

## Viewers

| Viewer | Keys |
| --- | --- |
| Hex | arrows and PageUp/PageDown move the byte; Mod+Home / Mod+End first and last byte; Enter in Go to jumps to an offset |
| Image | ← / → previous and next image in the folder; `+` `-` zoom; `0` fit; `1` 100%; Ctrl or Cmd with the wheel zooms |
| PDF | `+` `-` zoom, `0` fit width, `1` 100%; Home / End first and last page; PageDown or → next, PageUp or ← previous |
| Sheet, database | ← → Home End step the sheets or tables; Esc lets go of a cell; Enter in Go to row jumps |
| Font, archive | Esc lets go of the glyph, clears the archive's filter |
| Table lens (CSV in Source) | arrows and PageUp/PageDown move the cell; Mod+C copies the value; Mod+Shift+C Copy as; Esc back to Source |
| Log | Enter or Space on a hidden run shows it; Esc shows every level |
| Transcript | Mod+C copies the turn or output; Esc deselects |

## Menus and notices

In a verb menu: ↑ ↓ Home End move, Enter or Space run, Esc or Tab close. A focused notice: Esc dismisses,
Tab and the arrows step through its buttons. App pages (tray, reply) close with Esc; in them `j` and `k`
move, and in the tray Alt+↑/↓ reorder, `d` removes and `n` edits the note.
