# Taste review

The human half of verification (ADR-0016). The reviewer works through the queue at the end of
each phase and records decisions in a dated folder (`2026-xx-review-N/decisions.md`). Nobody
asks "does this look right?" mid-task.

Queue entries are **optional**; nothing requires one. When an author has something a reader would
notice, the entry is its own file, `docs/taste-review/queue.d/KEY.md`, holding one queue table
row (see `queue.d/README.md`). `node scripts/taste-queue.mjs --fold` appends every such row to
`queue.md` and deletes the fragments. The human review itself remains.

Each queue entry: date, PR, what changed for the reader, the artifact paths (before/after,
side-by-side), and the specific question for the reviewer.
