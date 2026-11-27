# File types, kinds and readings

How Marxy decides what a file is and how to show it: the file-type registry, detection from bytes,
reader kinds, the readings of Read, the viewers, and the size limits. The registry and detection live
in `packages/core/src/kind/`; readings in `packages/core/src/reading/`; viewers in
`apps/desktop/src/viewers/` with their pure logic in `packages/core/src/viewer/`.

## Three questions per file

| Question | Answered by | Example |
| --- | --- | --- |
| What type of file is it? | the file-type registry: name first, then content corrections | `Cargo.lock` is TOML; a PNG named `notes.txt` is an image |
| What kind of document is it? | reader-kind detection over the name, format and shape | a Markdown file with "Summary" and "Next step" headings is a report |
| How should it be read? | the row's reading, the kind, the reader's own choices | JSON reads as a data tree; a `.txt` poem reads as verse; a `.txt` that is a log reads as a log |

## The file-type registry

`FILE_TYPES` in `packages/core/src/kind/registry.ts` (with aliases from `kind/aliases.ts`) holds every
row. A row has:

| Field | Meaning |
| --- | --- |
| `id` | the type's name (`markdown`, `rust`, `csv`, `archive` …) |
| `kind` | index class: `markdown`, `text`, `source`, `theme` or `binary` |
| `readerKind` | the reader kind the name implies |
| `reading` | `page`, `prose`, `code`, `plain`, `tree`, `records`, `table`, `notebook` or `binary` |
| `mode` | the row's mode, Read (`rendered`) or Source; code rows say Source but land in Read (below) |
| `parser` | `markdown`, `code` or `text` |
| `lang`, `cm` | the Shiki grammar (also written as `data-marxy-lang`) and the CodeMirror language |
| `viewer` | `text`, `html`, `card`, `image`, `archive`, `pdf`, `sqlite`, `sheet`, `mail`, `font`, `media`, `office` or `book` |
| `searchable` | whether search reads it |
| `associated` | whether the installer claims the extension (the list must match `tauri.conf.json`) |
| `match` | extensions, whole names and globs |

`nameTypeOf` tries, in order: the whole file name (any case), the extension when its row is Markdown or
text, name globs, then any extension. An unknown name reads as plain text in Source, unless its text is plainly XML or JSON (below).

Where a file lands is the row's mode, except code (`landsInRead`, `apps/desktop/src/source/default-mode.ts`): a source
file (a code row, kind `source`, reading `code`, a text viewer) and an HTML file land in Read, with Source one key away.
A theme's `theme.css`, a commit message and a rebase list keep landing in Source, as does text no reading knows (`.rst`,
an unknown name). A `[[kind]]` rule's `read` wins. A *show as* kind lands in Read, drawn as that kind. A code file the
reader switched to Source (kept in `readings.json` as `source`) opens there again until they switch it back; a file
never switched lands in Read. Code from 1 MB lands in Source as it always did: from there Read's first screen comes two to
three times later than Source's (Read is Lines from 5 MiB).

### What the rows cover

| Group | Examples | Reads as |
| --- | --- | --- |
| Markdown | `.md .markdown .mdown .mkd .mdx`, Quarto and R Markdown, `llms.txt`, `.cursorrules` | the Markdown page |
| Plain text | `.txt`, and names like `README`, `CHANGELOG`, `NOTES`, `LICENSE`, `AUTHORS` | as written, verse, wrapped prose or Markdown, by its shape; a log, a session or a patch by its kind |
| Source code | about 250 grammars: TypeScript, JavaScript, Rust, Python, Go, Java, Kotlin, C and C++, Ruby, PHP, Swift, shell, SQL, GraphQL, Lua, R, Elixir, Haskell, Vue, Svelte, CSS, SCSS and many more | coloured code in Read; Source one key away |
| Data | JSON (and JSON with comments: `tsconfig.json`, `.vscode/*.json`, `.jsonc`), JSON5, TOML, YAML, XML; JSON Lines; CSV and TSV; `.ipynb`; `.ini`, `.cfg`, `.url`, `.inf` | data tree; records; table; notebook |
| Logs, diffs, sessions | `.log .out`; `.diff .patch`; `.term .session` | log, diff and terminal pages |
| HTML | `.html .htm .xhtml` | a sandboxed page in Read (the HTML viewer, below); its code in Source |
| Mail | `.eml`; Outlook's `.msg` | the mail viewer |
| Images | png, jpeg, gif, webp, bmp, ico, tiff, avif, heic, tga, exr, hdr, qoi, jxl, camera RAW, pbm, pgm, ppm, pnm, pam, farbfeld (`.ff`), dds, psd, svgz | the image page |
| Audio and video | mp3, wav, ogg, flac, m4a, aac, opus, wma, aiff, aif, ac3, mka, amr; mp4, mov, mkv, webm and others | the media page |
| Archives | zip and its relatives (jar, whl, vsix …), tar, tgz, gz, bz2, xz, zst, tzst, 7z, deb, cab, iso, rar | the archive page |
| Books | epub (the `book` row, kind book) | the book page; Read as offers the archive page |
| Fonts, PDF, spreadsheets, databases | ttf, otf, woff, woff2, ttc; pdf; xlsx, xlsm, xls, ods; sqlite, db | their viewers |
| Word documents and decks | docx, odt, doc; pptx, odp, ppt (the `office-document` row, kind article) | the office page |
| Rich Text | rtf (the `rtf` row: text, kind article) | the office page in Read; its own text in Source |
| Windows shortcuts | `.lnk` | the file card with what the shortcut points at, and the hex view |
| Windows programs | `.exe .dll .sys .ocx .scr` (the `program` row; `.msi` is a compound file and stays a plain binary) | the file card with what the program claims, and the hex view |
| Certificates | `.pem .crt .cer .der` (the `certificate` row: PEM is text, DER is bytes; the head says which) | the file card with who the certificate names and who issued it, when it starts and ends, its key and whether it is a CA; a PEM keeps its own text as Source, DER keeps the hex view |
| Everything else binary | other executables (so, dylib, wasm …), disk images, midi | the file card and hex view |

Files that hold credentials are never searched: `.env` and `.env.*`, `.flaskenv`, `.npmrc`, `.netrc`, `_netrc`, `.pgpass`, `.pypirc`, `.envrc`, `.git-credentials`, `*.env`, `*.pem`, `*.crt`, `*.cer`, `*.der`, `*.key`, `*.ppk`, the private halves of SSH keys (`id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa` and their variants; not their `.pub` files) and `credentials` inside a `.aws` folder. The name decides this whatever the file turns out to be, but a binary head still wins for how it opens (a Keynote `.key` is an archive, not searched). They still open when you open them yourself, and a `.pem`, `.crt`, `.cer` or `.der` opens as the certificate card (never searched, whatever a modeline says, as a `.crt` can hold a key beside the certificate). Binary rows are never parsed or searched.

### Aliases and fence words

`ROW_ALIASES` clones a row under more names (`.geojson` is JSON, `Cargo.lock` is TOML, `.zshrc` is
shell, `.csproj` is XML). Fence words map to grammars through `langOfFence`: `bash`, `sh`, `zsh` and
`shell` are shell; `golang` is Go; `c++` is C++; a known extension such as `rs` maps to its row.

## Detection from bytes

When a file opens, the shell reads its first 8 KB (`detect_files`, `src-tauri/src/detect.rs`) and
reports its class (text, binary or empty), encoding, magic-byte format, shebang, editor modeline and a
language hint. `contentTypeFor` in `kind/registry.ts` then corrects the name's row:

- A binary file gets the binary row its name or magic bytes name, else the generic binary row.
- Text under a binary name becomes plain text.
- A modeline decides first; then a language hint for ambiguous names (`.h`, `.m`, `.pl`); then a
  shebang for files with no or a plain-text extension.

PDF is recognised by its bytes even when its head looks like text.

A name no row knows (`.config`, `.manifest`, `.map`, `.plist`, an odd extension, no extension) is also read from its text, by `noteSniffed` in `kind/registry.ts` once the file's bytes are in hand: XML when the text opens with an XML declaration or is one element that closes (not an HTML page), JSON when it starts with `{` or `[`. Up to 256 KB the text is parsed whole to be sure (JSON, or XML without a declaration). Above that, only an XML declaration decides, or JSON whose first and last bytes frame a value (`{` or `[`, then a key, value, comment or close; the matching close last), up to 1.5 MB, so a `{ //` file with comments sniffs as JSON with comments; the reading's own parse then confirms it and a text that fails shows as written. Anything less certain stays plain text: an INI `.config`, a script, prose, a page of HTML. The answer is kept per path and bytes, so reopening an unchanged file does not parse it again. A known name is never sniffed, so an extension always wins, and files named for credentials are left alone. The data tree says how the kind was found ("Read as XML from its text") in its head and its fold.

JSON that carries comments or trailing commas (`tsconfig.json`, `.vscode/*.json`, `devcontainer.json`, and any `.json` that does) reads as JSON with comments, and `.jsonc` and `.json5` read as trees by name (`reading/tree-jsonc.ts`). Comments and commas are trivia between nodes, kept in the bytes: every node spans only its own value, so an edit through the tree splices only that range. JSON5's bare keys, single quotes, hex numbers and line continuations are spellings inside a node's span, so JSON5 loses no bytes either.

## Encodings

A UTF-8 file is used as it is. A file with a non-UTF-8 BOM, bytes that are not UTF-8, or a chosen
encoding is decoded by the shell (`decode_text`) into UTF-8 with a byte map back to the file, so
positions and edits still name the file's bytes. A BOM decides; valid (or nearly valid) UTF-8 is UTF-8;
otherwise a guess (`chardetng` in Rust, a CJK and Cyrillic heuristic in the memory shell). "Read with
encoding…" offers 13 encodings, each shown with its reading of a sample. A save, a fork and a `(mine)`
copy write the original encoding and BOM, and refuse a character the encoding cannot hold.

In Source, a byte that is not UTF-8 is held as its own character so an edit keeps it exactly
(`packages/core/src/buffer/source-text.ts`).

## Reader kinds

`KINDS` in `packages/core/src/contracts/kinds.ts` (default `article`). `detectKind`
(`packages/core/src/kind/detect.ts`) reads up to 64 KB of front matter and 16 KB of body and applies
tiers in order: the reader's own choice (Show as, then a `[[kind]]` rule in `config.toml`), the name,
the format, the shape, a byline, weak shape, the default. Every signal is kept as a reason, which the
Metadata panel shows.

| Kind | Given when |
| --- | --- |
| article | the default; front matter with an author and a date or source |
| report | two working headings (Summary, Context, Risk, Next step, Open question, Verified, Recommendation), or a task list |
| book | a "Chapter" heading with long paragraphs, or a chapter-numbered name |
| readme | names like README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, SUPPORT, FAQ |
| docs | alerts, `:::` or `!!!` blocks, or Parameters / Returns / Errors / Example headings |
| code | source files, unknown text, `.rst`, `.svg` |
| transcript | speaker headings for two roles (You, Assistant, Tool, System), or a JSON Lines agent session |
| data | JSON, TOML, YAML, XML, JSON Lines, CSV, notebooks, mail, ini, binary files |
| notes | NOTES, TODO, ROADMAP, a dated file name, a `notes` or `journal` folder |
| changelog | names like CHANGELOG, CHANGES, HISTORY, NEWS, RELEASES |
| log | `.log` or `.out`, or most lines opening as a log's lines do (below) |
| terminal | `.term` or `.session`, or prompt lines followed by output, the file opening at a prompt (or after a banner, when its prompts name a user and a host); this shape outranks a dated name |
| diff | `.diff` or `.patch` |
| html | `.html` and its relatives |

The kind sets the page's typography through the look (face, size, measure) and decides a few
behaviours: plain text (a `.txt`, a name-only file, a file no row names) found or chosen to be a `log`,
a `terminal` or a `diff` is that kind's page, parsed as that kind's code as a `.log` is, and opens in Read
(`readsAsPage`, `kind/registry.ts`), so a log named `.txt` reads as a log and a `$` in it is text, not
maths; prose kinds read plain text by its shape (below); a reader's choice of a prose kind for text
with no reading parses it as Markdown; `data` gets data readings, `changelog` offers Copy release
notes, `log` gets level counts and the time strip.

### Log lines

`logHead` (`packages/core/src/log/head.ts`) says whether a line opens as a log's lines do, and where
its time and its level sit. Detection, the log page, the level filter, the panel's counts and the
parse's pieces all ask it. The shapes it knows:

| Writer | A line | Time | Level |
| --- | --- | --- | --- |
| ISO time and a level word, log4j, Laravel | `2026-10-12 12:00:00,123 [main] ERROR app - boom` | first | after it |
| Windows CBS and DISM | `2024-01-15 10:23:45, Info  CBS  Starting…` | first | after a comma |
| WindowsUpdate.log (Windows 7 to 8.1, and as decoded since) | `2015-10-07⇥09:25:05:497⇥ 920⇥b3c⇥Agent⇥WARNING: …` | first | only on a warning or a failure |
| IIS (W3C default fields) | `2024-01-15 10:23:45 10.0.0.5 GET /x - 443 - … 404 0 2 15` | first | the status, inside the line |
| syslog, RFC 3164 and as a file has it | `<34>Oct 11 22:14:15 host su: …`, `Oct  1 06:25:01 host CRON[2213]: …` | after the priority | the priority, when written |
| syslog, RFC 5424, and rsyslog's precise time | `<165>1 2003-10-11T22:14:15.003Z host app - ID47 …` | after the version | the priority |
| nginx and Apache access (common, combined) | `203.0.113.7 - - [10/Oct/2024:13:55:36 +0000] "GET / HTTP/1.1" 502 157` | in brackets | the status, inside the line |
| nginx error | `2024/10/10 13:55:36 [error] 1234#1234: …` | first | in brackets |
| Apache error (2.2 and 2.4) | `[Fri Mar 01 12:00:00.123456 2024] [core:error] [pid 123] …` | in brackets | in brackets, after the module |
| Python logging, default and asctime formats | `WARNING:root:disk full`, `2024-01-15 10:23:45,123 - app - ERROR - …` | none, or first | first, or after the name |
| .NET console logger | `fail: Microsoft.AspNetCore.Server.Kestrel[13]` | none, or in brackets first | `trce` to `crit` |
| Serilog, console and file | `[10:23:45 WRN] …`, `2024-01-15 10:23:45.123 +01:00 [FTL] …` | first | after it |

A level ranks by its word (Serilog's three letters and .NET's four included), a syslog priority by its
severity, an HTTP status by its class (5xx an error, 4xx a warning). A line with a time and no level
ranks as info; a line that is no head (a stack frame, a message under .NET's level line) takes its
head's rank. Detection needs three heads that are 60% of the lines that do not open with a space.

### ANSI colour in a log

A log that asks for colour with ANSI escape codes (SGR) has it drawn in the theme's own tones, never the colour written
(`packages/core/src/log/ansi.ts`, one module for both readings): yellow as the warning tone, red as the error tone,
green as the string tone, blue, cyan and magenta as three more of the theme's tones, bold as weight, dim as the muted
tone. A 256-colour or truecolour code takes the nearest of those tones; black, white, greys and backgrounds are the
page's own ink. The codes are hidden but stay in the text, so a copy, a selection and x-ray read the bytes, and every
drawn span keeps its byte range. Cursor moves, clears and OSC titles are hidden and named, not run. A code that is cut
short or garbled is not swallowed: the log page marks it ESC, and Lines leaves its text as written. A style ends at the
line's end. The page's fold (How this is shown) says what is drawn and what is hidden; the log page and Lines both do it.

## Readings in Read

`readingOf` (`packages/core/src/reading/index.ts`) returns a reading for files that are not a Markdown
or code page:

| Reading | For | Shows |
| --- | --- | --- |
| Markdown page | Markdown, prose kinds | the typeset page |
| Code | source files | pieces of 200 lines, coloured as they come into view |
| Log | logs | time, level and spacing classes, an error rule on error lines, level counts |
| Terminal | sessions | command, continuation and output lines; copy commands or output |
| Diff | patches | added and removed lines inside hunks, changed words marked |
| Data tree | JSON, JSON with comments, JSON5, YAML, TOML, XML | a foldable tree two levels open; a list of three or more same-keyed maps as a table; a Keys card |
| Records | JSON Lines | a table of every record, keys as columns, as the Table reading draws its rows |
| Table | CSV, TSV | header and every row, a field with a line break in it one row; sorting, the row filter and find go through every row and change the view, never the file; a Columns card |
| Verse | plain text of short lines in stanzas | stanzas, a number every fifth line |
| Prose | plain text of wrapped paragraphs | paragraphs, a wrap undone |
| Written | anything else, and a data file or notebook that does not parse (under 256 KB; from there it is shown as Lines, with why it is not a tree in its head) | every line numbered, as written |
| Lines | a log, plain text, code or Markdown from 5 MiB | every line numbered, as written, only the lines on screen drawn; a log's time in the comment colour, a warning or error level in bold, ANSI colour drawn in the theme's tones; find, the level filter and the Outline read every line; Markdown's headings listed from a scan, and Show rendered (`g r`) draws its page |
| Notebook | `.ipynb` | Markdown cells rendered, code cells as fences, text, HTML and image outputs; scripts named, never run |
| Conversation | JSON Lines agent sessions | turns of text, thinking and tool calls with results; a result that names no id answers the turn's first call that named none, whether it is a block in a prompt, a `tool_result` line of its own or a `role: tool` line |

Plain text keeps its lines. It is read as Markdown only when it carries Markdown marks
(`carriesMarkdown`, looked for in the first 1,000 characters of each line): a `# ` heading, or two lines
holding a fence, a table's rule, a link definition, a task, a link, code in backticks or emphasis opened
and closed. Lists, numbered lines, quoted lines and an underlined title are not counted, since plain
text writes them too; a lone `*` and a `#hashtag` are no marks. Otherwise it is verse (short lines in
stanzas), prose when every break inside a paragraph is a wrap (the next line's first word would not have
fitted on the line before, at the width of the file's longest line), or as written. A line ends at CRLF,
a CR alone or an LF, as the parse reads it. Verse and the written reading draw each line from its own
bytes, its line ending outside the range; bytes that are not UTF-8 (UTF-16 or UTF-32 by their byte-order
mark, or a legacy encoding) are decoded as the memory shell decodes a file, the ranges still the file's.

From 5 MiB a log, plain text or code in UTF-8 is read as **Lines** whatever its shape (`linesTier`,
`packages/core/src/reading/lines.ts`). The file is indexed once by where each line begins and ends in its
bytes, and a line is decoded from its bytes only when it is drawn: Read keeps the lines on screen and a
screen either side on the page, between two gaps that stand for the rest, and draws others as the page
scrolls (`apps/desktop/src/view/reading-lines.ts`). A long line wraps under itself; its height is worked
out from its length and the column's width, and corrected once it is drawn, so the end of the scroll is
the last line. A resize restyles only the rows on the page. Find and the level filter go through every
line a slice at a time and change only the view; the Outline and the Metadata panel read a log's levels and
times from the line index in slices too. A live reload keeps the level, and a log that grew is indexed
from its last line on: only its new bytes are read, and a reader at the end stays on the last line. Text that is not UTF-8, data, a patch and a session keep their own pages
at any size. From 32 MB an edit made outside Source's editor (the parts cursor, a transform, the Outline,
a replace from Search) is refused and said; Source's editor still edits, with its own find and replace.
The refusal is the store's, decided once when the file opens, so it holds in either mode: the Transform
sheet is refused from Source too. A log at that size shown another way (Source, Read as…) has its panels
read from a line index in slices as well.

Markdown in UTF-8 from 5 MiB opens as Lines too, not as its page: the page is the parse of the whole file, which
took 35 seconds before a 50 MB file showed its title. Its Outline lists headings found by a scan of the line
index (`scanHeadings`, `packages/core/src/reading/heading-scan.ts`), started after the first lines paint and
run a slice at a time: ATX headings and setext underlines at the top level, with fenced code (backticks or
tildes), indented code, front matter (whose `title` names the file when no heading is level one) and HTML
blocks passed over, each heading's inline marks taken off simply and its bytes kept, so a row goes to its
line. It is a scan, not the parse: a heading inside a list item or a block quote is not listed, and it keeps
the first 20,000. Past 1,000 the panel draws the deepest levels that fit in 1,000 rows (or the first 1,000 when
those are fewer than 20, when the list says where it stops and the dot stays on its last row past it), and its
field filters every heading. Only the first 4 KB of a line is ever decoded for a heading or an HTML block's
start, and an HTML block's end is looked for in the bytes, so a line of megabytes costs no more. A paragraph made
only of link reference definitions is no setext heading. A click on its page, the cursor's keys, find and a row of the Outline never ask for the parse. **Show rendered** (`g r`, the Metadata panel's Reading line, or Read as › Rendered) draws
the page: a notice says the file's size and that the whole file is parsed first, the parse runs in slices as
any large open's does, and the normal Outline takes over. `g r` again comes back to lines. The choice is kept
for the path until the app closes, even when the file is closed and opened again, and never written
(`renderedChosen`); every pane showing it follows. It is refused while any pane holds unsaved changes to the
file, as the page is set again from the file. The scan stops when the last page showing the lines closes. The page's fold says
why it is lines and that Show rendered is there.

A table's or records' rows are indexed from the file's bytes as it opens, a slice at a time (`reading/rows.ts`): where
each row starts, a few bytes a row, with no field kept. Up to 2,000 rows the page holds them all. Past that it holds the
rows on screen and a screen either side, read again from their bytes when drawn, with the rest standing as their
height above and below (a table taller than 16 million pixels scrolls through a scale); every drawn row and header
carries its byte range. Sorting by a column, the row filter (the Line's `=`, the Outline's rows field) and find read
every row in slices with the loop given back between them, and a line at the end of the page's first line says how far
a long pass has got; a sort or a filter asked for while the rows are still being read waits for them. Find counts
matches in every row and steps to each, drawing its row; the Line's `/` lists matches by line over the whole file. Of a
JSON Lines file, the keys of every line become columns once all are read; until then the first line says "so far". The first 10,000 distinct keys become columns; a file that names more (a new key in every record) says "more than 10,000 keys" in its first line and under the table.

Inside a Markdown page, each fenced block gets a guess of its own (`partsOf`, `reading/parts.ts`): data,
table, session, patch, log, diagram or written; the reader can change it, and the choice is kept in
`readings.json`.

`R` (read as) lists the readings that apply, with Bytes always last.

## Viewers

Files whose row names a viewer open on an app page instead of a text page (`apps/desktop/src/viewers/`):

| Viewer | Kinds | Shows |
| --- | --- | --- |
| File card and hex | any binary without a richer viewer, and any file read as bytes | what the bytes are, then a hex and text view that reaches the last byte of files of any size |
| Shortcut card | `.lnk`, found by its header (size 0x4C and the Shell Link class id) too | the file card with the target (from the link info, else the folders its item list names), arguments, start folder, description, icon, show command, hotkey, the target's size and times, and a target with environment variables; read by `packages/core` from the first 1 MB, strings cut at 32 KB, a malformed file gives a damaged reason; the target is shown as text and never followed or started |
| Program card | `.exe .dll .sys .ocx .scr`, and a file with no extension whose head is MZ | the file card with what the file claims, each marked as its own claim: product, version, company and description from its version resource; what it was built for (x86, x64, ARM64, ARM; a window program, a console program, a library or a driver; any CPU for a .NET assembly marked so); the build time when the stamp is non-zero, not a reproducible-build hash (a debug entry says so), not later than now, and not in a damaged file whose debug entry cannot be read; and "Signature present, not verified" or "No signature" from the certificate-table entry. Read by `packages/core` by range through `readRange`, never whole. Nothing is run, loaded or verified (no signature check, no revocation, no network), and Open in default app stays off, for an extensionless file with an MZ head too (the shell refuses to open any file that begins MZ). The strings are the string table of the language the file lists first, else the fixed version block: the file's own, which can differ from what Windows' file properties show from a .mui file beside it; a claim is shown cut at 200 characters. A file cut inside its optional header or section table keeps the machine, subsystem and stamp already read. A cyclic, too deep or oversized resource tree, or a file cut short, is a `damaged` row and the header facts stand; a header that cannot be read gives a damaged reason; bytes that do not begin MZ (a text file renamed `.exe`) are no program |
| Certificate card | `.pem .crt .cer .der` | the file card with, for one certificate: subject (common name, organisation, country), issuer (and that it names itself), starts, ends ("ended on" a past date, "ends on" a future one), key (RSA bits, EC curve, Ed25519) and CA (from basicConstraints); a PEM bundle lists each certificate as a row, the first 100, the rest counted. A file that holds a private key (any BEGIN label with PRIVATE KEY, whether or not it ends; PKCS#8, encrypted PKCS#8, PKCS#1 and SEC1 in DER) is only said to hold one: Read, its why list, the Reading and Facts cards and Metadata draw no byte of it (no hex beside the card, no first bytes, no head in the panel) and a key block is never base64-decoded. Source stays available as the file itself (the text of a PEM, the hex view of DER) on an explicit switch, but it is never the mode the file opens in. Read by `packages/core` with a hand-written DER walk from the first 1 MB (spaces and line ends after a DER file are ignored; a date the month does not have is damage); an indefinite length, nesting past 16, a length past the end, bad base64 or a block that never ends is a damaged reason. Names and strings are decoded from PrintableString, UTF8String, IA5String, BMPString and TeletexString, cleaned of bidi and invisible characters and cut at 200 characters; dates are UTCTime (two-digit years 50 to 99 are 19xx, 00 to 49 are 20xx) or GeneralizedTime, shown in UTC. Everything is the certificate's own claim: no signature, chain or revocation is checked and nothing asks a CA. Bytes that are neither PEM nor DER (notes saved as `.pem`) are no certificate |
| Image | raster images, SVG, camera RAW | the picture, its facts (size, colour, EXIF, location); formats the webview cannot draw are decoded to PNG by the shell. HEIC is drawn by macOS's web view, and on Windows by the system's own decoder (the HEIF Image Extension with the HEVC Video Extension, from the Microsoft Store; Marxy carries none), probed by decoding a 524-byte sample, the answer kept once the system gives a definite one; where it is absent the file card says so and names both extensions, with the hex beside. An image of a format this system draws that still does not draw (a HEIC the decoder refuses, a PNG cut short) gets the card too, which says the file may be damaged or cut short rather than blaming the system. A HEIC's and an AVIF's size is its primary item's `ispe`, cropped by `clap`, so their rows in a folder of images give it; the decode budget is judged on the coded size, before the crop, and on a grid's tiles. The PNM family, farbfeld and DDS (BC1 to BC3 only; BC4 to BC7, uncompressed DDS, a header the decoder does not read and a DDS cut short fall to the card, which says why) are decoded by the shell. A Photoshop file shows its own preview: its flattened image when the file says that image is real, else the JPEG thumbnail Photoshop stores, enlarged to the file's size when that is within the decode budget and of the same shape, else shown at its own size and given as that size, never stretched (the Image card says it is the thumbnail); one saved without either says so on the card, with the hex beside, and Marxy never draws layers. An SVGZ is unpacked to 16 MB at most (padding after its gzip stream ignored), must hold an SVG, and is drawn as an SVG is, through `<img>`, so nothing in it runs; one that unpacks further (a gzip bomb) is refused with that reason. The browser build reads these formats' facts but draws none of them |
| Media | audio and video | a player, container facts (WAV, AIFF with its NAME, AUTH and ID3 tags, MP4, QuickTime, Matroska, WebM, MP3, Ogg, FLAC), a waveform for PCM WAV; where the webview's `canPlayType` says no, a card that says "this system cannot play Opus in an .m4a" and no player; WMA, AC3 and AMR carry no facts and fall to that card or the player as the webview answers |
| Archive | zip (stored, deflate, Deflate64, bzip2, LZMA, Zstandard and xz entries), tar, compressed tar (gzip, bzip2, xz, Zstandard), a lone compressed file, 7z, a Debian package (its `ar` members, and the files of its control and data tars under `control/` and `data/`; a tar packed some other way is named in a sentence and not listed), a Windows cabinet (stored and MSZIP entries read; LZX and Quantum entries listed, with a sentence), an ISO 9660 image (Joliet names when it has them) and RAR 4 and 5 (listed only: names, sizes, dates and which entries are encrypted; the page says its contents cannot be read here) (the browser build reads zip, with stored and deflate entries only, tar and gzip) | what the archive is, a plan of it to scale, the entries, and a preview of the entry under the cursor read as its own kind; an entry opens as a tab of its own, in memory |
| PDF | pdf | pages drawn by pdf.js, with Find |
| Database | SQLite | tables and views, read-only, paged; BLOB heads |
| Spreadsheet | xlsx, xlsm, xls, ods | sheets with cached values and number formats; formulas as text |
| Font | ttf, otf, woff, woff2, collections | faces, coverage, axes, glyphs |
| Mail | eml, msg | headers, parts, the text body; the HTML part sandboxed, remote images held back; an Outlook message as the message it would be as it travels (below) |
| Office | docx, pptx, odt, odp, rtf, doc, ppt | the document as text, set as the Markdown page is (see below) |
| Book | epub | the chapters as one page in the spine's order, set as the Markdown page is, the contents as the Outline (see below) |
| HTML page | `.html .htm .xhtml` | the document in the sandbox a message's HTML part uses (`viewers/sandbox.ts`), cleaned by the one sanitiser: scripts, handlers and frames left out, a form shown and never sent, links shown and not followed; remote images held back with mail's offer to load them for this file, until its tab closes; How this is shown names what was left out. With an HTML grant in `trust.json`, Read draws the file's HTML in the page itself, sanitised, which is what the grant allows; a *show as* kind is drawn as that kind |

### The office page

A Word document or a deck is read as text, not laid out as pages. `apps/desktop/src/viewers/office.ts` reads the file's
parts through the shell's zip reader (`listArchive`, `readArchiveEntry`: the Rust archive module in the app, the memory
shell's reader in the browser build, with their caps), and core's `office/` turns the XML into a small model of blocks
and runs (`word.ts` for .docx, `slides.ts` for .pptx, `odf.ts` for .odt and .odp) and writes it as Markdown
(`markdown.ts`). The page is that Markdown rendered by the one renderer and sanitiser, so it wears the reading look and
the Markdown page's headings, lists, tables and footnotes.

- **Word and OpenDocument text:** headings from heading styles, a Title and outline levels; paragraphs; numbered and
  bulleted lists from the numbering part, nested, a list resuming its numbers after an interruption; tables (merged
  cells padded, a cell's paragraphs as lines); links (relationship links and `HYPERLINK` fields); bold, italic, struck,
  subscript, superscript, and runs in a fixed-width face or a code style as code; paragraphs in a code style as one code
  block, in a quote style as a quote; footnotes and endnotes numbered together at the end; comments set under the
  paragraph they are on with their author and date; text boxes after their paragraph; tracked insertions as written and
  deletions as gone. Fonts, colours, sizes, page setup, sections, headers and footers are not read.
- **Decks:** every slide in order as a section headed by its title, its number hung in the margin (a hidden slide's
  struck through); its shapes' text in the shape tree's order (the order a screen reader follows), a body placeholder's
  paragraphs as bullets nested by level, tables, then its speaker notes set apart. Footers, dates and slide numbers on
  the slide, positions, masters, themes and animations are not read.
- **Pictures** held in the file are drawn from its bytes (PNG, JPEG, GIF, WebP, BMP, up to 8 MB each), each read once
  however often it is shown and one after another, at most 300 of them and 64 MB in all; any other picture, a chart, a
  diagram, an embedded object, a linked picture or one past those limits is a line naming it with its alt text.
- **Safety:** the XML reader (`office/xml.ts`) refuses a document type, decodes only the five predefined entities and
  character references, and stops at the element, text and depth caps; each part's bytes and every attribute are
  charged against one budget of 128 MB for the document, and a part is parsed once however often the file names it (a
  slide listed twice shows once). The document's text is escaped before it is written as Markdown, and notes are
  labelled by their order, never by the file's ids, so nothing the file says can become markup. A relationship marked
  external is kept as an address and never read. A link opens only when followed: the web in the browser, a relative
  link by the Markdown page's rule (`selection/link-target.ts`), which refuses another machine (`//host`, `\\host`,
  however encoded), a drive, a scheme, a NUL and anything outside the document's folder or repository.
- The panel's Document (or Deck) card lists the title, author, who last saved it, the dates, the word or slide count,
  notes and comments. The cursor walks sections (a heading or a slide and what follows it) and their blocks; find
  searches the page. Export offers the file as it is and the page as Markdown. Source is the hex view.

### Word 97-2003 documents and decks on the office page

A `.doc` or `.ppt` is a compound file, as an Outlook message is. The page reads the file whole (64 MB at most) and hands
its bytes to the shell's `office_from_ole` (`src-tauri/src/legacy_office/`), which reads the directory and sector chains
through the one compound-file reader `.msg` uses (`outlook/layout.rs`: the chains and directory read once, each stream's
chain walk charged before it is opened), reads the streams by hand and answers with the office page's own blocks;
core's `office/legacy.ts` checks their shape and `markdown.ts` writes them as the one Markdown page. Which of the two it
is comes from the streams it holds, whatever the name says. Source is the hex view, as for a .docx.

- **Word 97-2003:** the WordDocument stream's FIB names the table stream (0Table or 1Table) and the piece table in it;
  each piece of the main text is read as Windows-1252 bytes or UTF-16, as the piece says. Paragraph marks end paragraphs;
  headings come from the Heading 1 to 9 and Title styles and from a paragraph's outline level; tables from cell and row
  marks (a row's end from the paragraph properties, or a cell mark straight after a cell's end where there are none), a
  cell's paragraphs as lines; list paragraphs as bullets (the numbers Word draws are not read); bold, italic and struck
  runs; hidden text left out; line breaks. A field shows its result, never its code, and is never evaluated; a
  `HYPERLINK` field is a link. Footnotes, endnotes, comments, headers and footers and text boxes are named as left out.
  Word 6 and 95 files say they are not read.
- **PowerPoint 97-2003:** the Current User stream points at the last edit, and the edits' persist directories, newest
  first, say where the document and each slide lie in the PowerPoint Document stream; a deck whose chain does not read
  is scanned record by record at its top level instead. Each slide in the slide list's order is a section headed by its
  title, its number in the margin (a hidden slide's struck through), its body placeholder's paragraphs as bullets, then
  its own text boxes and pictures from its drawing, then its speaker notes set apart.
- **Pictures, objects and macros:** a picture (a character Word marks as special) is a line naming it, never drawn; an embedded object is named, never run;
  a document's `Macros` or `VBA` storage and a deck's VBA record are named as left out, and nothing in them is read.
- **Locked and damaged files:** a document or deck encrypted with a password (the FIB's flag, the deck's Current User
  token or its encryption session, or a compound file holding an encrypted .docx or .pptx) falls to the file card, which
  says it is encrypted and that Marxy does not unlock files. A file whose streams do not read falls to the card as
  damaged; one past a cap says which.
- **Caps:** the file and each stream up to 64 MB; 16 MB of text and 500,000 paragraphs, list items, cells and line
  breaks (an empty paragraph counts), past either of which the page says the rest is not read; 10,000
  slides and 10,000 pictures and objects named; a slide's drawing read 64 containers deep; and 50 million steps over
  records, pieces and characters in all, and the compound file's own chain budget, so pieces that name the same text
  again, records that point at one another and slides that share one container stop with a sentence, not a hang. A
  deck's text is charged before it is decoded, a container's records are walked without being gathered, and a property
  page the document names twice is read once. The
  browser build answers only for the demo's own two files.

### RTF on the office page

An `.rtf` is text, so it opens as a message does: Source is the file's own lines in the editor, and Read is the office
page drawn from the same bytes (`viewers/office.ts`, handed the store's text). Core's `office/rtf.ts` reads it by hand in
one pass, a stack of groups and the properties each sets, into the office model, and `markdown.ts` writes it as the one
Markdown page. The page's first line ends "the text, not the layout".

- **What reads:** paragraphs; headings from an outline level, a style named `heading N` or `Title`, or else type set at
  least 15% larger than the body's commonest size (largest first, as WordPad files have no styles); bold, italic, struck,
  sub- and superscript, and runs in a fixed-width font as code; bulleted and numbered lists from their list text
  (`\listtext`, WordPad's `\pntext` and `\pn`), nested by `\ilvl`; tables from `\cell` and `\row`, a cell's paragraphs
  as lines; `\line` breaks; the symbols RTF names (dashes, quotes, the no-break space and hyphen).
- **Characters:** a byte above 7F, written by number (`\'hh`) or raw, is read in the code page the file declares,
  `\ansicpg`, or the character set its font declares (`\fcharset`, `\cpg`), through the encoding module's code page
  table (DOS 437 and 850 included, for `\pc` and `\pca`); with neither, `\ansi` is Windows-1252, `\mac` Mac Roman.
  Two-byte code pages (Shift_JIS, GBK, Big5, EUC-KR) take their pair together however each byte is written. Raw bytes are
  read as UTF-8 only under code page 65001, or when the file names no code page and the run is well-formed UTF-8. A file
  whose store holds it decoded (a legacy encoding) is read from its own bytes, and the page's ranges are made the store's;
  once Source has changed the store, its text is read instead, its well-formed UTF-8 as it is and the bytes between in
  the code page, as is a file saved as UTF-8 whatever it declares. A file under the name whose head is not `{\rtf` is
  said to be so without being read whole.
  A code page with no decoder (Johab) shows its characters as U+FFFD and the account says so; nothing is guessed from the
  bytes. `\u` is decoded and its `\ucN` fallback skipped, by characters or a group's end; control characters it names
  are dropped, as raw ones are.
- **Named, never run:** a picture (`\pict`) is a line naming its format and size, its hex counted and never decoded; an
  embedded object (`\object`) is a line naming its class, its data and result skipped. A field shows the result it last
  showed; a `HYPERLINK`'s address is written after its words as text, so the page has no link to follow; a link to a
  place in the document adds nothing. Nothing a field names (`INCLUDEPICTURE`, `INCLUDETEXT`) is fetched.
- **Left out, and said:** headers, footers, footnotes, comments, shapes and floating pictures, hidden and deleted text,
  fonts, colours, sizes and page setup.
- **Bytes:** every block and table row records the bytes of the file it was read from; the writer keeps each block's
  Markdown bytes beside them, and the page rewrites every element's `data-marxy-s` / `data-marxy-e` to the file's bytes
  (a run inside a paragraph takes the paragraph's). The cursor's parts carry that byte, so `\` lands Source on the
  block's own line; `c` copies a part as the page's Markdown.
- **Caps:** groups nested more than 256 deep are skipped whole, and text past 16 MB is not read; either is said in a line
  above the text. `\binN` bytes are stepped over as data. At most 10,000 pictures and objects are named, and the line says how many more were left out.
- An `.rtf` whose head content detection calls binary (raw bytes after `\bin`) is still read here, from the file's bytes,
  with Source as the hex view (the registry's RTF bytes row).
- Outlook's compressed RTF in a `.msg` is a separate path (mail, below) and is not read here.

### The book page

An EPUB is a zip of XHTML chapters, read as one page. `apps/desktop/src/viewers/book.ts` reads its parts through the
shell's zip reader, as the office page does, and core's `book/` reads the package (`package.ts`): META-INF/container.xml
names the OPF, whose manifest and spine say what the chapters are and in what order; each chapter's XHTML is read by the
office XML reader into the office page's model (`xhtml.ts`) and the whole book is written as one Markdown page by the
office writer (`index.ts`). The page is that Markdown drawn by the one renderer and sanitiser, so every block carries its
range in the page's Markdown, as the office page's do; the book is only read, so nothing offers to change it.

- **Read:** headings, paragraphs, lists, tables, quotes, preformatted text, rules, links and emphasis; a chapter's
  wrappers (a `section`, a `div` per scene) are gone into. Styles, classes, fonts, scripts, forms, media and the
  chapter's head are not read. A chapter that is not well-formed is read again as a browser would (HTML's void
  elements unclosed, bare or unquoted attributes, names in any case, a close that skips open elements, a stray close or
  `<`, HTML's implied end tags for paragraphs, list items, terms and table rows and cells, and everything at the top
  level kept), into the same model under the same budget, and the page's account says how many were; a script, comment
  or tag never closed ends the chapter there, and the account says it is truncated. One that fails even so (a document
  type that declares anything) says why in its place, and the rest reads. A part the spine lists twice is shown once.
- **Contents:** the Outline lists the book's own contents, the `toc` nav of its EPUB 3 nav document, else its EPUB 2
  `toc.ncx`, else each chapter's first heading; an entry that names a place inside a chapter lands on it. Each row has
  its words and a size bar; its verbs are the ones that read: `o` go, `z` fold its part of the page, `c` copy it as the
  page's Markdown, and the levels 1, 2, 3, all fold the page to a depth. The crumbs name the entries the reading line is
  under. The place is kept in positions.json as a text document's is: a byte of the page's Markdown, with a stamp of
  that page (its length and an FNV-1a hash), so a book that has changed opens at its start. Only positions.json is read
  for it, after the page has painted; a place noted before the file is read is written once it is.
- **Pictures** held in the book (PNG, JPEG, GIF, WebP, BMP, SVG drawn through `<img>`) are drawn from its bytes under the
  office page's caps; a picture named on the web or by a data address is held back, named, and never fetched.
- **Links:** one inside the book goes to its place on the page; one to the web opens in the browser when followed;
  anything else leads nowhere.
- **A lock** is said on the file card instead of drawing the encrypted chapters: an Adobe (`META-INF/rights.xml`), Apple
  (`META-INF/sinf.xml`) or Readium LCP (`META-INF/license.lcpl`) rights file, a `META-INF/encryption.xml` that names
  anything but a font hidden by the IDPF's or Adobe's font obfuscation, or chapters encrypted in the zip itself.
- **A book that cannot be read as one** (no container, no OPF, no spine, a spine that names nothing in the manifest, more
  than 20,000 entries, chapters past 128 MB) opens on the archive page, whose first sentence says why. Read as offers
  the archive page for any book (kept while the app runs), and Bytes.
- **Safety:** the book's parts are read by the office XML reader under one budget, which refuses a document type that
  declares anything; a document type that only names its DTD (XHTML's, the NCX's) is skipped and never fetched, and
  XHTML's named entities are decoded from a fixed table. The contents are cut at 5,000 entries and 8 levels.

### The Outlook message

An Outlook message (`.msg`, the `outlook-message` row) is a compound file of MAPI properties, readable only by the
shell's `cfb` reader. `apps/desktop/src/viewers/outlook.ts` reads the file's bytes (or an entry's or attachment's, held
in memory) and hands them to the shell's `mail_from_msg` (`src-tauri/src/outlook/`), which writes the message it would be
as it travels: RFC 5322 headers and MIME parts. The mail page reads that with core's one MIME parser and draws it as it
draws an `.eml`, the HTML part through the same sanitiser, remote images held back by the same rule.

- **Headers:** the transport headers Outlook kept (`PR_TRANSPORT_MESSAGE_HEADERS`) when it kept them, without the ones
  that describe a body; whatever they lack from the properties: the date sent, From (the representing sender's name, an
  SMTP address before an Exchange directory name), Sender when another sent it, To, Cc and Bcc from the recipient
  storages (or the display lists when there are none), Subject, Message-ID, In-Reply-To, References and Importance. The
  page also says when it arrived (`PR_MESSAGE_DELIVERY_TIME`) and lists Bcc.
- **Body:** the HTML Outlook kept (`PR_HTML`, in its internet code page), else HTML wrapped in its compressed RTF
  (`PR_RTF_COMPRESSED`: LZFu, its CRC checked, unpacked within its declared size, then de-encapsulated from `\fromhtml1`),
  beside the plain text (`PR_BODY`); an RTF that wraps no HTML is not rendered, and the plain text stands in for it.
- **Text:** strings held as UTF-16 or in the message's code page (`PR_MESSAGE_CODEPAGE`, else `PR_INTERNET_CPID`),
  decoded by `encoding_rs`.
- **Attachments:** listed and opened as an `.eml`'s are; a picture the HTML draws by Content-ID is drawn there instead. A
  message attached to it is a `message/rfc822` part that opens as a mail of its own, eight levels deep at most. An OLE
  object or a linked file is named in a note, not read.
- **Safety:** no value can start a header or a part (control characters become spaces; each boundary is derived from
  what it encloses and checked against it); a file that is not a compound file, or not a message, says so; a damaged one says it is damaged and
  never stops the app. What a cap leaves out is said in a note on the page and the Reading card.
- The browser build reads only the demo's message, from what the desktop's reader made of it (`native-facts.ts`).
  Source is the file's bytes in the hex view; Export offers the file as it is and the message as an `.eml`.

## Size limits

| What | Limit |
| --- | --- |
| Open a file | 256 MB (larger files open as a card with the hex view) |
| Lines | a log, plain text, code or Markdown from 5 MiB is read as lines (Markdown is rendered on request); from 32 MB Read does not edit it (Source does); the heading scan keeps 20,000 headings |
| Outline | 20,000 headings of a rendered Markdown file, the first in document order; the panel says it lists the first 20,000 (the address and the Line read every heading) |
| Colour a whole file | 2 MB with no line over 10,000 characters; past that, plain text unless the reader chooses "colour anyway" |
| Colour a block | 200,000 characters; lines up to 1,000 characters (400 for C and C++, 500 for Go and shell) |
| Data tree | 1.5 MB (JSON is streamed past it), 5,000 values, depth 256; TOML looks up 250,000 table names (header keys and dotted keys), then is set as written |
| Table and records | every row, to the open limit: up to 2,000 drawn whole, past that the rows near the screen, read again from the bytes as the table scrolls; JSON Lines read for 10,000 distinct keys; 100 columns drawn and each cell cut at 4,096 characters with an ellipsis, its bytes whole for Source, sort, filter and find (Table view has every column of a CSV or TSV) |
| Notebook | 64 MB, 1,000 cells |
| HTML page, a message's HTML part | elements nested 256 deep: a deeper element loses its tags and keeps its contents, and the line above the page says `nesting past 256 levels flattened` (the frame's layout grew about three times for each doubling of a page nested thousands deep) |
| Mail | 64 MB, 500 parts (a multipart body is searched for no more delimiters than the parts still to read) |
| Outlook message | 64 MB; each part 16 MB, 128 MB read in all and at least 4 KB for each of at most 20,000 streams opened; 50,000 directory entries, streams declaring at most 64 times the file, and 200 million sector-chain steps (a stream is charged the chain cfb walks to open it, once per megabyte read); 4,096 properties, 1,000 recipients and 256 attachments an object; messages attached 8 deep; RTF unpacked to 16 MB; the message written to 60 MB, its headers and names counted (a filename cut at 1 KB, a header value at 64 KB) |
| Archive entry | 16 MB; a compressed tar is walked through the first 1 GB of its unpacked stream (256 MB in the browser build, and for an archive held inside another), and a lone `.gz` is unpacked no further than one byte past an entry's 16 MB |
| Certificate card | 1 MB read; 100 certificates listed; DER nested 16 deep; strings cut at 200 characters |
| Program card | 16 MB read in all, 96 sections, a resource tree 3 levels deep with 4,096 entries a directory, a version block of 64 KB and 512 entries, strings cut at 32 KB |
| Word document or deck | each part 16 MB (the archive entry cap); in all 2,000,000 XML elements, 16 MB of text and 128 MB of XML and attributes; pictures 8 MB each, 300 and 64 MB in all |
| Pictures | the decode budget (2^26 pixels); an SVGZ unpacked to 16 MB; a PSD's resources walked to 4,096; an ICC profile read to 4 MB (past it the colour row says `over 4 MB, not read`) |
| RTF | the open limit; groups 256 deep (deeper ones skipped whole), 16 MB of text, 10,000 pictures and objects named; pictures never decoded |
| Book (EPUB) | 20,000 zip entries; 10,000 spine items; chapters 16 MB each and 128 MB in all as the zip lists them; then the Word document's XML budget; contents 5,000 entries, 8 levels; pictures as a Word document's |
| Content search | 256 MB per file, 1 GB read, 15 s, 100,000 files |
| Index | 50,000 entries per folder |
| Diff | 50,000 lines |

## Adding a file type

1. Add a row to `BASE_ROWS` in `packages/core/src/kind/registry.ts`, or an alias in
   `packages/core/src/kind/aliases.ts` when it reads like an existing type. A new grammar must be
   on `scripts/allowlists/shiki-languages.json` (then run
   `node scripts/generate-highlight-languages.mjs`, which writes the language table and the grammar loaders as
   two files) and have a permissive licence.
2. A row marked `associated` must also be in the file associations of
   `apps/desktop/src-tauri/tauri.conf.json`. Any row with an extension and a page (not the file card) is
   offered in Windows' "Open with", so its extensions go in the list in `src-tauri/installer-hooks.nsh`;
   tests hold the lists equal.
3. If it needs detection from bytes, extend `src-tauri/src/detect.rs` and add a sample with its
   expectation to `fixtures/detect/`.
4. Run `pnpm --filter @marxy/core test` and `pnpm gate:golden`.
