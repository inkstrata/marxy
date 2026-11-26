# Work budgets in packages/core: inventory (round 14, budgets-1)

Worktree `C:\Dev\reader\worktrees\budgets-1`, branch `agent/budgets-1`, base `64589ba8`. Paths are under
`packages/core/src/`. Line numbers are as at base. "Kind": const (a constant checked once), ad hoc (a local counter or
loop guard), obj (a budget object), pace (a time slice that yields; caps nothing), **shared** (moved onto `util/budget.ts`
this round). "Hit": silent, error (throws or refuses), or note (what the reader sees). "Test": a test pins it at or past
the limit with hostile input, or none.

## Moved this round (onto `util/budget.ts`)

| Reader | Limits | Before | Now | Test |
| --- | --- | --- | --- | --- |
| mail/mime.ts parts | items: 500 parts | ad hoc `Walk.count`; every delimiter of a multipart body was found first (9M parts: half a second CPU, 9M records) | shared `parts` budget; `delimiters` looks for no more than the parts left + 1; note `Only the first 500 parts are read.` | mime.test.ts "a message of millions of parts..." (cpuNow < 100 ms; old code 563 ms) |
| office/rtf.ts | chars 16 MB, depth 256, objects 10,000 | ad hoc `chars`/`stopped`, `deepSkipped`, `objectsSkipped` | three shared budgets (depth taken on `{`, given back on `}`); same `cut` lines | hostile.test.ts depth, chars; new objects test (10,007 pictures: 10,000 named, "7 more are left out", no group mistaken for deep) |
| reading/rows.ts JSON Lines keys | items: 10,000 distinct keys (new: `READING_MAX_KEYS`) | none: every distinct key a column and a Map entry (a new key per record grows without end) | shared `keys` budget; head `more than 10,000 keys`, foot `The first 100 columns of more than 10,000; Source has them all.`, Keys detail `the first 100 of more than 10,000` | tree-budget.test.ts "JSON Lines naming a new key in every record..." (50,000 keys: 10,000 kept, 40,000 refused) |

## Budgets still on their own (next slices)

### sanitize/, parse/, render/
| file:line | limits | value | hit | kind | test |
|---|---|---|---|---|---|
| sanitize/escape.ts:50 `MAX_DECODING_PASSES` | steps | 32 | silent; urls.ts:42 refuses the URL (`character references nested more than 32 deep`) | ad hoc | sanitize.test.ts:429 |
| sanitize/sanitize-html.ts:181 unclosed removed element | rest of input | n/a | `Removal{what:'truncation'}` | n/a | sanitize tests |
| sanitize-html.ts:391 removal reason echo | chars | 80 | cut with ellipsis | const | none |
| parse/bounded-attention.ts:14 `MAX_DELIMITER_RUNS` (and bounded-gfm.ts:70) | items | 4000 | silent: runs become text | ad hoc | long-paragraph.test.ts:64-71 |
| parse/from-mdast.ts:84 `MAX_NESTING_DEPTH` | depth | 64 | note via pipeline.ts:82 `nested more than 64 levels deep; shown as plain source` | ad hoc stack | pipeline.test.ts:55-107 |
| from-mdast.ts:607 inline depth | depth | 64 | silent | ad hoc | pipeline.test.ts:107 |
| parse/nesting-scan.ts:14,20 | markers / levels | 256 / 128 | as MAX_NESTING_DEPTH | const | nesting-scan.test.ts |
| render/pipeline.ts:43 | stack overflow net | n/a | note `nested too deeply to typeset` | catch | pipeline tests |
| parse/chunked.ts:59, render/pipeline.ts:127 | pace 3 ms | n/a | yields | pace | chunked/sliced tests |

### reading/
| file:line | limits | value | hit | kind | test |
|---|---|---|---|---|---|
| tree.ts:36 `TREE_MAX_DEPTH` (JSON, YAML, TOML, XML; tree-jsonc.ts:98; tree-stream.ts:349) | depth | 256 | TreeError, then `... cannot draw as a tree: at line N ... Shown line by line, as written.` | const | tree-budget.test.ts:89-91, tree-cap.test.ts |
| tree-stream.ts:29 `ROOT_ENTRIES_MAX` | items | 1000 | silent (counted in `entryCount`) | const | indirect |
| index.ts:250 `TREE_MAX_VALUES` (`Draw.left`) | items | 5000 | stop lines `N more ... here, not drawn ...`, head `the first 5,000 of N values drawn`, `tree.capped` | obj | tree-budget.test.ts, tree-cap.test.ts |
| index.ts:252,254,256 `RECORD_SLACK` / `STREAM_LIMIT` / `KEYS_MAX` | items | 64 / 5256 / 200 | stop lines; Keys detail `the first 200 of N` | const | tree-budget.test.ts:38 |
| index.ts:975 `TREE_MAX_BYTES` | bytes | 1.5 MiB | streamed tree or code page; tier words | const | tree-cap.test.ts |
| index.ts:1096 `MARK_CHARS` | chars per line | 1000 | silent | const | reading.test.ts:209 |
| rows.ts:15 `READING_MAX_ROWS`, :26 `FIRST_ROWS` | items | 2000 / 200 | foot `The first N rows of M ...` | const | reading.test.ts:124 |
| rows.ts:18 `READING_MAX_COLUMNS` | items | 100 | foot and account | const | tree-budget.test.ts |
| rows.ts:21 `READING_MAX_CELL` | chars | 4096 | cut with ellipsis | const | none at the limit |
| rows.ts:23 `HEADER_STEPS` | steps | 65,536 | not a table | const | rows.test.ts:179 |
| rows.ts `indexSome`/`parseSome` | rows + `until()` | caller | returns false | obj | rows.test.ts |
| index.ts:809 `TABLE_WHOLE_BYTES` | bytes | 2 MiB | detail `from the first 2,000 rows` | const | none |
| notebook.ts:17 `NOTEBOOK_MAX_BYTES` | bytes | 64 MiB | code page | const | none |
| notebook.ts:19-20 `OUTPUT_MAX_LINES`/`CHARS` | lines / chars | 2000 / 200,000 | `The first N lines of M; Source has them all.` | const | notebook.test.ts:168 |
| notebook.ts:22 `OUTPUT_MAX_HTML` | chars | 1 MiB | `An SVG/HTML/Markdown output of X MB, past what Marxy ... shows` | const | none |
| notebook.ts:24 `OUTPUT_MAX_IMAGE` | bytes | 16 MiB | `An image output of X MB ...` | const | none |
| notebook.ts:30-31 `NOTEBOOK_MAX_CELLS`/`HTML` | items / chars | 1000 / 1.5 MiB | stop `N more cells here, not drawn. ...` | const | notebook.test.ts:315 |
| heading-scan.ts:10 `SCANNED_HEADINGS_MAX` | items | 20,000 | `capped: true` (wording in desktop) | const | heading-scan.test.ts:85 |
| heading-scan.ts:12,17,19 | chars / bytes | 200 / 4096 / 64 KiB | silent | const | none |
| lines.ts:16,18 `LINES_FROM`/`LINES_READ_ONLY_FROM` | bytes (tiers) | 5 MiB / 32 MiB | account lines | const | lines.test.ts |
| lines.ts:568-570 `ESCAPES_LOOKED_AT`/`SEQUENCE_BYTES` | items / bytes | 20,000 / 300 | silent | const | none |

### derive/, diff/
| file:line | limits | value | hit | kind | test |
|---|---|---|---|---|---|
| derive/jsonl-transcript.ts:499 `FIRST_SLICE_BYTES`, `step(budgetBytes)` | pace (bytes a step) | 64 KiB | returns false | obj | jsonl-transcript.test.ts |
| derive/transcript-html.ts:30 `OUTPUT_BOUND` | lines | 30 (head 10, tail 10) | `... N lines omitted` | const | none at the limit |
| transcript-html.ts:32 `LINE_CHARS` | chars | 4000 | `... N characters omitted` | const | none |
| transcript-html.ts:373 `GROUP_LINES` | items | 40 | `and N more` | const | none |
| diff/lines.ts:35 `DEFAULT_MAX_LINES` | items | 50,000 | null | const | diff.test.ts:253 |
| diff/lines.ts:36 `DEFAULT_BUDGET` (`Ctx.work`) | steps | 3,000,000 | coarse region, `exact: false` | obj | diff.test.ts:279-330 |
| diff/lines.ts:38 `HISTOGRAM_LIMIT` | occurrences | 64 | switches to Myers | const | diff.test.ts:311 |
| diff/words.ts:22-23 `MAX_RUN`/`MAX_TOKENS` | items / tokens | 40 / 400 | silent | const | none |

### office/, book/
| file:line | limits | value | hit | kind | test |
|---|---|---|---|---|---|
| office/xml.ts:26 `OFFICE_LIMITS` elements | items | 2,000,000 | `OfficeLimit("... more than 2,000,000 XML elements ...")` | obj (`XmlBudget`) | office.test.ts:171 |
| xml.ts:191 chars | chars | 16 MiB | `OfficeLimit("... more than 16 MB of text ...")` | obj | office.test.ts:172 |
| xml.ts:295, parts.ts:51 XML bytes | bytes | 128 MiB | `OfficeLimit("... more than 128 MB of XML ...")` | obj | hostile.test.ts:86 |
| xml.ts:324 depth | depth | 256 | `OfficeError("... nests deeper than 256 elements.")` | ad hoc | office.test.ts:173 |
| rtf.ts:262,298,307 field/info/instruction text | chars | 4096 | silent | const | none |
| rtf.ts:820,738,826 control word / digits | chars | 32 / 10 | ignored | const | hostile.test.ts:188 |
| office/index.ts:39 `LEGACY_FILE_MAX` | bytes | 64 MiB | enforced by caller | const | none |
| book/index.ts:15 `BOOK_LIMITS.entries` | items | 20,000 | `BookError("It lists N entries, more than the 20,000 ...")` | const | book.test.ts:213 |
| book/index.ts:127 `chapterBytes` | bytes | 128 MiB | `BookError("Its chapters unpack to N MB ...")` | ad hoc sum | none |
| book/index.ts:193 `chapterEach` | bytes | 16 MiB | chapter `broken` line | const | none |
| book/package.ts:56 `TOC_MOST` | items | 5000 | silent | const | book.test.ts:205 |
| book/package.ts:57 `TOC_DEPTH` | depth | 8 | silent; a heading with no link does not add depth, so the real bound is XML depth 256 | const | none |
| book/package.ts:59 `SPINE_MOST` | items | 10,000 | `BookError("Its spine lists N chapters ...")` | const | none |

### mail/ (what remains)
| file:line | limits | value | hit | kind | test |
|---|---|---|---|---|---|
| mime.ts:7 `messageBytes` | bytes | 64 MiB | throws `The message is N MB, past the 64 MB ...` | const | mime.test.ts:124 |
| mime.ts:9 `depth` | depth | 12 | `Parts nested past 12 levels are not read.` | const (recursion arg) | mime.test.ts:120 |
| mime.ts:10 `headers` | items per part | 1000 | `Only the first 1,000 headers of a part are read.` | const | none |
| mime.ts:11 `headerBytes` | bytes per head | 256 KiB | `A part's headers past 256 KB are not read.` | const | none |
| mail/sniff.ts:7 | bytes | 8192 | silent | const | none |

### viewer/
| file:line | limits | value | hit | kind | test |
|---|---|---|---|---|---|
| archive-read.ts:81 `ARCHIVE_LIMITS.entries` | items | 100,000 | `truncated`: `Listed the first N entries; ...` | obj (`ArchiveLimits`) | archive-read.test.ts:379,492 |
| `.nameBytes` / `.depth` | bytes / segments | 1024 / 64 | entry skipped, `skipped` | obj | :384, :498 |
| `.listedBytes` | bytes | 16 MiB | `Listed the first N entries: their names reach the 16 MB ...` (fixed text, ignores a lower limit) | obj | :388, :500 |
| `.entry` = `ENTRY_CAP` :63 | bytes | 16 MiB | `ArchiveError('refused', "... over the 16 MB an entry may open with.")` | obj | :346, :506 |
| `.head`/`.heads` | bytes | 256 KiB / 16 MiB | silent | obj | archive-read tests |
| archive-read.ts:92 `STREAM_CAP` | bytes | 1 GiB | `... the walk stops after 1 GB of unpacked stream.` | const | none |
| archive.ts:7 `ENTRY_OPEN_CAP`, :10 `FOLD_ABOVE_ROWS` | bytes / rows | 16 MiB / 2000 | reason / folds | const | archive.test.ts |
| archive-care.ts:17,19 | ratio / bytes | 100x / 1 MiB | flags a bomb-like entry | const | archive-care.test.ts |
| archive-plan.ts:228, archive-strip.ts:194, archive-reading.ts:9 | cells, tries, rounds, bytes | 400/40/2, 32, 4096 | silent | const | their tests |
| tables.ts:165-173 `DB_PAGE`, `SHEET_DRAW`, `TEXT_CAP`, `COLUMNS_DRAWN`, `BLOB_OPEN_CAP` | rows / chars / columns / bytes | 200 / 2000 / 2000 / 100 / 16 MiB | `The first 2,000 of N rows are drawn ...`; cell `more` | const | tables.test.ts |
| tables.ts:669-671 format codes | chars / digits | 255 / 30 / 30 | null / clamp | const | tables.test.ts |
| image-facts.ts:98,106,112,189,208,318,386,412,468 | IFD entries, TIFF counts, values, ICC tags, GIF blocks, ICO entries, boxes, ipma | 512, 65,536, 8, 100, 512 B, 100,000, 64, 4096, 65,536 | silent | ad hoc loop guards | none |
| image-facts.ts:406 `MAX_META_BYTES` | bytes | 4 MiB | facts left at zero | const | none |
| picture-facts.ts:29 SVGZ | bytes | 16 MiB | `This SVGZ unpacks to more than 16 MB ...` | const | picture-facts.test.ts:39 (not at limit) |
| picture-facts.ts:27 `MAX_PIXELS` | pixels | 2^26 | `... past the 67108864 a decode may hold.` | const | picture-facts.test.ts |
| picture-facts.ts:164,206 | PSD resources / layers | 4096 | silent | ad hoc | none |
| program.ts:8-22 (`PROGRAM_READ_MAX`, `STRING_MAX`, `SECTIONS_MAX`, `RESOURCE_DEPTH`, `ENTRIES_MAX`, `NODES_MAX`, `DEBUG_ENTRIES_MAX`, `TABLES_MAX`) | bytes, chars, items, depth | 16 MiB, 32 KiB, 96, 3, 4096, 512, 64, 32 | reasons (`it names N sections ...`), `cut: true`; some silent | const + ad hoc `nodes` | program.test.ts, fuzz |
| shortcut.ts:7-14 | bytes, chars, items | 1 MiB, 32 KiB, 64, 1024 | `cut: true`, some silent | const + ad hoc | shortcut.test.ts |
| cert.ts:9-15 | bytes, items, depth, chars | 1 MiB, 100, 16, 200 | `Only the first 1 MB were read.`, `N more certificates are not listed`, depth reason | const | cert.test.ts:82, fuzz |
| font.ts:89,95,260 | bytes, cells | 30 MiB, 2000 | constant; throws on tables past 2x the file | const | none |
| media.ts:51-54 | items, bytes, seconds | 1000, 20 MiB, 600 | constants | const | media.test.ts |
| pdf.ts:279 `flattenOutline` | items / depth | 500 / 6 | silent | ad hoc | pdf.test.ts |

### highlight/, log/, kind/, render/, encoding/, index-model/
| file:line | limits | value | hit | kind | test |
|---|---|---|---|---|---|
| highlight/index.ts:82 `MAX_HIGHLIGHT_BLOCK_CHARS` | chars | 200,000 | block left plain | const | highlight.test.ts:245 |
| highlighter.ts:93 `DEFAULT_LINE_CAP` + per grammar | chars per line | 1000 (400 C/C++, 500 Go/shell) | line plain | const | highlight.test.ts:224 |
| highlight/tier.ts:9,11 | bytes / chars | 2 MiB / 10,000 | `Plain text · no colour past 2 MB` etc. | const | tier.test.ts |
| log/head.ts:26 `LOG_HEAD_CHARS`, log/ansi.ts:161, log/summary.ts:32 `NOTABLE_MAX` | chars / items | 4096 / 256 / 40 | silent; `notableTotal` | const | their tests |
| kind/sniff.ts:9-13, kind/detect.ts:21-23 | bytes | 256 KiB, 1.5 MiB, 16 KiB; 16, 64 KiB | stays text / silent | const | sniff/detect tests |
| render/frontmatter.ts:11, render/images.ts:309 | rows / bytes | 12 / 64 KiB | folded / default size | const | their tests |
| encoding/decode.ts:29-33 | bytes | 1 MiB / 8 MiB / 120 | `counted` | const | encoding.test.ts |
| index-model/content-search.ts:12 `CONTENT_SEARCH_LIMITS` | hits, files, bytes | 200 (to 10,000), 5 a file, 256 MiB, 100,000 files, 1 GiB | `truncated`, `stopped` | const | cases.json |
| index-model/query-eval.ts:103-104 | terms / values | 64 / 64 | `the query is long: only the first 64 terms ...` | const | query-eval.test.ts |
| index-model/near-dup.ts:23 | items | 6 | silent | const | near-dup.test.ts |

Not reader budgets (user state, not file content): position/storage.ts `POSITIONS_LRU_CAP`; layout/frame-storage.ts `MAX_SETS`, `MAX_SET_PATHS`, `FRAME_MAX_BYTES`, `MAX_PLACES`; layout/persistence.ts, layout/storage.ts, layout/geometry.ts caps; reading/part-choices.ts `PART_CHOICES_CAP`; kind/show-as.ts `KINDS_CAP`; kind/registry.ts `CONTENT_MAX`; buffer/history.ts undo depth; contracts/index-entry.ts `INDEX_LIMITS`; index-model/collection.ts and capture.ts caps; highlight/session.ts `LOOSE_MAX`.

## Walks with no bound, or a bound that does not hold (candidates)

1. reading/tree.ts:422-430 TOML `child()` searches the parent's children linearly per table header: ~150k `[tN]` headers in 1.5 MB is ~10^10 comparisons. Needs a map, then a step budget.
2. outline/outline.ts:23-26 `found.push(...headingsOf(child))`: more than ~100k headings in one container throws RangeError; no cap on Outline entries (heading-scan has 20,000).
3. page/clean.ts:207 `<title ...>([\s\S]*?)</title>` on raw HTML: many unclosed `<title>` is O(n^2).
4. paste/classify.ts:29-30 `TABLE_DELIMITER` and `INLINE_MARKS`: O(n^2) on a line of spaces or `[`; clipboard, no length cap.
5. reading/index.ts:1094-1112 `carriesMarkdown`: O(L^2) per line with L to 1000, lines uncounted below 5 MB; verse and prose readings draw every line below 5 MB.
6. render/punycode.ts:24-66: `splice` is O(n^2) in label length, no RFC 3492 overflow checks, `fromCodePoint(...output)` spread; no label length cap.
7. viewer/archive.ts:143-145 `archiveSums`: every prefix of every path joined, up to ~1e9 character copies within the caps.
8. viewer/archive-read.ts:1092,1163 `inflate(bytes,'gzip')` with no limit: a .gz is unpacked whole before `STREAM_CAP` applies (left to the injected `Inflate`).
9. viewer/image-facts.ts:246-248 PNG `iCCP` inflated with no size limit; JPEG ICC segments concatenated with no cap.
10. sanitize/sanitize-html.ts: no cap on `removed` records (1M `<x>` gives 1M) or on the writer's open stack.
11. reading/rows.ts JSON Lines: each line parsed whole with no per-line byte cap (keys now bounded).
12. reading/tree.ts YAML and XML: the whole tree is built before `TREE_MAX_VALUES` applies at draw time (linear; acceptable).
13. office/xml.ts:367-379 `find`: BFS with `todo.shift()`, quadratic on wide trees up to 2M elements.
14. book/package.ts:225-237: `TOC_DEPTH` bypassed by headings without links.
15. diff/words.ts: tokenises every line of a run before the `MAX_TOKENS` check.
16. mail/mime.ts `delimiters`: each nesting level rescans its range, O(depth x bytes) with depth <= 12 (count now bounded, the scan is not).
17. viewer/cert.ts:118-121 `checkTree`: no node count cap (linear, <= 1 MB).
18. No deadline anywhere in core: `budgetMs` only paces.

## Next slices (suggested order)

1. Unbounded and quadratic first: TOML `child()` (1), Outline spread and cap (2), `<title>` regex (3), punycode (6), gzip and iCCP inflate limits (8, 9: core side passes a limit to the injected inflate), sanitizer `removed` cap (10).
2. Ad hoc counters onto the shared budget, keeping their notes: parse/bounded-attention, from-mdast depth, mime headers and headerBytes (add tests: both untested), image-facts and picture-facts loop guards (silent today: say so on the facts card), program/shortcut/cert counters, pdf `flattenOutline`, book `chapterBytes` and `TOC_DEPTH`.
3. Existing budget objects to the shared shape: office `XmlBudget`, archive `ArchiveLimits` (and fix the fixed "16 MB" listing wording), diff `Ctx.work`, reading `Draw.left`.
4. Constants with notes but no test at the limit: notebook `OUTPUT_MAX_HTML`/`IMAGE`, transcript `OUTPUT_BOUND`/`LINE_CHARS`/`GROUP_LINES`, book chapter caps and `SPINE_MOST`, RTF field text, `READING_MAX_CELL`, archive `STREAM_CAP`.
