# ADR-0003 — One buffer, one AST with byte provenance, two layout paths

**Status:** accepted

## Decision
The source text buffer is the only truth. One parse produces one AST in which **every node
carries `{ file, start, end }` byte offsets** (`packages/core/src/contracts/ast.ts`). Two
layout paths consume it: the typesetting path (Rendered) and the interactive path (Source,
CodeMirror 6). Rendered output is derived and never edited directly.

## Why
Provenance is the mechanism behind operations (ADR-0004), reading position (ADR-0018), find,
and the deferred composed-documents feature. Adding it later means reworking renderer and
editor together — the expensive kind of retrofit. Carrying it from the first commit costs a
field on a struct.

## Consequences
- The parser must preserve positions for every node including inline nodes; golden files
  assert the AST *and* the source map over the corpus.
- Byte fidelity is structural: nothing re-serialises the document. Smart typography (quotes,
  dashes, widont) is a render pass and never touches the buffer.
- No document model is ever authoritative (ProseMirror/Lexical-style models are rejected).
