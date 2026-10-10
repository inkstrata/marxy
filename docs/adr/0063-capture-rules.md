# ADR-0063 — Capture rules: a standing, declared request to copy files byte-exact into a reader folder

- **Status:** accepted (author, 2026-10-10)
- **Date:** 2026-10-10
- **Reads:** commitment 3 (faithful to the bytes) in `AGENTS.md` and ADR-0052.
- **Evidence:** [`docs/plan/direction-2026-10/04-capture.md`](../plan/direction-2026-10/04-capture.md).

## Context

Tools write what they do to the reader's disk, then prune or rewrite it. A reader who wants to keep
those files needs them copied to a folder they own. Commitment 3 says Marxy changes only the bytes
the reader asked to change; a capture rule writes reader documents with no action per write.

## Decision

1. **A capture rule is the reader's request,** written in their own `collection.toml` as
   `[[capture]] from = "<glob>" to = "<folder>"`. Marxy ships no rule.
2. **Copies are byte-exact.** No conversion, renaming, annotation or added metadata.
3. **Nothing in `from` is ever written, and nothing in `to` is ever deleted.**
4. **A reader's edit is never lost.** An appended source extends its copy only while the copy is an
   exact prefix of it; a regenerated source replaces its copy only while the copy equals the bytes
   Marxy last captured. Otherwise the new version is written beside, as `name (2).ext`.
5. **It runs while Marxy runs,** and once at launch to catch up. The `to` folder joins the collection.
6. **Nothing leaves the machine.** The Privacy page names the whole action: "Marxy copies files
   matching your capture rules from `from` to `to` on this disk, while it is running."

## Consequences

- Commitment 3 is read as: Marxy writes reader documents only on a reader action or on a standing
  rule the reader wrote, and never edits an existing reader document without one.
- Phase P builds it (P-03), after append-aware live files (P-01).

## How we would know this was wrong

A capture rule loses a reader's edit, or a reader is surprised to find files in `to`: the first is
a bug against item 4, the second means the rule needs to be visible where it acts.
