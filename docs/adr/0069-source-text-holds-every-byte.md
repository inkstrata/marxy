# ADR-0069 — The Source text holds every byte: a byte that is not UTF-8 is its own code unit

- **Status:** proposed (F-34.1)
- **Date:** 2026-10-11
- **Reads:** commitment 3 (faithful to the bytes) and commitment 4 (nothing hidden silently) in `AGENTS.md` and
  ADR-0052; ADR-0003 (one buffer); ADR-0005 (Source mode).
- **Evidence:** F-33's walk finding (#570); the three returned attempts at F-34 (#576, closed) and their reviews.

## Context

Source edits fold back into the file through text (`foldText`). The editor's text was the reading decode of the
bytes, in which every byte that is not UTF-8 is U+FFFD. So the text cannot say which byte stood where: two edits
either side of one rewrote it as `EF BF BD`, and the three attempts to diff around the U+FFFDs each wrote a wrong or
lost byte somewhere (a moved line, a deleted neighbour, two lines with the same text and different bytes). Text
equality was not byte equality, and no diff over that text can make it so.

## Decision

1. **Source decodes for the bytes.** The Source editor's text is the reading decode with one change: each byte of an
   invalid sequence is the lone low surrogate U+DC00 + that byte (U+DC80 to U+DCFF; PEP 383's `surrogateescape`).
   Valid UTF-8 never decodes to a lone surrogate, so the mapping is one to one: encoding writes each of those code
   units as its byte and everything else as UTF-8, and a U+FFFD the file holds, or the reader types, stays `EF BF BD`.
   The fold is a common prefix and suffix over this text and is exact by construction: the file after a fold is the
   bytes the editor's text names, moves and copies included. `null` means no byte differs.
2. **Only the Source editor holds it.** `Buffer.text`, and everything read from it (Rendered, the outline, find, the
   index, operations), stays the reading decode with U+FFFD. Text leaves the editor (copy, cut, drag, Copy as) through
   `readableText`, which writes U+FFFD for a lone surrogate. A paste or drop of the editor's own last copy gets its
   bytes back (one copy, in memory); any other incoming text has U+FFFD for a lone surrogate, so a paste never names
   a stray byte.
3. **A stray byte is shown, never hidden.** Source marks each one with its value in hex in a thin box (`E9`), labelled
   "Byte E9, not UTF-8" for a pointer and a screen reader; the code unit itself never reaches the DOM.
4. **Positions cross the two texts through the bytes.** A stray sequence of several bytes is several code units in
   the Source text and one U+FFFD in `Buffer.text`; the CodeMirror position conversions map through the byte offsets,
   and are the identity when no such sequence exists (every valid file).
5. **A continuation byte that belongs to no character is a boundary.** The Source text gives it a code unit, so an
   edit may begin or end there; `splice` refuses only an offset inside a well-formed character (this also settles
   F-35's `RangeError`).

## Alternatives

- **Diff the reading text more cleverly** (F-34's three attempts: lines, patience anchors, pairing U+FFFDs). Rejected:
  the information is not in the text, so every heuristic either re-encodes a stray byte or writes another's value.
- **Track stray bytes beside the text** (a range set mapped through each change). Rejected: a move or a copy is a
  delete and an insert, so the marker does not travel with the text, and undo and paste lose it.
- **Escape into the Private Use Area** (for example U+F780 + byte). Rejected: a valid file can hold those characters,
  so the mapping would not be one to one.
- **Make `Buffer.text` itself the escaped decode.** Rejected: lone surrogates would reach the parser, Rendered, the
  index and every operation, each needing a filter, and the goldens would move. Keeping the escape inside Source is
  the smallest surface that holds the bytes.

## Consequences

- Commitment 3 holds for Source with any bytes: a reader's edit changes exactly the bytes they changed.
- Two stray bytes made neighbours by an edit can spell a character (`C3` and `A9` are `é`). The file then holds those
  two bytes, which is what the text named; read back, it shows `é`, and the editor takes the new text as a reload does.
- Searching Source for U+FFFD does not find a stray byte (it is a different character there); the marker shows it.
- A line copied with no selection (CodeMirror's line-wise copy) that holds a stray byte pastes back as text at the
  caret, not as a whole line, because CodeMirror compares the pasted text with the filtered copy.
- The block editor in Rendered (ADR-0048) still folds through the reading text (`foldSlice`); two edits around a
  stray byte inside one block there are not yet exact. A follow-up story applies the same decoding to it.
