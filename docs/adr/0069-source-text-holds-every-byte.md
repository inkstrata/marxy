# ADR-0069 — The Source text holds every byte: a byte that is not UTF-8 is its own code unit

- **Status:** accepted (author, 2026-10-11, X-18; the default, as proposed)
- **Date:** 2026-10-11
- **Reads:** commitment 3 (faithful to the bytes) and commitment 4 (nothing hidden silently) in `AGENTS.md` and
  ADR-0052; ADR-0003 (one buffer); ADR-0005 (Source mode).
- **Evidence:** F-33's walk finding (#570); the three returned attempts at F-34 (#576, closed) and their reviews; the two
  reviews of F-34.1 (#584), whose open items F-34.2 closes.

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
   index, operations), stays the reading decode with U+FFFD. Text leaves the editor (copy, cut, drag, Copy as, Copy
   table as CSV) through `readableText`, which writes U+FFFD for a lone surrogate. CodeMirror's find panel seeds its
   query from the selection and announces each match in a live region; both go through `readableText` too.
3. **The editor's own copy carries its bytes on the same pasteboard item.** A copy, cut or drag out of the editor
   whose text holds a stray byte writes, beside `text/plain` (the readable text), a type of the editor's own,
   `application/x-marxy-source-text`, holding the exact text as JSON (a lone surrogate as its `\udcff` escape). A paste
   or drop restores the exact text only when the item it reads carries that type and the type's text reads as the
   item's `text/plain`. The type may name stray bytes and nothing else: a lone surrogate outside U+DC80 to U+DCFF in it
   (a lone high surrogate would join a stray byte already in the text and make a valid pair: a forged `"\ud800"`
   pasted before a stray `FF` wrote `F0 90 83 BF`) makes the whole item be read as its `text/plain` (F-34.2).
   Another program's copy replaces the whole item, so it can never be taken for ours, and a drag
   writes its own item, not the clipboard. WebKit hands a page's own types back only to the same origin. Every other
   paste (another program's, Paste and Match Style, an HTML paste read through the shell) gets U+FFFD for any lone
   surrogate, so it never names a stray byte. The type is not a Copy as target and nothing outside the editor reads
   it; J-04's rule against custom types was for Copy as targets, which write through the shell's one pasteboard item
   (ADR-0065 item 2), and is not changed. A string match against an in-memory last copy was tried first and rejected
   in review: a cancelled drag overwrote it, and another program's U+FFFD matched a copied stray.
4. **A stray byte is shown, never hidden.** Source marks each one with its value in hex in a thin box (`E9`), labelled
   "Byte E9, not UTF-8" for a pointer and a screen reader; the code unit itself never reaches the DOM.
5. **Positions cross the two texts through the bytes.** A stray sequence of several bytes is several code units in
   the Source text and one U+FFFD in `Buffer.text`; the CodeMirror position conversions map through the byte offsets,
   and are the identity when no such sequence exists (every valid file).
6. **A continuation byte that belongs to no character is a boundary.** The Source text gives it a code unit, so an
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
  two bytes, which is what the text named; read back after a save, it shows `é`. The editor takes the read-back by
  replacing only the part that differs, so the caret maps through it, and the replacement is a step of the editor's
  history, joined to the reader's last edit (F-34.2). Undoing that edit puts back the text the reader had, so each Mod+Z
  after a save is byte-exact (a replacement outside the history was mapped over by the undo of the line break between
  the two bytes, and put it beside `é`: the second Mod+Z was not exact). Two edges, both visible and neither changing a
  byte: when the caret moved after the typing, the history cannot join and the read-back is a step of its own, so the
  first Mod+Z after the save shows the two bytes boxed again and the next takes the typing back; and a read-back
  is a new step, so a redo that was pending is gone. A change from outside (a reload from disk, a Rendered undo,
  another pane's fold, or the line separator swapped because a save made the file's endings uniform or mixed) is not the
  editor's fold: it is taken outside the history, and the editor's history is dropped with it, because every change in
  it was made at positions the new text no longer has (mapped through a whole-text replace they all landed at the end,
  and a Mod+Z wrote a CRLF there; mapped through a Rendered undo they put back a character that undo had taken out).
  Source's Mod+Z then has nothing to undo until the reader types again. A key typed in the same task as a save's fold (before the fold settles) is not a change from outside: the fold goes
  again over the text the editor holds, so the key stays in the editor and the store, and the next write has it (F-42). The store's undo in Rendered is byte-exact
  throughout, and steps back over every fold (F-40).
  The same holds for Mod+E, which folds the same way (`foldEditorInto`: a key typed while its fold waits is folded
  too, and Rendered shows it), and for the title refresh after a fold: a key typed then stays in the editor for the
  next save, and the save in progress still writes, because only text held apart (D-11) refuses a save (F-42.1).
  A fold diffs its text against the store at its turn, so one made ready before another pane's fold landed would write
  that fold out: B's text was lost when B left while A typed. The store asks the view at that turn (`commitSource`'s
  `refuse`), and a view held apart by then, or whose editor took other bytes, does not fold; its text stays in its editor,
  leaving Source says why, and what the other pane folded stays in the store (F-48).
- Searching Source for U+FFFD does not find a stray byte (it is a different character there); the marker shows it.
- A line copied with no selection (CodeMirror's line-wise copy) that holds a stray byte pastes back as text at the
  caret, not as a whole line, because CodeMirror compares the pasted text with the filtered copy.
- The block editor in Rendered (ADR-0048) holds the Source text of its block (`sourceTextOfRange`), folds it through
  `foldSlice` over that text, and applies the bytes (`store.apply` takes bytes as well as text), so a stray byte the reader
  did not edit keeps its bytes, however many edits are made around it, and the editor marks it like Source (F-34.2).
  Line endings are the same: only a line break the reader made (a bare LF) takes the block's first ending, and an ending the
  text already holds is never rewritten; in a block that mixes endings, edited across one of its bare LFs, a new break stays
  an LF (F-40). In such a block the text names every ending, so an LF that the cut was widened over (the other half of a CRLF
  whose CR was deleted) is the file's own and is never converted: deleting only a CR is written (F-40.1).
  Its copy, cut and paste carry the private type as Source's do. The block's text is read for the page (the notice that
  names a kept block) through `readableText`.
- The Source table tools work on a table that holds a stray byte: they run on a copy with each such code unit stood in
  for by a private-use character the text does not hold, and what they write is mapped back.
- Opening Source on a file that is almost all stray bytes costs the Source decode once (about 0.4 s for 1 MB of `FF`);
  a file with no stray byte costs one `indexOf`.
