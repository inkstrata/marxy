# ADR-0018 — Reading position is a source-map coordinate, never a scroll offset

**Status:** accepted

## Decision
A reading position is `{ path, byteOffset, fraction }`: the first visible block's start offset
and how far through it the viewport top sits. It is persisted per file (debounced), restored on
open, preserved across live-reload after an external write, across Rendered ↔ Source switches,
and across theme, size and measure changes.

## Why
Line boxes change with mode, theme, size and measure; a scroll offset is meaningless across
any of them. Agent artifacts are rewritten constantly; "the file changed and I did not lose my
place" is the defining interaction for that content type. Watching must handle atomic
write-temp-then-rename, delete and move; watch the directory, not the inode.
