---
key: MARXY-251
design: [08-position-and-watching, 06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-251]
---
# MARXY-251 — Event-driven watching, and edits through a symlink

**Design:** [08-position-and-watching](../../design/08-position-and-watching.md) · [06-shell](../../design/06-shell.md) · **ADR:** ADR-0006 (licences) · **Delta:** [2026-09-27-seams](../deltas/2026-09-27-seams.md)

**Outcome.** An edit made by another tool shows up whether the reader opened the file or a link to it, and an idle Marxy does no work.

## What is wrong today
`watch/mod.rs` scans the open document's directory tree every 50 ms, recursively, one thread per root, and `DirEntry::metadata` does not follow symlinks, so a link is dropped. [h3-symlink-watch.patch.txt](../deltas/evidence/2026-09-27-seams/h3-symlink-watch.patch.txt) adds the failing test (`events: []`, effect `Ignore`).

## Do this, in order
1. Land the test from the patch; show it failing.
2. `notify` (check each crate@version's licence; record them in `crate-licences.json`). Watch the directory non-recursively, plus the target's directory when the document is a link.
3. Keep `diff`/`effect_for_open_document` and their tests; replace only the source of events.

## Tests → expected
| Check | Expect |
| --- | --- |
| write the target of a watched link | Reload |
| write two directories down | no event |
