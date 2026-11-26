---
title: "Marxy: the next wave"
short_title: Marxy next wave
subtitle: Four rounds to follow round 4. Repairs a reader meets every day come first, then big files and moving between files, then books and pages. A last round is a menu held for your call. Every round also carries one slice of the scout's structural work and ends with a build you can install.
kind: Plan
date: 2026-11-19
status: Draft for review
status_color: warn
crumb: Marxy / next wave
extra_css: marxy-next-wave-plan.css
stale_after: 14
sortable_tables: false
related:
  - {label: product-walk.md, href: next-wave-2026-11-19/research/product-walk.md}
  - {label: scout-residue.md, href: next-wave-2026-11-19/research/scout-residue.md}
  - {label: neighbours.md, href: next-wave-2026-11-19/research/neighbours.md}
  - {label: archive-ideas.md, href: next-wave-2026-11-19/research/archive-ideas.md}
  - {label: kind-coverage.txt, href: next-wave-2026-11-19/research/kind-coverage.txt}
  - {label: baseline-times.txt, href: next-wave-2026-11-19/research/baseline-times.txt}
---

# The plan

## The short version {#short .feature}

Marxy's reach is ahead of its finish. It opens almost anything, and most of what it opens lands well, but the things a reader does a hundred times a day (press a key and type, open a text file, step to the next file) still go wrong in ways that are cheap to fix. So this wave repairs first and reaches second.

- **Round 4 lands first.** The loop session is building it now; three of its four branches were committed while this plan was being written.
- **Round 5, keys and lines:** typing goes where the reader is looking, plain text keeps its lines, every file brings its folder, and the page's furniture shrinks to one line.
- **Round 6, big files and the file beside:** a 20 MB log reads as quickly as a small one, and a key steps to the next file in the folder.
- **Round 7, books and pages:** an EPUB opens as a book, code and web pages land readable.
- **Round 8 is a menu, held:** pictures Windows cannot draw yet, and cards that say what a program or a certificate is.

| Track | Round 5 | Round 6 | Round 7 | Round 8 (held) |
| --- | --- | --- | --- | --- |
| **Repair**<br>from the walk | `typing`<br>`as-written`<br>`in-its-folder`<br>`furniture` | `room`<br>`line-by-kind` | `land-readable`<br>`rows-first`<br>`log-colour` | |
| **Scale**<br>big files | | `lines`<br>`find-in-buffer` | `md-on-request`<br>`tail` | |
| **Flow**<br>between files | | `beside`<br>`full-screen` | | `read-aloud` |
| **Reach**<br>new kinds | | | `epub`<br>`by-content` | `heic` `pictures`<br>`program-card` `cert-card`<br>`rtf` `invites` `more-archives` |
| **Trust**<br>from the scout | `integrity`<br>`small-trust` | `save-guard` | `command-scope` | `lifetimes` `budgets`<br>`one-view` |
| **Loop** | `verify`<br>installer | `start-time`<br>`fast-browser-tests`<br>installer | installer | installer |

Rounds 5 and 6 are specified below. Round 7 is planned and should be re-cut from what 5 and 6 turn up. Round 8 waits on your answers in [Decisions for you](#decisions). Every question there has a default, so round 5 can start on one word once round 4 is in.

## Where things stand {#state}

- **Master** is `b400114`: rounds 1 to 3 merged. Today's run of the fast checks is green: type check, lint, `pnpm check` 9 of 9, and the core suite (4,036 pass, 3 skipped, 196 s).
- **Round 4** stopped mid-edit at 16:42 when the loop session reached its usage limit, with two Opus builders and a Sonnet builder running, and picked up again this evening. As of 20:40, `jumplist`, `search-big` and `msg` have commits on their branches and `big-tables` is mid-edit; none is merged. Nothing in this plan touches them.
- **The installed Marxy** is the build of 18 November (`42570b7`). It has none of rounds 1 to 3: no 7z, no Word documents, no Open with entries. Those entries have never been tried on a real install.
- **Worktrees:** 73 folders under `worktrees\` and 79 branches, nearly all merged and waiting on your word to remove.

## What the research found {#found}

Five lines of research ran side by side, each on the model that fit it ([how](#method)). Their reports are linked in the bar's menu.

### A walk of every surface: 13 repairs, 1 new thing

An Opus critic drove the real app through eight daily jobs and took 169 pictures. Of 35 first landings, 24 are good, 6 thin, 4 wrong and 1 broken. Its ranked list has 14 items and 13 are repairs. The first three:

1. **Typed letters run as commands.** After Mod+E the editor shows but the page keeps the keys. `e` opens the block editor with the caret before the list marker. A second Mod+P closes the Line, and the file name you type next runs as verbs.
2. **Plain text loses its lines.** A `.txt` with short lines, a table of tide times or dated notes is read as Markdown and joined into paragraphs.
3. **A PDF, image, sheet or Word file opened on its own has no folder:** Places calls it "Loose" and its crumbs start with a bare `/`. This needs confirming in the real window.

What it said to leave alone: the typeset page, verse, the Outline, the spine, find, links, two panes, staged edits and the changes page, and the mail, SQLite, notebook, font, Word and deck pages.

### The scout's findings: 20 of 29 still open

The seven it ranked first are fixed. Twenty of its 29 rows are still open, none severe alone: the "(mine)" copy and Fork write UTF-8 for a file that is not UTF-8; one in-place edit path can land on bytes that moved; a broken `config.toml` reverts in silence; `docs/architecture.md` describes a save check in Rust that does not exist. Of its ten structural items, six are part done and four untouched, and the counts behind them have not moved: `rendered-view.ts` is 2,764 lines with one 2,377-line function, and 445 listeners are added against 107 removed.

### Found while planning: the app knows a log and sets it as a paragraph

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/log-txt-today.png" alt="A log saved as .txt: the Metadata panel counts its levels while the page sets it as a paragraph with a stretch of maths" width="100%">
<figcaption><span class="tag">Today</span>A log saved under a <code>.txt</code> name, on master. The Metadata panel says "A log", counts 535 INFO, 26 WARN and 13 ERROR, and gives its first and last times. The page beside it sets the same file as one paragraph, and reads the text between two <code>$</code> signs in a SQL line as maths.</figcaption>
</figure>

The kind is found by shape, but only a file whose name says `.log` gets the log page. And the pattern that tells a log line knows 2 of 12 common shapes I tried: ISO time with a level, and log4j. It does not know the lines Windows writes (CBS and DISM, WindowsUpdate, IIS), nor syslog, nginx, Python's logging, .NET's console or Serilog.

### Neighbours: one table stake is missing

Across ten tools a Windows reader might otherwise use (Peek, QuickLook, SumatraPDF, Typora, Obsidian, VS Code, Okular, Calibre, Explorer's preview, Notepad++), the shared expectations are: opens from Explorer, **next and previous file in the folder from the keyboard**, instant start, an outline, tabs that come back, zoom and print, a remembered place. Marxy has all but the second, and its start time has never been written down. None of the ten combines data, logs, diffs, notebooks, mail and byte-exact editing, and none promises no network. Those are Marxy's own.

### The archive: a measured plan nobody built, and your earlier rulings

- **A big-file tier** was planned on 17 November and never built. Its measurements: a 20 MB log holds 534 MB once open and 2.4 GB after Ctrl+End and a find; a 50 MB Markdown file takes 34.6 s to show its title. Its four questions to you were never answered.
- **Reach items an earlier plan proposed** and nobody built: HEIC through Windows' own codec, comment-tolerant JSON as a tree, more picture formats, credential files kept out of Find. That plan's default for each was yes; your answer is not on record.
- **Your rulings**, kept as fences for this plan: nothing that records what was read or reports what changed; no network, updater or crash reports; nothing a file holds is run; no grid of tiles; no stacked chrome, tinted tags or pill rows; bytes are the document.

# The rounds

## Round 4 lands first {#round4}

The loop session owns it and is building it now. Three things to look at when it is reviewed:

- **`jumplist`** hands the names of opened files to Windows' recent list. Settings › Privacy lists what Marxy keeps and what leaves the app; this belongs on that list.
- **`msg`** reads a compound file. The same container holds `.doc`, `.ppt` and `.msi`, which is what makes round 8's `legacy-office` affordable.
- **`big-tables`** (many rows) and round 6's `lines` (many lines) are neighbouring problems. The `lines` builder reads what `big-tables` did before starting.

## Round 5: keys and lines {#round5}

What the reader gets: typing never runs a command by accident, a text file looks like the file, every file sits in its folder, and a page starts with its content.

| Branch | What changes for the reader | Why | Size | Builder |
| --- | --- | --- | --- | --- |
| `typing` | Mod+E and the Source button put the caret in the editor at the reading line. `e` opens with the caret after the list or quote marker, at the end of the block's text. Mod+P on an open Line selects its text instead of closing it; Esc closes it. The Enter menu and the verb bar name the same verbs. | Walk 1. A typed word merged two task items (below). | S | Sonnet |
| `as-written` | A `.txt` keeps its lines unless it carries Markdown marks. A file whose kind was found by its shape gets that kind's page: a log named `.txt` reads as a log and its `$` is not maths; a prompt-and-output shape outranks a dated name. The log-line pattern learns the shapes Windows and the common servers write. | Walk 2 and 8; the picture above; 2 of 12 log shapes known. | M | Opus; goldens re-run |
| `in-its-folder` | A PDF, image, sheet or Word file opened on its own brings its folder into Places and the crumbs, as a text file does. Places counts a `.docx` as a document, not as bytes. | Walk 3. Confirm in the real window before building. | M | Sonnet |
| `furniture` | One line of meta above a reading: the caption is the key that opens "How this is shown". Front matter becomes a byline under the title. The page keeps a foot as tall as the verb bar. One notice per event. A find bar stays with its document. The fold is drawn once on a gzip page. | Walk 4, 6 and 12; drawings below. | M | Opus, high |
| `integrity` | The "(mine)" copy and Fork keep a file's encoding. An in-place edit cannot land on bytes that moved. Closing during a save cannot write UTF-8 over a UTF-16 file. One store per file whatever the case of its path. | Scout, open: two medium, one medium-low, one low. | M | Opus |
| `small-trust` | A `config.toml` that cannot be read says so in a notice. Credential files (`.npmrc`, `.netrc`, `*.pem`, `id_rsa`) stay out of Find as `.env` does. CSV export disarms cells that start `= + - @`. HTML trust granted in one pane reaches the other. | Scout open items; the reach plan's default of yes, never built. | S | Sonnet |
| `verify` | For the loop: one command checks a tree in tiers and prints what each step cost. | The whole-tree script lives in a session scratchpad that a reboot clears. | S | Sonnet |

<figure class="shot">
<img src="next-wave-2026-11-19/research/walk/shots/j5-22-e-left.png" alt="After pressing e on a task and typing a word, two task items have merged" width="100%">
<figcaption><span class="tag">Today</span>From the walk: <code>e</code> on the second task, then the word "edited". The caret opened before the item's <code>- [ ]</code>, so the word joined it to the task above. The head says Unsaved, 1 place.</figcaption>
</figure>

### One line of meta

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/meta-today.png" alt="Today: a caption line, then How this is shown on its own line, then the data" width="852">
<figcaption><span class="tag">Today</span>A JSON file: a caption, then the fold on a line of its own, then the data. True size.</figcaption>
</figure>

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/meta-mock.png" alt="Mockup: the caption is the fold's key, on one line" width="852">
<figcaption><span class="tag">Mockup</span>The caption is the fold's key. Press it and the same sentences open beneath. Viewers put this key at the end of their toolbar row; a fenced block inside a Markdown page carries none.</figcaption>
</figure>

### Front matter as a byline

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/byline-today.png" alt="Today: author, title, date and sample in a table above the heading that repeats the title" width="852">
<figcaption><span class="tag">Today</span>The front matter stands above the title and repeats it.</figcaption>
</figure>

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/byline-mock.png" alt="Mockup: the title first, then author and date as one quiet line" width="852">
<figcaption><span class="tag">Mockup</span>The title is the first thing on the page. Author and date are one quiet line under it; every other key is in Metadata and in x-ray.</figcaption>
</figure>

## Round 6: big files, and the file beside {#round6}

What the reader gets: a large log or text file opens, scrolls and searches like a small one, and one key moves to the next file in the folder.

| Branch | What changes for the reader | Why | Size | Builder |
| --- | --- | --- | --- | --- |
| `lines` | From 5 MB a log, text or code file is drawn as lines, and only the lines on screen. Ctrl+End lands on the last line. A resize no longer restyles the whole page. | The 17 November plan, steps B1 and B6: 534 MB for a 20 MB log when measured. Measure again on master first. | L | Opus, high |
| `find-in-buffer` | Find reads the held text in slices and marks only drawn rows, in the line view and on ordinary pages. | Same plan, B2: find frames of up to 1.3 s when measured. | M | The `lines` builder, after it |
| `beside` | `g ]` and `g [` open the next and previous file beside this one, in the order its folder page lists. The file crumb's menu, which already lists the folder, shows the keys. | The one table stake missing. Today only images step. | S | Sonnet |
| `room` | Data tables widen to the pane before hiding a column. Monospace lines wrap at the pane's edge, not the prose measure. A wide diagram scrolls. A window with no saved layout opens the drawer only when the page keeps its measure beside it. | Walk 5 and 10: "1 more column" beside 300 px of empty pane. | S | Opus, high |
| `line-by-kind` | A word that names a kind or an extension narrows the Line ("ragged pdf"). Rows wear their kind's icon and a viewer's first facts. On an empty window the first row is Open a file. | Walk 9 and 14. | S | Sonnet |
| `full-screen` | F11. In full screen the page alone is the resting state. | Expected of a reader; no key today. | S | Sonnet |
| `save-guard` | Saving checks the file against what was read inside Rust, on the open handle, just before the rename. The whole file is no longer read again before every save. `docs/architecture.md` becomes true. | Scout, structural item 3, untouched. | M | Opus |
| `start-time` | For the loop: cold start of each round's build, recorded. | Neighbours are praised for starting at once; no number is on record. | S | Haiku runs it |
| `fast-browser-tests` | For the loop: the browser tests of one run share one server, or one built harness, instead of starting a Vite server per file. | Each of 230 files spends about ten seconds starting (measured on three). | M | Sonnet |

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/lines-mock.png" alt="Mockup: a 20 MB log drawn as numbered lines in the real window" width="100%">
<figcaption><span class="tag">Mockup</span>A 20 MB log as lines, drawn in the real window. The reading's name is Lines, and the fold says why in two sentences.</figcaption>
</figure>

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/lines-mock-tools.png" alt="Mockup at true size: the Lines head, the fold and numbered log lines" width="852">
<figcaption><span class="tag">Mockup, true size</span>Each line as the file writes it, numbered. The time takes the comment colour, a warning or error level is bold, and a long line wraps under itself. The level filter, find and the outline still read the whole file.</figcaption>
</figure>

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/beside-mock.png" alt="Mockup at true size: the file crumb's menu with g [ and g ] beside the neighbours" width="852">
<figcaption><span class="tag">Mockup, true size</span>The file crumb's menu exists today and lists the folder. The only addition is the two keys beside the neighbours. No new control.</figcaption>
</figure>

## Round 7: books and pages {#round7}

What the reader gets: a book reads as a book, and source files and web pages open as something to read.

| Branch | What changes for the reader | Why | Size | Builder |
| --- | --- | --- | --- | --- |
| `epub` | An EPUB opens as one page in the book's own order. Its contents are the Outline, its pictures come from the file, and the place is remembered. A locked book says so. Read as… still shows the archive. | Today a book opens as a list of its parts (below). An earlier plan left this as your decision. | L | Opus, high |
| `land-readable` | A source file lands in Read's coloured code reading with Source one key away. An `.html` file lands as the sandboxed page mail already uses, with scripts and remote content left out and named. | Walk 7: three rows of editor chrome before the first line; Read on HTML is blank. Your call first. | M | Opus |
| `rows-first` | An image folder lists as rows with a small picture at the start. What search leaves out folds to one line at the foot. | Walk 11, and "not a grid". The archive page's plan is a separate question. | S | Opus, high |
| `log-colour` | Colour a log asks for is drawn in the theme's own tones, with the escapes hidden. X-ray shows the bytes. | Walk 13, the one new capability on its list. | S | Sonnet |
| `md-on-request` | Markdown past the tier opens as lines with Show rendered. The Outline comes from a scan for headings. | Same plan, B3: a 50 MB file took 34.6 s to show its title. | M | Opus |
| `tail` | A growing log appends its new lines and stays at the end when it was there. | Same plan, B4. | M | Sonnet |
| `by-content` | `tsconfig.json`, `.jsonc` and `.json5` read as a tree. An unknown name whose text is XML or JSON reads as that (`.config`, `.manifest`, `.map`). | The reach plan's "most-met rough edge". The registry knows 131 of the 313 names I tried; unknown text falls to plain text. | S | Sonnet |
| `command-scope` | The Rust file commands answer only for files the reader opened, places chosen and the data folder. Indexing a file no longer makes it servable. | Scout, structural item 9, untouched. | M | Opus |

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/book-today.png" alt="Today: an EPUB opens on the archive page as a list of XHTML files" width="100%">
<figcaption><span class="tag">Today</span>A six-chapter EPUB on master. Marxy says it "reads like a document packed as an archive" and shows the packing.</figcaption>
</figure>

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/book-mock.png" alt="Mockup: the same book set as a page, chapters in the Outline" width="100%">
<figcaption><span class="tag">Mockup</span>The same book as a page, drawn in the real window with the tools the Markdown page already has: the Outline lists chapters with their lengths, the crumbs name the chapter, the spine maps the book, notes sit in the margin.</figcaption>
</figure>

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/book-mock-tools.png" alt="Mockup at true size: the tab, the Outline with chapters, the crumbs" width="852">
<figcaption><span class="tag">Mockup, true size</span>No new control. The panel's foot keeps the verbs that read (go, fold, copy the chapter) and drops the ones that rearrange.</figcaption>
</figure>

## Round 8: pictures, and what is this file? {#round8}

A menu, not a commitment. The first three rows were planned before and never built. The rest reopen types an earlier reach plan chose to leave at the card and hex view, so they wait for you.

| Branch | What changes for the reader | Size | Standing |
| --- | --- | --- | --- |
| `heic` | iPhone photos draw on Windows through the system's own codec. Without it, the card names the two Store extensions. Nothing is bundled. | M | {ok: planned, default yes} |
| `pictures` | PNM, DDS and farbfeld (features of the image crate already in the build), SVGZ, and a PSD's own preview. | M | {ok: planned} |
| `media-names` | The card says honestly what this system can play; more audio names are recognised. | S | {ok: planned} |
| `program-card` | An `.exe` or `.dll` says what it claims to be: product, version, company, what it was built for, whether it carries a signature (read, never verified). Nothing is run. | M | {info: held} |
| `cert-card` | A `.cer`, `.crt` or `.pem` says who it names, who issued it and when it ends. | S | {info: held} |
| `rtf` | An `.rtf` reads as text through the Word page's model. Windows 11 dropped WordPad in 24H2. | M | {info: held} |
| `invites` | An `.ics` or `.vcf` reads as a card. They arrive as mail attachments, which already open as tabs. | S | {info: held} |
| `legacy-office` | `.doc` and `.ppt` as text. They are compound files, as `.msg` is, and the crate that opens those is already in the build. | L | {info: held} |
| `more-archives` | `.zst` and `.tar.zst` (the codec is in), `.deb`, `.cab`, an `.iso` listing, a `.rar` listing only. | M | {info: held} |
| `read-aloud` | The page read by a Windows voice installed on this machine. Local voices only. An optional feature. | M | {info: held} |
| `lifetimes`, `budgets`, `one-view` | Structural: every installer registers what it must undo; untrusted input gets work budgets; the 2,377-line view function is split and keys are routed once. | L, gradual | {ok: scout items 5, 6, 10} |

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/program-today.png" alt="Today: a program's card says No reading for this file" width="852">
<figcaption><span class="tag">Today</span>A setup program: "No reading for this file", its size and its first bytes.</figcaption>
</figure>

<figure class="shot">
<img src="next-wave-2026-11-19/mockups/program-mock.png" alt="Mockup at true size: the card with what the program says about itself" width="852">
<figcaption><span class="tag">Mockup, true size</span>The same card with what the file says about itself, each claim marked as the file's own. It follows the shortcut card of round 3. The button that would start it stays off.</figcaption>
</figure>

# Running it

## How the loop should run this wave {#running}

The loop's method from round 3 holds: one worktree per branch, a reviewer on a different model reading only the delta, an integration worktree, the full check, then master moves on your word. Six changes for this wave:

1. **Repairs are proved by the key, not the code.** `typing` is done when a test presses each way into editing and types a word, and the word is in the file.
2. **Drawings before builders** for `furniture`, `room`, `lines`, `epub` and `rows-first`. The mockups here are the first drawings. They were made in the real window by planting files in the web build (`next-wave-2026-11-19\mockups\mocks.mjs`), so a builder can open the same state.
3. **No more than two Opus builders at once.** Round 4 lost about four hours to the usage limit with two running. Opus goes where a wrong design or a parser of hostile input is the risk; Sonnet builds bounded changes; Haiku runs and reads.
4. **Every round ends with an installer** in `builds\`, the real-window check and a start-time number. The browser build cannot show places for viewer files, full screen, HEIC, the save guard, Open with or the jump list.
5. **`verify` moves into the repository in round 5** and every later round uses it.
6. **Small bugs ride with the builder already in that folder.** The walk lists 14; two are in no row above: a tool result with no id hides its output in a JSON Lines transcript, and one tick in the Search panel is off with no reason shown. The scout's low rows go with the structural item that closes them.

### Merge order in round 5

Branches share files, so they merge in this order, each merging master before its review: `integrity`, `as-written`, `typing`, `in-its-folder`, `furniture`, `small-trust`, `verify`.

### What the checks cost today

All green. One run each on this machine while other work was running, so read the times as upper bounds.

| Check | Size | Wall time |
| --- | --- | --- |
| Type check, lint, `pnpm check` | 9 repository checks | under 2 minutes together |
| Core suite | 4,039 tests | 196 s |
| Theme suite | 305 tests | 56 s |
| Typeset suite | 76 tests | 49 s |
| Desktop unit tests | 1,202 tests in 133 files | 334 s, of which one test (a 9 MB Source scroll) is 126 s |
| Three browser test files, each alone | 3, 13 and 34 tests | 18 s, 47 s and 105 s |
| The whole desktop suite | 230 browser and integration files | "more than an hour" by `docs/testing.md`; not run here |

Two things follow. A full check of a round costs more than an hour of machine time, most of it the browser files, so `verify` needs tiers and a map from changed folders to the files that cover them. And every browser test file starts its own Vite server and browser, about ten seconds before its first check: across 230 files that is over half an hour of a serial run spent starting up, which is what round 6's `fast-browser-tests` removes. One unit test is over a third of its suite, so the quick tier should leave it out. Rust's tests (482 test functions) and the real-window check were not timed.

## Decisions for you {#decisions}

```decisions
Q1 | **Is the order right?** Repairs in round 5, big files and the file beside in 6, books in 7. | Default: as drawn.
Q2 | **The big-file tier's four questions.** Start at 5 MB. Markdown above it opens as lines with Show rendered. Read is read-only past 32 MB (Source still edits). A followed log stays at the end. | Default: all four as the 17 November plan proposed.
Q3 | **Should code land in Read?** Today a source file opens in the editor. | Default: yes, with Source one key away.
Q4 | **Should an .html file land as the sandboxed page?** Today it opens as markup and Read is blank until asked. | Default: yes, as mail's HTML part already does.
Q5 | **The archive page: list first?** The plan to scale was designed on purpose; the walk found its labels clipped and tiles ahead of the list. | Default: keep the plan and fix the labels. Image folders become rows either way.
Q6 | **EPUB as a book?** | Default: yes, round 7.
Q7 | **Which of round 8's held rows?** | Default: `program-card` and `rtf`; the others when you ask.
Q8 | **Keys for the file beside:** `g ]` and `g [` on the page, Mod+Alt+] and Mod+Alt+[ elsewhere. | Default: as written.
Q9 | **Remove the merged worktrees and branches?** `batch7` holds a six-line uncommitted test edit to save as a patch first. | Yours; nothing is removed without your word.
Q10 | **Install each round's build here when it is green?** | Default: build to `builds\`; install on your word.
```

## Not in this wave {#not}

| What | Why not now |
| --- | --- |
| A second window, a tab dragged out | Three to five sessions; every store is per window. Worth a spike after round 7. |
| A preview of Explorer's selection, as Peek and QuickLook do | Needs a process that stays running; `resident` was removed. |
| macOS and Linux builds | No Mac here, and nothing leaves this machine. |
| An updater, crash reports, usage numbers | The network rule. |
| Anything that says what changed or what was read | The fence. |
| Parquet, Arrow, Avro | Large dependencies for few readers. |
| Org, AsciiDoc, reStructuredText as pages | No permissive renderer or grammar. |
| RAR contents | No permissively licensed decoder; a listing is in `more-archives`. |
| Subtitles as a reading | Needs a drawing first; none made here. |
| Removing Proposals | A settings question open since pass 23, not a round. |

## How this was researched {#method}

| Line | Model | What it produced | Subagent tokens |
| --- | --- | --- | --- |
| Walk of the app, eight jobs, 169 pictures | Opus, high effort | `product-walk.md`: 14 ranked items, a verdict per kind, 14 bugs | 401,000 |
| Scout findings checked against master | Sonnet | `scout-residue.md`: every row with a file and line | 178,000 |
| Old plans and the ledger | Sonnet | `archive-ideas.md`: 30 unbuilt ideas, 27 rulings | 238,000 |
| Ten neighbouring tools, on the web | Sonnet | `neighbours.md`: a capability matrix with sources | 143,000 |
| Checks and suites timed | Haiku, then a script | the timings in [Running it](#running); logs in `research\baseline-logs` | 73,000 |

The Haiku runner stalled twice waiting on its own background commands, so I stopped it and a script timed the rest. Three things I did myself: asked the app's own file-type registry about 313 file names (`kind-coverage.txt`), probed the running app with planted files (which found the log set as a paragraph), and drew the mockups. Nothing in the repository or in any worktree was changed.

Not verified: anything that needs the real window (the walk lists eight such points, among them whether a PDF opened from Explorer has a folder), and the big-file numbers, which are from the 17 November build.
