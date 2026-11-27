# Architecture

How Marxy's code fits together: the packages, the path from a file's bytes to a page, how edits and
saves work, the boundary with the Rust shell, and where each part of the front end lives.

## Packages

```
apps/desktop/src            the app (TypeScript, Vite)
  ├─ packages/core          bytes, parsing, kinds, readings, operations, sanitising, highlighting, search
  ├─ packages/typeset       line setting in the DOM
  ├─ packages/theme         tokens, CSS, themes, looks, config.toml
  └─ packages/shell-api     the Shell interface (types)
apps/desktop/src/shell/
  ├─ tauri.ts  ── IPC ──>   apps/desktop/src-tauri (Rust: files, watching, archives, decoders, OS)
  └─ memory.ts              an in-memory shell for the browser build and the tests
```

| Package | Depends on | Holds |
| --- | --- | --- |
| `@marxy/core` | micromark and mdast (Markdown), Shiki (colour), smol-toml | the buffer and splice, the parse to a tree with byte provenance, the source map, file types and kind detection, readings, operations and transforms, the sanitiser, the highlighter, diff, the index model and query language, pure viewer logic, Word documents and decks read into Markdown (`office/`), EPUB books read into one Markdown page (`book/`); no DOM and no Node built-ins, so it runs in the webview, in Node tests and in the gates |
| `@marxy/typeset` | `justif` (hyphenation patterns, hanging tables) | ragged-right line breaking, hyphenation, hanging punctuation, the baseline grid |
| `@marxy/theme` | smol-toml | `tokens.css`, `base.css`, `frame.css`, `left.css`, the bundled theme sheets, the look engine, `config.toml` parsing and editing, the settings schema |
| `@marxy/shell-api` | nothing | the `Shell` interface: every privileged operation the core app needs |
| `@marxy/desktop` | all of the above, CodeMirror 6, pdf.js, KaTeX, Tauri's JS API | the app and the Rust shell |

`scripts/check-boundaries.mjs` (run by `pnpm check`) enforces these lines: core takes no DOM globals and
no Node built-ins, typeset and theme take no Tauri or Node, shell-api imports nothing, and only
`apps/desktop/src/shell/` may import `@tauri-apps` or call `invoke`.

## From bytes to page

```
path ─ shell.detectFiles (head) ─ shell.readFile ─ decode if not UTF-8 ─ buffer
     ─ file type + kind ─ parse (Markdown) or code pieces or a reading ─ render ─ sanitise
     ─ progressive mount ─ typeset ─ idle passes (colour, maths, images, diagrams)
```

1. **Bytes.** `shell.readFile` returns the file's bytes untouched. A file that is not UTF-8 is decoded
   by the shell into UTF-8 with a byte map back to the file (`apps/desktop/src/document/encoding.ts`).
2. **Buffer.** `createBuffer` (`packages/core/src/buffer/buffer.ts`) keeps the bytes as they are (no BOM
   stripped, no line endings changed) and derives the text, the UTF-16-to-byte offsets, the BOM and the
   line-ending style. `splice` is the only producer of new bytes.
3. **Type and kind.** `fileTypeOf` and `detectKind` (`packages/core/src/kind/`) decide the reading,
   the viewer, the mode it opens in and the kind ([file-kinds.md](file-kinds.md)).
4. **Parse.** `parseMarkdown` (`packages/core/src/parse/parse.ts`) runs micromark with GFM, front matter
   and maths and converts the result to Marxy's tree, in which every node carries `src: {file, start,
   end}`, a byte range in the file (`packages/core/src/contracts/ast.ts`). Code and plain text become
   pieces of up to 200 lines (`parseCode`). Large files are parsed in slices; an edit reparses only the
   region it touched (`reparseMarkdown`), with the same result as a whole parse. Link reference and
   footnote definitions reach across the file, so each parse keeps an index of them (label, target,
   place) and the region is parsed with the file's labels and targets known; an edit that adds, removes
   or changes a definition parses the whole file. A file that may hold a definition is not parsed in
   slices.
5. **Readings.** Data, tables, records, verse, prose, notebooks and transcripts are drawn by
   `readingOf` (`packages/core/src/reading/`) as escaped HTML whose elements carry their byte ranges. A table's or
   records' rows are indexed from the bytes a slice at a time (`reading/rows.ts`); Read keeps the rows near the screen
   on the page and draws the rest from the index as it scrolls, and sorts, filters and finds over every row
   (`view/reading-rows.ts`). A log, plain text, code or Markdown from 5 MB is read as lines the same way: indexed by
   where each line begins and ends in the bytes (`reading/lines.ts`), the lines on screen drawn and the rest
   drawn as the page scrolls (`view/reading-lines.ts`). Markdown read so is not parsed: its Outline comes from a
   scan of the line index (`reading/heading-scan.ts`), and Show rendered (`read-as/show-rendered.ts`) opens it
   again as its page, parsed in slices.
6. **Render and sanitise.** `renderDocumentSafeHtml` (`packages/core/src/render/pipeline.ts`) renders the
   tree to HTML and passes it through the allow-list sanitiser (`packages/core/src/sanitize/`). Provenance
   is written under per-render secret attribute names and published as `data-marxy-s` / `data-marxy-e`
   only on the sanitised output, so a document cannot forge them.
7. **Mount.** `apps/desktop/src/view/rendered-view.ts` puts the page into the pane: two screens from the
   landing place at once, the rest in idle slices (`render/progressive.ts`); after any change to the bytes
   (an operation, undo, redo, a Source commit, a reload), only the changed blocks are replaced when that can be
   proved equal (`render/incremental.ts`), and the page is set whole when it cannot. With footnotes that holds while
   every label keeps its number: the changed blocks take the document's numbers, and only the items of the list of
   notes whose definitions changed are drawn again. Commits made while Source
   showed are one change from the page as it was left to the newest document, so showing Read again replaces
   the blocks they touched; a theme, size, face, trust or name change meanwhile sets the page whole.
8. **Typeset and idle passes.** `packages/typeset` sets paragraphs; at idle the app colours code in a
   worker (`render/highlight.ts`; the grammars live in the worker's bundle alone, so a page whose worker cannot
   start shows plain lines and logs it once), sets maths with KaTeX (`render/math.ts`), resolves local images
   (`render/images.ts`) and draws Mermaid diagrams (`render/diagram.ts`).
   What each of those made for a text is kept by text (`render/block-cache.ts`: token lines shared with Source, KaTeX
   markup, diagram SVG; bounded by entries and characters, strings and token data only), so the same text drawn
   again is painted at once with no worker post. Colour, spacing and ink are CSS, so a theme change needs no clearing.

Binary files skip the buffer: their viewer (`apps/desktop/src/viewers/`) reads what it needs through the
shell (headers, ranges, archive entries, table pages) and draws its own page; Source shows the hex view.

### Work on untrusted files

Every file is untrusted, so each reader in core bounds the work a file can make it do: bytes read, items kept, levels
nested, steps taken. The shared shape is a budget (`packages/core/src/util/budget.ts`): `budget(limit)` states the limit,
`take(n)` counts work against it and refuses what would pass it, `give(n)` hands back a level on the way out, and
`hit` and `refused` say afterwards that the reader stopped early and how much it left. A reader that stops says so to
the reader in its own words, as the page's notes already do (`Only the first 500 parts are read.`, `The first 100 columns
of more than 10,000; Source has them all.`), and never fails the page. The mail parser, the RTF reader and JSON Lines'
keys count this way; other readers still hold their own constants and counters, listed with their limits in
[file-kinds.md](file-kinds.md#size-limits) and, for the shell, [desktop-shell.md](desktop-shell.md).

Bytes that come in packed or encoded are bounded before they are unpacked, not after. A gzip stream in the page's
archive reader is asked of the injected `Inflate` only one byte past what may be kept (`ArchiveLimits.stream` for a
compressed tar, whose listing then says `the walk stops after 1 GB of unpacked stream`; an entry's 16 MB for a lone
`.gz`), after a look at its first block to tell the two apart. An image's ICC profile is read to 4 MB (`ICC_MAX_BYTES`),
a PNG's unpacked no further and a JPEG's segments gathered no further, and the colour row says when one was past it. A
punycode label is decoded only within a DNS label's 63 octets and refused on RFC 3492 overflow, so the host is shown as
written. The sanitiser keeps the first 100,000 removal records of a pass and counts the rest (`unlisted`), the
truncation record always kept, and holds at most 65,536 elements open: an element past that is not written and its
contents stay as text, which only makes the written tree shallower.

The structure of a file is bounded the same way. A TOML table header is found among its parent's tables by name, not by a
search of every sibling, and the names a file may look up are a budget (250,000): a file past it is set as written and
says so. The Outline of a rendered Markdown file walks the document without the stack and keeps its first 20,000 headings,
as the heading scan of a big file does, and the panel says it lists the first 20,000; the address and the Line read every
heading, which the parse has already bounded. A web page's title is read in one
pass from its first `<title>`, and its tags are taken out in one pass, so a page of unclosed titles or a title of `<` is
linear.

## Documents, edits and saves

- **One store per path** (`apps/desktop/src/document/store.ts`, registry in `document/registry.ts`). A
  store holds the bytes on disk, the buffer, the tree, a node map, the history and a version. Its
  transitions (open, reload, apply, commit Source, undo, redo, save, rename, close) run one at a time and
  compute the next state fully before committing it. Two panes showing one file share its store; a Windows
  path names the same file, and so the same store, whatever the case of its letters or its `.` and `..`
  segments (`fileKey`, which also keys the file's encoding, the reader's encoding choice, the shell's
  stale-write record and write queue, and the watch's match of an event to the open file). A store
  released clean by a pane that moved to another tab stays open, warm, with its watch and history (the
  last three, none over 16 MB; `claim`, `retain` in the registry): the open path takes it back without
  reading, detecting or parsing, reads the file only when an event arrived while no pane showed it or
  its size or times moved since it was kept (an event not yet delivered), and closing the tab closes the
  store. A store whose folder could not be watched is not kept. The sanitised page of a parse is kept per parse and policy
  (`view/rendered-view.ts`), so a return does not render it again. Closing
  tells the views at once, but what is held for the file (its encoding, the shell's record of the last
  read) goes only after a save already under way has written, and the record only if the file was not
  read again in the meantime (a reopened file keeps its own).
- **An edit** is `apply {range, replacement, label, baseVersion}`: a splice over a byte range, refused
  if the bytes changed since the range was resolved. Undo splices the old bytes back. Operations and
  transforms are pure `string → string` functions over the selected text
  (`packages/core/src/operations/`, `packages/core/src/transforms/`).
- **Source** is a CodeMirror editor over the same bytes (`apps/desktop/src/source/`). Bytes that are not
  UTF-8 are held as single code units so they survive edits (`packages/core/src/buffer/source-text.ts`).
  Leaving Source folds its text back into the store as one minimal splice (`foldText`).
- **Saving** (`apps/desktop/src/save.ts`, `document/store.ts`): the bytes are written through the shell's
  atomic write, handed the store's own `disk` (what it last loaded or wrote). The front end does not read the
  file again to save it: it sends the length and SHA-256 of those bytes with the write, and Rust
  (`atomic_write::write_atomic_unless_changed`) opens the file, compares them, stages the new bytes, looks at
  the open file and its name once more, and only then renames over it. A file that changed is refused with the
  shell error code `changed` and nothing is written; a file that is gone is written again. For a file in
  another encoding the baseline is the file's bytes as read, or, when the page text is not what was read, the
  file read again and decoded, standing only if it reads as that text. A write with no baseline of its own (a
  state file) is checked against the shell's record of what it last read there. A copy of the replaced bytes is
  kept (`versions/`) before the save resolves: for a save in place once the shell has accepted it, so a refused
  save keeps nothing; for a Save As onto a file, before the write.
- **Live reload** (`document/live-reload.ts`): each store watches its file's folder. A change is read,
  decoded, and adopted with each view's place carried through it; with unsaved edits, the disk's
  version is held aside instead and the reader chooses. A log that grew (the log page, or Lines) is not read
  whole: `buffer/tail.ts` plans a range read of the last 64 KB held plus the new bytes, the old end must
  match, and the store's `append` splices the new bytes on at the end (a `reload` transition with `appended`).
  A file that shrank, was rotated or rewritten, is held in another encoding or has unsaved edits takes the
  whole read above; the first and last 64 KB held are both checked, only logs are followed (a big edited text
  file is read whole), and from 5 MB a followed file keeps no "compare since reload" copy (`previousDisk`).
  The view stays at the end when it was at the end (`atEnd`, `followEnd`).
- **Closing** (`apps/desktop/src/close.ts`): unsaved work is asked about by a notice in its pane, never a
  modal; quitting walks every unsaved document.

## The shell boundary

`packages/shell-api/src/index.ts` declares `Shell`; the app's extra privileged calls (detection, text
decoding, fonts, media, `run_command`, menus) are typed in `apps/desktop/src/app-types.ts` (`AppShell`).
Two implementations:

| Shell | Used by | Notes |
| --- | --- | --- |
| `apps/desktop/src/shell/tauri.ts` | the desktop app | the only module that calls Tauri's `invoke` and `listen`; sends bytes as raw IPC bodies; refuses relative and archive-entry paths before they reach Rust; debounces watch events |
| `apps/desktop/src/shell/memory.ts` | the browser dev loop, the demo build, the tests | files in memory, watch events emitted by hand, an in-memory archive reader and encoder, stand-ins for the native readers; with `scoped` (the browser build and the app harness), the desktop shell's scope |

**Scope.** The path commands answer only for files the reader opened, folders the reader chose and Marxy's own
data and config folders; a path outside is refused with the shell error code `outside`. Reading or indexing a file
never adds it, and writing is narrower than reading (an index root is read-only). The page tells the shell what the reader opened with `markOpened` before it reads: every open goes
through `OpenPath`'s `readAndShow`, which does; the restored layout tells it each column and tab before probing them;
the index tells it each root it holds; Compare tells it the other file; the theme loader the theme folder. The launch
arguments, a second launch, a drop and the pickers are recorded by Rust itself. Which command needs which set is the
table under "Scope of the path commands" in [desktop-shell.md](desktop-shell.md).

The Rust side is described in [desktop-shell.md](desktop-shell.md).

## Boot

1. Rust creates the window hidden, places it from `window.json`, shows it, and prints startup marks.
2. `apps/desktop/src/main.ts` chooses the shell: in Tauri, `bootApplication` with the Tauri shell; in a
   plain browser in development or the demo build, `harness/web.ts` with the memory shell over
   `fixtures/demo/`.
3. `startApp` (`apps/desktop/src/app.ts`, the composition root) reads `config.toml` and applies it
   before the first paint, creates the persistence, the frame state, the index service and the trust
   controller, adopts the first pane, mounts the frame and opens the launch document (or the saved
   layout, or the empty-state passage).
4. After the first text, `boot.ts` loads the Line, starts the index and the collection, mounts the macOS
   menu and opens files the system asked for meanwhile.

Startup marks (`mark(...)`, listed in `scripts/registry.json`) time each step; the smoke check and
`scripts/measure-startup.mjs` read them from the binary's output.

### Lifetimes

What a part of the front end listens for on the window or the document outlives it unless it is taken away, and holds
the part (and the document it shows) for as long as the page. The app instance, the frame and each rendered view
create one `AbortController` where they start, give its `signal` to their window and document listeners, and abort it in
`destroy`; the frame also aborts the disposers its installers return. The command keys, the verb bar and the palette's chords are the app's too: `destroy` takes them off, and what stays counted
(the parts cursor's click handler, the file-drop listener, the viewers' key handler) is installed once for the window. A second `startApp` in the same page (the tests
start several) destroys the first, which then leaves nothing listening. The same holds for the shell: the native menu, the close guard and the open-files subscription return disposers that `destroy` calls, a stale disposer never clears a newer boot's, and opens taken from the shell's queue while no boot is subscribed wait for the next one. `check-listeners` keeps the count of window and
document listeners with no signal and no remove from growing, and `apps/desktop/test/lifetimes.test.mjs` opens
documents of many kinds, splits and closes panes and restarts the app, and checks that listeners, observers and
intervals come back to their count and that a closed pane's view, page and document can be collected.

## The front end's modules

Folders under `apps/desktop/src/`:

| Folder | Holds |
| --- | --- |
| `app.ts`, `boot.ts`, `main.ts`, `close.ts`, `save.ts`, `title.ts` | composition root, boot, quit and close, save, window title |
| `document/` | the store, the open path, encodings, live reload, scratch documents, entries held in memory, fork and new files |
| `view/` | Read's page in a pane: show, mode switching, progressive mount; a table reading's rows, its sort and its row filter; a big file's lines |
| `render/` | rendering passes: highlighting and its worker, colour tiers, maths, images, diagrams, long lines (a run of more than 4096 characters with no space gets a `<wbr>` every 4096 and `font-kerning: none` through `marxy-long-run`, in Markdown, mail and Word/RTF pages), incremental replacement, invisible characters, link labels |
| `source/` | the CodeMirror editor and its frame, language support, replace, folding, editorconfig, stray bytes, notes about a file |
| `selection/` | the Markdown cursor, pointer selection, the verb bar and verb menu, the key dispatcher |
| `parts/` | the parts cursor over readings and viewers |
| `depths/` | x-ray, reveal, folds, "only this" and lenses |
| `commands/` | the command registry and every command family |
| `palette/`, `line/` | the Line: view, scopes, search ranking, history, chords |
| `pane/` | panes, splits, the divider, focus, pane chords |
| `frame/` | the window frame: tab row, pane head and crumbs, spine, app pages, folder page, the page's line of meta and its account (How this is shown), cards, menus |
| `left/` | the rail and drawer, and the eight panels in `left/panels/`; a list of hundreds of rows drawn a window at a time (`row-window.ts`) |
| `viewers/` | the file card, hex, image, PDF, media, sheet, SQLite, font, mail, HTML page, archive, office (Word documents and decks, Word 97-2003 ones read by the shell) and book (EPUB) viewers |
| `kinds/` | kind-specific views: table lens, log view, transcript view, kind profiles |
| `read-as/` | the Read-as ladder and the bytes choice |
| `changes/`, `tray/`, `notes/`, `versions/` | staged changes and the changes page; the tray and reply page; margin notes; earlier copies |
| `export/`, `transform/` | export forms and writing; the transform sheet and chains |
| `find/` | find in Read |
| `index/`, `collection/` | the per-folder index, places from `collection.toml` |
| `look/`, `studio/`, `theme/` | painting looks, the Studio, user themes, colour per language, font measurement |
| `settings/` | the Settings page and its privacy lists |
| `notices/` | notices and their wording |
| `trust/` | per-document HTML and remote-image grants |
| `position/`, `layout/` | reading places; layout saved and restored |
| `startup/`, `frontispiece/`, `commonplace/` | idle work after first text; the empty-state passage and its pieces |
| `proposals/` | optional features behind Settings › Proposals |
| `paste/` | paste handling |
| `fonts/` | the font manifest and `@font-face` rules |
| `kind-icons/` | icons per kind |
| `harness/` | the browser dev loop, test hooks, the aesthetics gate's entry, stand-in data |
| `shell/` | the two shells and the clipboard bridge |

## Where to start reading

1. `packages/core/src/contracts/ast.ts`: the tree and its byte ranges.
2. `packages/core/src/buffer/buffer.ts`: bytes, `splice`, folding editor text back.
3. `apps/desktop/src/document/open.ts`: what happens when a file opens.
4. `apps/desktop/src/document/store.ts`: every change to a document.
5. `apps/desktop/src/view/rendered-view.ts`: Read's page and mode switching.
6. `apps/desktop/src/commands/index.ts` and `registry.ts`: the commands and their keys.
7. `apps/desktop/src/app.ts`: how the app is put together.
8. `packages/shell-api/src/index.ts` and `apps/desktop/src/shell/tauri.ts`: the shell boundary.
9. `packages/core/src/kind/registry.ts`: file types.
10. `apps/desktop/src-tauri/src/main.rs`: the Rust side's entry.
