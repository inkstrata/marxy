# ADR-0071 — Decoded table cells: a second deriver for CSV and TSV, and a `cell` selection that copies what it shows

- **Status:** accepted (author, 2026-10-12, K-10b question 1: the table shows a quoted field's decoded value); amended 2026-10-13 (F-89)
- **Date:** 2026-10-12
- **Amends:** ADR-0061 (derived views): item 1 admits a second deriver, `delimited-table`; item 3 gains the `cell` node
  and the `csv-field` decoding; item 4.2 allows an empty range for an empty field; item 5 gains the `cell` selection;
  item 10's list of decodings and node types grows by the ones named here. ADR-0003, ADR-0004, ADR-0045, ADR-0054 and
  ADR-0065 are read, not changed.
- **Reads:** commitment 3 (faithful to the bytes) and commitment 4 (nothing hidden silently) in `AGENTS.md` and ADR-0052;
  commitment 5 (first text never waits for the whole file).
- **Evidence:** the K-10b card in `docs/plan/direction-2026-10/18-cards-wave-9.md`; `mock-v2/03-content-modes.md` §Data;
  RFC 4180.

## Context

K-10b gives a `.csv` or `.tsv` a **table lens**: summoned from the strip or the palette, it swaps the pane's Source for a
grid, and Esc or the tool again returns to Source at the same row. A field in RFC 4180 may be quoted, and a quote inside a
quoted field is doubled, so the field `"a ""b"""` means `a "b"`. That text is not a substring of the file. A grid showing it
is a derived view in ADR-0061's sense, and ADR-0061 item 10 says a new decoding or a new derived node type needs a record.
The alternative, showing the raw field, needs none, and reads like a parser's debug output on any spreadsheet export that
quotes its fields.

## The rulings (2026-10-12)

1. **The grid shows a quoted field's decoded value** (`"a ""b"""` shows as `a "b"`), and ADR-0061 is amended to admit a
   second deriver and a `cell` selection. This record is that amendment.
2. **The first row is a header** when every field in it is non-numeric and the fields are distinct. The grid then says
   "Row 1 used as header", and one click makes it a data row again. The choice is the view's; it writes nothing.
3. **Table takes the first slot of the data strip**; Chart drops off the list until it has a story.
4. **(Lead, on review of this record.)** TSV fields are not decoded: TSV has no quoting (item 1). The lead also confirmed
   that a one-cell copy carries no formula guard, that only a collapsed `""` marks a cell, and that an empty field may
   have an empty range.

## Decision

1. **A deriver is a pure function from the buffer to a read-only tree** (ADR-0061 item 1): it lives in `packages/core`,
   never writes, is recomputed whenever the bytes change, and every node it makes carries file provenance. A deriver
   declares the decodings its leaves use, and each decoding is an exact, total function from a leaf's bytes to its value.
   This record admits a second deriver, **`delimited-table`**, for a file of kind `data` (ADR-0060) whose extension is
   `.csv` (delimiter `,`) or `.tsv` (delimiter a tab). The delimiter comes from the extension, never from sniffing the
   content. A CSV field's decoding is **`csv-field`** (item 2). **A TSV field is not decoded** (lead ruling, 2026-10-12):
   IANA `text/tab-separated-values` has no quoting, so a TSV field's value is its raw bytes between tabs, decoded as UTF-8
   and nothing else (`decoding: 'none'`). It is never marked as decoded, a field starting with `"` reads as written, and a
   stray quote never makes a row `unreadable`. A TSV record ends at the next `\n` or `\r\n`; a field cannot hold a tab
   or a line break.

2. **The `csv-field` decoding (CSV only).** A field is the bytes between two delimiters, or between a delimiter and a record
   terminator (`\n` or `\r\n` outside quotes), or the start or end of the record.
   - A field whose first byte is not `"` is **verbatim**: its value is its bytes, decoded as UTF-8 and nothing else. Most
     cells of most files are this case, and their displayed text is a substring of the file.
   - A field whose first byte is `"` is **quoted**: it runs to the matching closing `"`, and its value is the bytes between
     the two quotes with each `""` read as one `"`. Delimiters and line breaks between the quotes belong to the value,
     byte for byte (a `\r\n` inside a field stays `\r\n`).
   - A field such as ` "b"` (a space before the quote) is verbatim, as RFC 4180 has it, and shows its quotes.
   - **The invariant** that replaces `value === bytes` for a cell, exact and not "modulo":
     `decodeCsvField(bytes[src.start, src.end)) === value`, where `decodeCsvField` is the rule above over the standard
     UTF-8 decoding (U+FFFD for each invalid sequence, each one marked as ADR-0061 item 7 asks).

3. **The tree.** The deriver's node types are `table` (the root), `row` (one record), `cell` (a leaf: one field),
   `unreadable` (a record that is not well formed, shown raw) and `pending` (an unfinished last record while the file is
   still being read). They live in `contracts/derived.ts` beside the transcript's (ADR-0061 item 2), so a `cell` is a
   `DerivedNode`, not a `Node`, and the type checker refuses to hand one to an operation. A `cell` carries `src` (the
   whole raw field, quotes included), `value`, `decoding: 'csv-field'` (CSV) or `'none'` (TSV, item 1), `syntax: 'plain'` (a field is never parsed as
   Markdown) and `decoded: boolean`, true when the value differs from the bytes between its quotes, that is, when the
   field held a `""`. ADR-0061's invariants hold with these readings:
   - 4.2, amended: an **empty field** (`a,,b`) has one empty range, at the byte where it would start. It is the only
     derived node whose range may be empty; the ordering and hull rules are unchanged.
   - 4.5 covers `cell` leaves by item 2's invariant.
   - 4.7, accounting, is stated in bytes for this deriver: **every byte of the file is in exactly one of** a cell, a
     delimiter, a record terminator, a leading UTF-8 BOM, an `unreadable` row, a blank line in `dropped`, or the one
     `pending` record. So the fields of a row tile its record between the delimiters, and nothing falls between rows.
   - In a CSV, a record with an unclosed quote, or with bytes after a closing quote before the next delimiter (`"a"b`), is one
     `unreadable` row: its own line, shown raw in the code face and marked, never dropped, and parsing resumes at the next
     line. An unclosed quote never swallows the rest of the file.
   - A ragged row keeps its own field count. A row shorter than the widest shows its missing cells as **absent**, marked
     apart from an empty field (an absent cell has no bytes; an empty field has a place in the file); a longer row adds
     columns. Nothing is padded into the bytes or trimmed from them.

4. **A cell's text is derived, and the raw field is always one action away (commitment 4).** The lens reshapes more than
   Source, so it says so, at the view and at each place:
   - the grid opens with one quiet line, for example *Table from 1,207 lines of CSV · Row 1 used as header · 4 fields
     decoded · 1 row unreadable · 2 blank lines · Source Esc*. Each count unfolds to its places, each a Jump to source;
   - a cell whose `decoded` is true carries **`data-marxy-decoded`** (registered in `scripts/registry.json` before use) and a
     mark visible at rest, quiet as the theme chooses, whose accessible description is the raw field (*decoded from
     `"a ""b"""`*). The outer quotes of a quoted field are the format's delimiters, as a pipe is in a Markdown table, and
     the grid's cell edge stands for them, so removing them alone does not mark the cell; collapsing a `""` does;
   - a line break inside a field shows as a visible mark in the cell, never as a silent space;
   - decoded values go through the same invisibles pass as Markdown text (`render/invisibles.ts`): a bidi control, a
     zero-width character or an ANSI escape shows as its marker, never acts;
   - a leading BOM is named in the header line; an absent cell, an `unreadable` row and a `pending` record each say what
     they are;
   - **Source is one action away**: Esc or the Table tool returns to Source at the same row (a row's `src.start` is a file
     offset, so ADR-0018's reading position needs no change), and *Jump to source* on a cell selects its raw field. The map
     from a decoded offset to a raw byte is monotone (one byte for the opening quote, two bytes for each `"` in the
     value), so the landing can be character-exact.

5. **The `cell` selection.** A click on a cell in the grid selects it: a new selection granularity, `cell`, which is why
   ADR-0045 item 4 asks for this record.
   - **In bytes, a `cell` resolves to the whole raw field**, `src`: from its first byte to its last, the quotes of a quoted
     field included, the delimiter and the record terminator excluded. An empty field resolves to its empty range; an
     absent cell resolves to nothing (it has no bytes) and offers only the row's verbs.
   - **`⌘C` on a cell copies its decoded value**, as plain text, one pasteboard item, no HTML representation. Why: it is
     what the reader is reading (ADR-0061 item 5 makes the same choice for derived text), and it is what any place they
     paste it expects. The raw field pasted into a spreadsheet or a message would be read a second time, and `""` would
     come out as two quotes or the outer quotes as text. Copying a cell is faithful to the cell, not to the field, and the
     difference is never silent: a cell where the two differ carries the mark of item 4.
   - **The raw field is a *Copy as* target**, **Source field (CSV)**: the exact bytes of `src`, quotes and
     doubled quotes included. A TSV cell's value is its bytes, so it needs no such target; its `⌘C` is already the raw
     field. It is a separate target, not a second representation in every copy, for ADR-0061's reason
     (the paste would depend on the receiving app). It is also a verb-menu row.
   - A single cell's copy carries no formula guard. The guard on table copies (`03-selection-and-operations.md`, "Table
     copies carry no live formula") protects a bulk copy whose cells the reader has not each seen; a cell copy is one value
     the reader is looking at, and prefixing a `'` would make the copy say something the cell does not. Copy as TSV, CSV or
     Rich text of more than one cell keeps the guard.
   - A drag inside the grid is `derived-text` (ADR-0061 item 5) and copies what it covers as displayed.

6. **What may act on a cell.** Nothing that splices. A cell's value is decoded text, and writing an operation's result
   back would mean re-encoding and re-quoting the field, which ADR-0003 forbids. The verb menu on a `cell`, within
   ADR-0054's seven, in order:

   | Kind | `⌘C` default | Menu (at most seven) |
   | --- | --- | --- |
   | `cell` | copy the decoded value | Copy · Copy as… · Source field (CSV only) · Column stats · Sort by this column · Jump to source · Open in Source |

   - *Column stats* and *Sort by this column* read: the stats are computed from decoded values, and the sort orders the
     view, never the file. A type is inferred for alignment and sort only.
   - *Transform* (ADR-0065) may run on a cell's decoded value with its result to the sheet or the clipboard; the sheet
     offers no Apply there.
   - **Not offered:** editing a cell, any registered operation, Source for one block (ADR-0048), and any write. The file
     stays editable in whole-document Source, an ordinary editor over its bytes, and the table is derived again from
     whatever the bytes become.

7. **The faithful-bytes guarantees that still hold.** The lens never writes. The buffer is the only truth, and the header
   choice, the sort and the column stats are view state over it. No `cell`, `row` or `table` node reaches a splice: the
   type boundary of ADR-0061 item 2 holds for them, and K-10b's dispatch test covers the new kind. Source shows the file
   byte for byte, quotes and all. `pnpm gate:fidelity` keeps covering every operation and the save path; the lens adds no
   write path for it to cover. `AST_INVARIANTS` and the existing goldens do not move.

8. **Fast.** Records are parsed in order and the deriver yields rows as it goes, so the first screen of rows needs only the
   first records (commitment 5). A quoted field may span lines, so a record ends at the first terminator outside quotes;
   the unclosed-quote rule of item 3 bounds how far one bad quote can reach (its own line).

## Amendments

**2026-10-13 (F-89, follow-ups from the review of K-10b).** Four readings made exact; the rulings above stand.

1. **A lone `\r` ends a record**, as `\n` and `\r\n` do (item 1's terminators, item 2's record end). It is the line ending of
   an old Mac file; a file with only these read as one record of ␍-marked fields. Inside a quoted field a `\r` is still
   data. Source shows the bytes as they are, and the header line says *lines end in CR alone*. The accounting rule is
   unchanged: a lone `\r` is a record terminator, or a dropped blank line.
2. **An unreadable row says how far its quote reached (commitment 4).** The row stays its own first line (item 3), and the
   lines after it are still read as rows of their own, so an unclosed quote cannot swallow the file. Those rows may have
   been part of the broken record, and the row says so: it carries `swallowed`, the number of lines after its own that
   start inside the quote (for a quote never closed, every line to the end of the file; for one that closed late, the lines
   up to the one it closes on), and the grid prints it (*the quote runs on · the 2 lines after it may have been part of it,
   read as rows of their own*). The rule is a count on the marked row, not a mark on each later row: a bad quote near the
   top of a long file would otherwise mark the rest of it.
3. **The delimiter is still the extension's; a file that looks like another gets a hint.** *Sniff the delimiter* stays
   rejected: the table is never read again with a guess. When every row read so far is one field, and each of the first 20
   holds the same number of one other candidate (`;`, a tab, `|`, or `,` in a TSV), the header line says *This file may use
   ';' between fields*. A real table, or rows whose counts differ, gets no hint.
4. **The grid draws the columns in view, as it draws the rows in view.** A file of thousands of columns costs the cells on
   screen: the table holds the row numbers, the columns in view with a margin, and at most one spacer a side of the width
   the others would have had. Column stats are counted for the columns in view and for others as they scroll in; the sort
   is slices over one column. Nothing in the bytes, the selection or a copy changes: a copy of the whole table still
   reads every column.

## Consequences

- K-10b builds it: the `delimited-table` deriver and `decodeCsvField` in `packages/core/src/data/delimited.ts`, the `cell`
  and `row` types and the amended invariants in `contracts/derived.ts` (written by K-10b if K-12 has not yet landed it), the
  grid, the `cell` selection and its menu, the *Source field* Copy as target, `data-marxy-decoded` in the registry, and the
  fixtures (quotes, doubled quotes, embedded newlines, a ragged row, an unclosed quote, a BOM, blank lines).
- `docs/design/03-selection-and-operations.md` describes the `cell` selection (this pull request).
- The mark's look, the header line's wording and how a line break inside a cell is drawn are taste, set by K-10b and its
  review.

## Rejected

- **Show the raw field** (`"a ""b"""`). No amendment needed, but the grid would read as a parser's output on every export
  that quotes its fields, and the reader would decode in their head what the machine can decode exactly.
- **Copy the raw field by default.** Pasted anywhere, the field is parsed a second time or read as literal quotes. The raw
  field stays one choice away as a Copy as target.
- **Mark every quoted cell.** Many exports quote every field; a mark on every cell is no mark. The mark is for a value the
  bytes spell differently, not for the format's own delimiters.
- **Sniff the delimiter from the content.** A guess that changes with the first lines is a surprise; the extension says. (A hint that names another delimiter, and reads nothing again, is not this: amendment 3.)
- **Trim spaces around fields or quotes.** That would show text the file does not hold.

## How we would know this was wrong

1. **A cell says something the field does not.** Any value that is not `decodeCsvField` of its bytes, or a byte that is in
   no cell, delimiter, terminator, BOM, unreadable row, dropped blank line or pending record, is a bug against items 2
   and 3; the fixtures should have caught it.
2. **Readers copy the raw field more than the value.** Without telemetry the evidence is taste review and the author's use:
   if *Source field* is the copy people reach for, the default was wrong.
3. **A splice reaches a cell's bytes.** The type boundary leaked; the answer is a test at that path, not a flag.
