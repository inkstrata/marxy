# History: the Clipboard view's list of what Marxy copied

**Verdict:** change (mock rows 1 to 5, 17). **Decided by:** [ADR-0066](../../../adr/0066-clipboard-history.md),
proposed, option A. **Built by:** J-07, J-08, J-09 in [08-cards-studio.md](../08-cards-studio.md).
**Plate:** [history.html](history.html).

**In short.** Every copy Marxy makes is kept, newest first, with where it came from: the document,
the line, and the format it was copied as. `↵` puts one back on the clipboard. History lives in memory
until Marxy quits unless the reader chose to keep it, and it never watches what other apps copy; the
reader can add the clipboard's current contents by hand, with *Keep the clipboard*.

## Entry points

| Where | What |
| --- | --- |
| Key | `⇧⌘V`, outside an editable field, opens the Clipboard view with the list focused, or closes it; inside one it stays paste as plain text (proposed, pending the author: [README](README.md#for-the-author) item 4) |
| Palette | `>Clipboard history`, `>Keep the clipboard`, `>Pause clipboard history` / `>Resume clipboard history`, `>Clear unpinned clipboard history`, `>Clear all clipboard history` |
| Copy chevron | *Clipboard history…* as the last item of the Copy as menu (toolbar, selection toolbar), after a separator |
| Toolbar | None of its own. The workspace toolbar keeps Copy and Export (W-05); the view is reached from Copy's menu |
| Folded | All of the above work folded; the view opens as one column at the reading measure |

## Layout

Unfolded, the view is History (300 px) beside the workbench ([workbench.md](workbench.md)). The
history pane, top to bottom:

1. **Head.** "Clipboard" and, at the right, a menu (`…`): *Keep the clipboard*, *Pause*, *Clear
   unpinned…*, *Clear everything…*, *Clipboard settings…* (opens Settings › Clipboard).
2. **Search.** One field, `⌘F`. A substring match over the text and the source path, case-folded; the
   row shows the matching line, not the first. No query language at v0.7.0.
3. **Format chips.** All, Pinned, and one chip per format present (Markdown, Plain, Rich, Slack, Jira,
   CSV …), each with its count. A chip filters; counts ignore the search.
4. **Rows,** grouped Pinned, Today, Yesterday, Earlier. A row is two lines: the text's first line
   (or the matching line), then `format · source · age`, where the source is `name.md:42` (the full
   path on hover) or "Kept from the clipboard". A pinned row carries a pin glyph.
5. **Preview** (`Space`), under the list: the first 40 lines of the item as text, the full path and
   byte range, and the representations stored (`text`, `html`).
6. **The foot line,** always present while the view is open (see below).

Folded or below 900 px: one column, the same order; opening an item replaces the list with the
workbench and a back control.

## Rows and actions

The row menu (right-click, `⇧F10`, or the row's `…`) is a verb menu (ADR-0054), at most seven items:

| Action | Key | Does |
| --- | --- | --- |
| Copy | `↵`, `⌘C` | Writes the item's stored representations back as one item, tagged with Marxy as the source, not transient; it moves to the top |
| Copy as ▸ | `⇧⌘C` | J-04's Copy as menu, over the item's text |
| Open in the workbench | `⌥↵` | Loads the text as the workbench's input |
| Open the source | — | Opens the document at the byte range; if the file changed since, at the line, with a notice: "This text has changed since you copied it." If the file is gone, the item says so and the action is disabled |
| Pin / Unpin | `⌥P` | Pinned items never expire and do not count toward the limit |
| Delete | `⌫` | Removes it, files included in `keep`; Undo for 10 seconds |

With several rows selected (`⇧↑` `⇧↓`, `⌘`-click, `⇧`-click, `⌘A`), a bar replaces the preview:
**Copy joined** (oldest first, a blank line between; `⇧↵`), **Pin**, **Delete**, and `Esc` to clear.
*Copy joined* is recorded as one new item. This is what the collect stack produced, with no mode
([collect.md](collect.md)).

## Recording

Recording happens in `writeCopy`, the one function every copy goes through, after the pasteboard
write succeeded, never by reading the pasteboard ([ADR-0066](../../../adr/0066-clipboard-history.md),
option A, and items 1 and 3). Today it is not one path, and J-08 makes it one:

- the verbs (`⌘C` with a selection, Copy as, Extract, a transform's result) call `writeCopy`;
- `runCopyShortcut`'s fallback, `document.execCommand('copy')` (`apps/desktop/src/selection/apply.ts:54`),
  becomes a call to `writeCopy` with the selection's text;
- a `copy` event handler on the document catches native copies (Source's CodeMirror, the Edit menu's
  Copy, any text field) when it has the full text (Source's from the editor's state, a text field's from
  its selection range). It fills `event.clipboardData` synchronously, prevents the webview's write, then
  passes the text and HTML, with its source (the document and byte range for Source), to `writeCopy`.
  In any context it does not recognise it leaves the native copy alone, unrecorded. Cut is the same.

Each copy then goes through these steps:

1. A write marked transient is ignored.
2. If history is `off` or paused, nothing is recorded and nothing is shown.
3. Text over 1 MB is not recorded; a *not recorded* row says "larger than 1 MB".
4. With `clipboard_skip_secrets` on, text matching the secret list is not recorded; the row says
   "looked like a secret".
5. The same text as the newest item moves that item to the top and updates its time.
6. Otherwise one item is added, with `format`, `source` (path, byte range, line) and `origin`
   (`copy`, `workbench` or `kept`), then retention runs.

**Keep the clipboard** reads the clipboard once through J-02 (types first). An item whose types
include `ConcealedType`, `TransientType` or `AutoGeneratedType` is refused before any data is read,
with the notice "The clipboard holds a concealed or temporary item (a password manager's, usually).
Marxy did not read it." (Refusing transient and auto-generated items is the default pending the
author.) An empty clipboard says "The clipboard is empty." Otherwise the text, and HTML when present,
become an item with `origin: "kept"` and no source, through the same steps 2 to 6.

A *not recorded* row shows the source (for Marxy's own copies, the document and line), the reason and
the time, never any of the text. These rows live in memory only, are never written in `keep`, and are
shown only under *All* with no search.

## States

| State | What the reader sees |
| --- | --- |
| Off | The list area says "Clipboard history is off." and one button, *Turn on for this session*, which writes `clipboard_history = "session"`; the foot line links to Settings |
| Empty, `session` | "Nothing copied yet. What you copy in Marxy appears here until you quit." and *Keep the clipboard* |
| Empty, `keep` | "Nothing copied yet. What you copy in Marxy is kept here between launches." |
| Normal | Rows as above; the first row selected on open |
| Large | Up to 500 unpinned items plus pins, 32 MB in all: the list is virtualised (rows drawn only near the viewport); search runs over memory and shows the first 200 matches with "Showing 200 of 1,214 matches" |
| Paused | A line above the rows: "Paused. Copies are not kept until you resume." with *Resume*. Pause is for this session only; it is not written to `config.toml` |
| No match | "No copies match *term*." and *Clear search* |
| Error | The index in `keep` did not parse: it is renamed `index.json.bad-<timestamp>`, history starts empty, and one notice says so and offers *Reveal in Finder*. A missing item file drops that row silently at launch; a failed write leaves the item in memory and says "Could not save this copy to disk; it is kept for this session." |

## The foot line

One quiet line at the foot of the history pane, always true, never a count of use:

- `session`: "Kept until you quit · nothing written to disk"
- `keep`: "Kept between launches in `~/Library/Application Support/marxy/clipboard/` · Reveal"
- paused: "Paused · Resume"

## Keyboard

The list is a `listbox` with `aria-activedescendant`; each row's label is its text's first line, its
format, its source and its age, in that order. Focus order: search, chips, list, preview. Any printable
key typed in the list moves to the search field with that character. Keys are in the
[README](README.md#keys-checked-against-the-rulings).

## It may never

- read the pasteboard except on *Keep the clipboard*, the workbench's input *The clipboard*, or *Run pipeline* (J-02, types
  first); the rule rests on the frontend, since J-01's commands are not permission-gated;
- record a transient write, a concealed, transient or auto-generated item read from the clipboard, a likely secret, or anything over 1 MB;
- write anything outside `<data>/clipboard/`, and that only in `keep`;
- show content in a *not recorded* row;
- store a model, session, tool or tag name, a use count, or which app the reader pasted into;
- use SQLite or any index beyond `clipboard/index.json`;
- let a copy reach the pasteboard without passing `writeCopy`.

## Option B, if the author chooses it

Watching adds three things to this page, and nothing else changes: a *From* filter (Marxy, other apps,
any app) beside the chips; rows from other apps whose source is the app's name; and *not recorded*
rows for other apps (app, reason, time). The switch, the exclusion list and the macOS permission path
are in [rules.md](rules.md#option-b-watching).
