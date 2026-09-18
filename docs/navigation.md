# Navigation, the index, watching

## Palette (ADR-0011)

The primary interface. No query: the most-recently-used stack, pinned on top. With a query:
fuzzy matches over path, title and headings of the current root, then recent roots, ranked
by match quality then frecency; heading hits jump to the heading. Keystroke to results under
16 ms. Back and forward over history with the standard keys. Operations applicable to the
current selection appear in a separate section.

## Index (ADR-0012)

Root = enclosing git repository, else the file's directory; twelve recent roots. Ignore rules
honoured; deny list; extension allow-list; 50,000-entry ceiling with a notice. Per entry:
path, title, headings, mtime, size, last-read, position. Persisted between launches and
invalidated by mtime on start; a stale index is worse than none. Never in front of first paint.

## Watching (ADR-0018)

Watch the root directory tree, debounced. On change to the open document: reparse,
re-render, keep the reading position. On change elsewhere: update the entry. Handle atomic
write-temp-then-rename (what agent tooling does), delete and move while open. Rust `notify`
behind `shell-api`.

## Within a document

Summoned outline tracking scroll; find landing at the reading position; keyboard-complete;
progress readout honest about length. "Open in external editor" is the pressure valve.
