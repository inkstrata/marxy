# ADR-0061 — Derived views: a read-only tree beside the AST, derived from the bytes, with provenance to the lines it came from

- **Status:** proposed (K-02); accepting it is the author's act
- **Date:** 2026-10-10
- **Amends:** ADR-0003 (one buffer, one AST): a file may also be read through a second pure function
  of the same buffer. ADR-0004 (editing is transformation), ADR-0023 (provenance in the DOM),
  ADR-0045 (contracts change by pull request) and ADR-0054 (the verb menu) are read, not changed.
- **Decides:** research proposal P10
  (`docs/research/reader-artifacts/proposals/P10-derived-transcript-view.md`), which was blocked by
  the AST contract. Kind `transcript` is named by ADR-0060 (kinds, K-01).
- **Evidence:** `docs/research/reader-artifacts/02-agent-artifacts.md` ("A derived transcript view
  for JSONL": 503 of 941 lines in one session file were conversation);
  `docs/research/reader-artifacts/10-spec.md` (the transcript rows and the `copy-turn` family);
  `docs/plan/direction-2026-10/04-capture.md` ("The transcript view");
  `docs/plan/direction-2026-10/mock-v2/03-content-modes.md` ("Transcript").

## Context

**The problem in bytes.** A Claude Code session is a JSONL file: one JSON object per line, up to
tens of kilobytes a line. A user turn is a line like

```
{"type":"user","message":{"role":"user","content":"Fix the \"bug\" in a.ts\n"},"uuid":"…"}
```

and the reader wants to see `Fix the "bug" in a.ts`. That text is not a substring of the buffer:
the quotes are spelled `\"`, the newline is `\n`, a `‮` in the file is one character on screen.
A `text` node's promise in `AST_INVARIANTS` is that decoding `bytes[src.start, src.end)` yields its
`value` modulo *markdown* escapes, so no node of today's AST can hold that text. Worse, the line is
not all text: most of it is fields a reader never asked to see, and one assistant message is often
spread across several lines (text, a tool call, more text) with the tool's result on a later line.
A transcript view is a filter and a regrouping of the file, not a rendering of it.

ADR-0003 makes the buffer the only truth and every node carry `{file, start, end}`; ADR-0004 makes
every edit a pure `string → string` over a byte range. Both must survive this view intact: the
risk is a view whose ranges look like splice targets but whose text is not the bytes.

## Decision

1. **A derived view is a read-only tree computed by a pure function of the buffer.**
   `derive(bytes, file) → DerivedTree` lives in `packages/core` (no DOM, no shell, ADR-0020), never
   writes, and is recomputed from the bytes whenever they change. It is never authoritative: the
   buffer stays the only truth, so the "no document model" rule of ADR-0003 is kept (a document
   model is one you edit; this one cannot be edited). This record admits exactly one deriver,
   **`jsonl-transcript`**, for a file of kind `transcript` (ADR-0060) whose bytes are JSONL. A
   markdown transcript (speaker headings) is an ordinary AST document and has no derived tree.

2. **It is a separate tree beside the AST, not marked nodes inside it.** Its types live in a new
   contract file, `packages/core/src/contracts/derived.ts` (K-12 writes it), reusing the `Source`
   type from `ast.ts` and nothing else. A `DerivedNode` is not a `Node`, and `Node` gains no field.
   Why, weighed against the alternative (marked nodes, below under Rejected):
   - `AST_INVARIANTS` would need an exception for derived text ("…modulo escapes, unless
     derived"), and an invariant with an exception is weaker for every node, not only the derived
     ones. A separate tree leaves all six invariants exactly as they are.
   - The safety becomes structural. `OperationInput` takes a `Document` and an optional `Node`
     (`contracts/operation.ts`), so the type checker refuses to hand a derived node to an
     operation. With a flag, every operation's `canApply` would have to remember to check it, and
     the one that forgot would splice decoded text into a JSON string.
   - A tool call pairs a block on one line with a result on a later line, and lines of other
     records sit between them. In one tree with the AST's sibling rule ("ordered and
     non-overlapping") that pair cannot be one node.
   - A `.jsonl` file has no markdown AST today; putting turns "in the AST" would mean a `Document`
     whose children are not a document.
   - The 58 committed goldens and their serialiser do not move. The cost is a second invariant
     checker and golden serialiser for the derived tree, and adapters where the app reads nodes
     rather than DOM ranges; most of the app (selection, position, find) already works from the
     ranges ADR-0023 puts in the DOM, so the adapter is small.

3. **What a derived node is, and its provenance.** The tree's node types are `transcript` (the
   root), `turn` (a speaker's consecutive message: *you*, *agent*), `tool` (a call and its result
   as one unit), `thinking`, `derivedText` (a leaf holding decoded text), `unreadable` (a line
   that is not JSON) and `pending` (an unfinished last line). Every node carries:
   - `src: Source`, the hull of what it came from, in file bytes, so `src.start` is always a real
     offset at the start of a JSONL line or inside it;
   - `from: readonly Source[]`, the exact byte ranges it was derived from: for a `derivedText`
     leaf, the one JSON string token (quotes included) whose decoding is its value; for a `tool`,
     the call's object and the result's object; for a `turn`, the hull of each line it groups;
   - a `derivedText` leaf also carries `value: string`, `decoding: 'json-string'` and
     `syntax: 'markdown' | 'plain'`.

   **The invariant that replaces `value === bytes`** for a derived leaf is exact, not "modulo":
   *its value is the declared decoding of its bytes*, `JSON.parse(utf8(bytes[src.start, src.end)))
   === value` for `json-string`. Nothing else about the text is promised to be in the file, and
   nothing in the file is promised to be visible except what the accounting rule (item 7) lists.

4. **The derived invariants.** `derived.ts` exports `DERIVED_INVARIANTS` beside `AST_INVARIANTS`,
   asserted by a `checkDerivedInvariants(tree, bytes)` that every gate deriving a tree runs:
   1. `src.start <= src.end` for every derived node, and `transcript.src` covers `[0, byteLength)`;
   2. a node's `from` ranges are non-empty, ordered, non-overlapping, and `src` is their hull;
   3. a child's `from` ranges are contained in its parent's `from` ranges;
   4. the `from` ranges of the tree's leaves are pairwise disjoint (two nodes may come from one
      line, never from the same bytes);
   5. a `derivedText` leaf's value is the declared decoding of `bytes[src.start, src.end)` (item 3);
   6. a `derivedText` with `syntax: 'markdown'` is parsed by the ordinary parser over its own value
      into an inner `Document`, and that inner document satisfies `AST_INVARIANTS` verbatim against
      the UTF-8 bytes of the value (its offsets index the derived text, never the file);
   7. **accounting:** every line of the file is the source of at least one leaf, or appears once in
      the tree's `dropped` list with its record type, or is the one `pending` last line.

5. **Selection, Copy and Jump to source.** The derived view is what Rendered (Read) is for this
   kind; it adds no third mode, and `⌘E` toggles to Source as ever (ADR-0005). The default mode for
   a `.jsonl` stays as ADR-0060 sets it (Source, unless the reader's rule says Read).
   - **Selection** resolves to derived nodes. The selection-kind table in
     `docs/design/03-selection-and-operations.md` gains `turn` and `tool`, and a drag inside a
     derived view is `derived-text`, a kind of its own, so no `COPY_DEFAULT` entry written for a
     markdown drag can apply to it by accident. These are new selection granularities, which is why
     ADR-0045 item 4 asks for this record.
   - **Copy** (`⌘C`) copies the derived text, because that is what the reader is reading: a turn
     copies its text without the label (`copy-turn`), a tool unit copies its full output
     (`copy-tool-output`), even when the view shows only its head and tail, and a drag copies what
     it covers as displayed, labels included only if the drag covered them, and an omission line
     ("… 192 lines omitted") as that text. One pasteboard item carries the plain and the HTML
     representations of the same text (ADR-0065 item 2); the *Copy as* targets apply to it.
   - **The source bytes are a second verb, not a second representation.** `⇧⌘C` copies the exact
     bytes of the whole JSONL lines the selection came from, as ADR-0054 item 4 has it copy the
     exact source of a markdown block. Putting the JSON line into the same pasteboard item as the
     text would make the paste depend on the receiving app, which is a surprise, not a convenience.
   - **Jump to source** opens Source with the selected node's range selected: a leaf lands on its
     JSON string token, a turn or tool on the hull of its lines. Character-exact landing inside a
     string is possible later (a JSON string's escapes map decoded offsets to raw ones one for one)
     and is not required by this record.
   - **Reading position** needs no change: `ReadingPosition.byteOffset` is the first visible
     block's `src.start` (ADR-0018), and a derived row's `src.start` is a file offset, so toggling
     to Source lands on the same line.

6. **No operation edits a derived range, and the verb menu offers only what reads.** A
   transformation (ADR-0004) replaces bytes with the result of a pure function of those bytes. On a
   derived node the reader sees decoded text, so an operation run on what they see produces text
   that is not valid inside the JSON string it came from; writing it back would mean re-encoding
   and re-serialising, which ADR-0003 forbids ("nothing re-serialises the document"). A session
   log is also written and appended by the tool that owns it; editing it is not reading it.
   So:
   - on a `turn`, `tool`, `derivedText` or `derived-text` selection the verb menu offers Copy,
     *Copy as*, Copy source lines (`⇧⌘C`), `copy-turn`, `copy-tool-output`, `copy-user-prompts`
     (document), Jump to source, and the view's own Expand or Collapse; never a splice;
   - *Transform* (ADR-0065) may run on derived text with its result to the sheet or the clipboard;
     the sheet offers no Replace there;
   - Source for one block (ADR-0048) is not offered on a derived node; Jump to source is;
   - the file stays editable in whole-document Source, an ordinary editor over its bytes, and the
     tree is derived again from whatever the bytes become.

   **The fidelity property still holds** because nothing derived reaches a splice. `pnpm
   gate:fidelity` keeps covering every operation and the save path; the derived view adds no write
   path for it to cover. K-12 adds two checks that fail if this breaks: a type-level assertion in
   `contracts.test.ts` that `DerivedNode` is not assignable to `Node`, and a dispatch test that no
   registered operation's `canApply` is called with a derived selection.

7. **Nothing hidden silently (commitment 4).** A derived view reshapes more than anything else in
   Rendered, so it says so in the column, as text, not as chrome:
   - the column opens with one quiet line in the dek style, for example *Derived from 941 lines of
     JSONL · 438 not shown · Source ⌘E*; the count of lines not shown unfolds into the `dropped`
     list by record type, each a Jump to source;
   - every derived element carries ADR-0023's provenance attributes from its node's `src` (the
     nonce scheme unchanged), and the view's root carries `data-marxy-derived` (registered in
     `scripts/registry.json` by K-12 before use). An inner markdown document's elements carry *no*
     file provenance: its offsets index the derived text, so they are dropped at render and
     `closest('[data-marxy-s]')` resolves to the enclosing derived leaf. A derived-text offset can
     never be mistaken for a file offset;
   - **invisible and bidirectional characters stay visible.** Decoding turns `‮` (spelled
     out, harmless in Source) into a live right-to-left override, and `​` into a zero-width
     space. Decoded text goes through the same invisibles pass as markdown text
     (`packages/core/src/render/invisibles.ts`, MARXY-236), so each shows as its marker, in the
     prose and in code alike, and copy follows the same rule as markdown copy. A lone surrogate
     (`\ud800`) shows as a marked replacement character; an escape `\u001b` in tool output shows as
     a visible ␛, never interpreted; decoding drops no character;
   - a line that is not JSON is an `unreadable` row showing the line's own bytes in the code face,
     marked; a record type the deriver does not know is dropped and counted, never an error (the
     schema is undocumented and changes with the tool); an unfinished last line (no newline, not
     yet valid JSON, as when the tool is still writing) is one `pending` row saying so, not an error;
   - session metadata (ids, model, cost, per-event timestamps) is not shown (`04-capture.md`); it is
     part of lines whose text is shown, the header line says the view is derived, and Source shows
     it one key away.

8. **Fast and append-aware.** JSONL lines are independent, so `derive` runs line by line: the first
   screen of turns needs only the first lines (commitment 5), and an appended file (the common case,
   `04-capture.md`) derives only its new lines and extends the tree. Grouping a turn across lines
   never needs to look ahead past the next line that starts a different turn.

9. **What `AST_INVARIANTS` and the goldens gain.** `AST_INVARIANTS` gains nothing and loses
   nothing: the AST contract is not touched by this record or by K-12. The gain is beside it:
   - `DERIVED_INVARIANTS` (item 4), checked like `AST_INVARIANTS`, by `pnpm gate:golden`;
   - JSONL fixtures in `fixtures/corpus/`: a real-shaped, anonymised session; one with unreadable
     lines, unknown record types, `‮` and `​` escapes, a lone surrogate and an ANSI
     escape; a turn spread over several lines; an interleaved tool call and result; and a file
     whose last line is unfinished;
   - beside each, `packages/core/goldens/<fixture>.derived.txt` (one line per derived node: type,
     `src`, `from`, decoding, syntax, and the `dropped` counts) and `<fixture>.derived.html.txt`
     (the sanitised render), so a deriver change that moves what a reader sees is a diff in review.
   The existing goldens do not move.

10. **The scope of the mechanism.** Another deriver (a notebook, JSON log lines) is a story under
    this record if it uses an existing decoding (`json-string`) and the same node types. A new
    decoding, a new derived node type, or any derived node that could be edited is a change of
    meaning and needs an ADR (ADR-0045 item 4).

## Consequences

- K-12 builds it: `contracts/derived.ts` with the types and `DERIVED_INVARIANTS`, the
  `jsonl-transcript` deriver and its checker in core, the fixtures and goldens of item 9, the view,
  the selection kinds and verbs of items 5 and 6, and the two checks of item 6. It does not touch
  `contracts/ast.ts`.
- `docs/design/03-selection-and-operations.md` gains the `turn`, `tool` and `derived-text` rows when
  K-12 lands.
- The speaker labels, the tool-output bound (the handbook's first 10 and last 10 lines past 30 is
  judgement) and which speaker's text is `markdown` and which `plain` are taste, set by K-12 and its
  review. The starting point: agent text `markdown`, a user prompt `plain` with its line breaks kept
  (it was typed, not authored), tool output `plain` in the code face.
- The research ledger records P10 as decided here and still unbuilt.

## Rejected

- **Marked nodes in the AST** (`derived: true` on `Node`, or new `turn` and `tool` members of
  `BlockType`). Weakens `TEXT_DECODES` for every node, cannot hold a tool pair under the sibling
  rule, widens every exhaustive switch over `Node` (renderer, outline, find, typesetting), and makes
  "never splice a derived range" a check each operation must remember instead of a type error.
- **A derived markdown buffer** (the handbook's `derive-transcript` operation: render the JSONL to a
  markdown-shaped text with a line table, then parse that as a document). Its AST would be honest
  about the derived buffer and dishonest about the file: every range would index text that exists
  nowhere on disk, and the line table would be a second, hand-kept source map. The separate tree
  keeps the file as the coordinate system and uses an inner `Document` only for markdown inside one
  leaf (item 4.6).
- **Copy the JSON line as a second representation of every copy.** See item 5: the paste would
  depend on the receiving app.
- **Make the derived view the default for `.jsonl`.** The file is JSONL; Source shows what it is.
  ADR-0060 and the reader's rule decide when it opens in Read.
- **Hide what is not conversation without saying so.** Breaks commitment 4; the header line and
  the `dropped` list exist for it.

## How we would know this was wrong

1. **Readers prefer Source for transcripts** (P10's falsifier). There is no telemetry, so the
   evidence is the taste review after K-12 and the author's own use: if a session is read by
   toggling to Source and staying there, the derived view is not worth its machinery, and the
   kind should open Source with a plain JSONL profile instead.
2. **The derived text says something the file does not.** Any case where a `derivedText` value is
   not the declared decoding of its bytes, or a line is neither shown, dropped-and-counted nor
   pending, is a bug against items 3 and 4.7; the derived goldens should have caught it, so it also
   means a fixture is missing.
3. **A splice reaches derived bytes.** If any path ever writes decoded text into the file, the type
   boundary of item 2 leaked; the answer is a test at that path, not a flag.
4. **The separate tree costs more than it saves.** If K-12 finds itself duplicating selection,
   find, outline and position wholesale rather than adapting them through the DOM ranges, the
   trade in item 2 was mispriced and marked nodes should be weighed again, in a new record.
