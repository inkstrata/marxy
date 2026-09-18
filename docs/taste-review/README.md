# Taste review

The human half of verification (ADR-0016). Agents append artifacts to `queue.md` as they work;
the reviewer works through the queue at the end of each phase and records decisions in a dated
folder (`2026-xx-review-N/decisions.md`). Nobody asks "does this look right?" mid-task.

Each queue entry: date, PR, what changed for the reader, the artifact paths (before/after,
side-by-side), and the specific question for the reviewer.
