# Taste-review queue fragments

A taste-review entry is **voluntary**. Nothing requires one: no gate, merge-bar clause, review
verdict or PR checklist fails for lacking it. Add one when you have something a reader would
notice and a question worth a reviewer's time. Pull requests used to add their row to the same
table in `docs/taste-review/queue.md`, so they conflicted there; one file per story cannot.

## The rule

An entry is a file named after its story key: `docs/taste-review/queue.d/MARXY-123.md`. The file
holds exactly **one line**, a queue table row for that key with the same six columns as
`queue.md`, and its second cell is exactly the key.

```
| 2026-09-29 | MARXY-123 | What the reader would notice | Artifacts | Question for the reviewer | |
```

Leave Decision empty; the reviewer fills it in. Do not add a header, a separator row or more than
one line, and do not touch anyone else's fragment or `queue.md` itself.

## Folding

`node scripts/taste-queue.mjs --fold` appends every fragment's row to `queue.md`'s table in key
order and deletes the fragments it folded in. It touches no other byte of `queue.md`.

## The shared helper

`scripts/lib/taste-queue.mjs` is the one place that knows the format (`queueFragmentPath`,
`validQueueFragment`, `isQueueFragmentPath`, `foldRows`).
