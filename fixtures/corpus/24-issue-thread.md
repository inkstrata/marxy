# Export drops the last row when the batch size divides the row count (#412)

**Issue** opened by **@mira-quill** on 2026-09-28 · labels: `bug`, `export`, `needs-triage` · milestone: `v2.7.0` · assignee: **@tobias-reen**

### Description

When I run `ledgerctl export --batch-size 500` on a table with exactly 1,500 rows, the output file has 1,499 data rows. The same command with `--batch-size 499` or `--batch-size 501` returns all 1,500. It looks like an off-by-one at the batch boundary, but I could not find it by reading `batcher.go`, so I am filing this instead of guessing.

This is a regression: `v2.5.3` does not do it. I bisected to the range `a41c9e2..3f8d07b` and stopped there because the range includes the batching rewrite from #377.

### Steps to reproduce

1. Create a table with exactly 1,500 rows:

   ```sh
   ledgerctl seed --rows 1500 --table demo_invoices
   ```

2. Export with a batch size that divides the row count:

   ```sh
   ledgerctl export --table demo_invoices --batch-size 500 --out demo.csv
   ```

3. Count the data rows (the file has a header line):

   ```sh
   tail -n +2 demo.csv | wc -l
   ```

4. Observe `1499`. Expected `1500`.

### Expected behaviour

Every row is written exactly once, whatever the batch size.

### Environment

| Item | Value |
| --- | --- |
| ledgerctl | 2.6.1 (commit `3f8d07b`) |
| OS | Debian 12, kernel 6.1 |
| Go | 1.23.4 |
| Database | Postgres 16.2 |
| Locale | `en_GB.UTF-8` |
| Terminal | 80x24, `TERM=xterm-256color` |

### Logs

<details><summary>Logs</summary>

```text
[2m2026-09-28T09:14:02Z[0m [32mINFO [0m export started table=demo_invoices batch_size=500
[2m2026-09-28T09:14:02Z[0m [32mINFO [0m batch 1 rows=500 offset=0
[2m2026-09-28T09:14:02Z[0m [32mINFO [0m batch 2 rows=500 offset=500
[2m2026-09-28T09:14:03Z[0m [32mINFO [0m batch 3 rows=499 offset=1000
[2m2026-09-28T09:14:03Z[0m [33mWARN [0m short final batch: expected 500 got 499
[2m2026-09-28T09:14:03Z[0m [31mERROR[0m [31mrow count mismatch: wrote=1499 table=1500[0m
[2m2026-09-28T09:14:03Z[0m [36mDEBUG[0m query="SELECT id, customer_id, amount_cents, currency, issued_at, due_at, status, memo FROM demo_invoices WHERE id > $1 ORDER BY id LIMIT $2" args=[1000, 500] plan="Limit (cost=0.28..41.05 rows=500 width=84) -> Index Scan using demo_invoices_pkey on demo_invoices (cost=0.28..122.19 rows=1500 width=84) Index Cond: (id > 1000)"
[2m2026-09-28T09:14:03Z[0m [36mDEBUG[0m detail="the planner chose an index scan because the predicate is selective and the table statistics are fresh, so no sort node was needed and the cursor was read from the final row of the previous batch before it was flushed to the output file the planner"
[2m2026-09-28T09:14:03Z[0m [32mINFO [0m export finished in 1.31s
```

</details>

### Checklist

- [x] I searched existing issues
- [x] I can reproduce on the latest release
- [ ] I can reproduce on `main`
- [ ] I have a failing test to attach

Reactions: 👍 3 · 🎉 1 · 👀 2

---

**@tobias-reen** commented on 2026-09-29:

Thanks @mira-quill, that is a clean report. I can reproduce it with your seed command on `main` too, so I have ticked that box for you. The log gives it away: batch 3 asks for `id > 1000` but the table's ids start at 1, so the cursor is one row ahead of where it should be. Looks like the rewrite in #377 switched from `OFFSET` to a keyset cursor and the cursor is advanced before the last row of the previous batch is flushed.

Reactions: 👍 1

---

**@mira-quill** commented on 2026-09-29:

> Looks like the rewrite in #377 switched from `OFFSET` to a keyset cursor and the cursor is advanced before the last row of the previous batch is flushed.

That matches what I saw when I printed the cursor. It is also why `--batch-size 499` works: the rows per batch never land on the flush boundary.

> Thanks @mira-quill, that is a clean report.
>
> > I can reproduce it with your seed command on `main` too

Glad it is not only me. See also #398, which might be the same cause for the JSON exporter.

Reactions: ❤️ 2

---

**@jun-halloran** commented on 2026-09-29:

Drive-by: I think #398 is a different bug. That one drops the *first* row of a batch when a row contains a literal newline, which is a quoting problem, not a cursor problem. Happy to be proven wrong.

cc @tobias-reen

---

**@mira-quill** commented on 2026-09-30:

For anyone who hits this before the fix ships, here is a workaround that costs nothing: pick a batch size that does not divide your row count. If you cannot know the count in advance, the default of 1,000 is as safe as any, because the bug needs the final batch to end exactly on the boundary.

Two caveats, since people will copy this:

- It is a workaround, not a fix. A table that later grows to a multiple of the batch size will hit it again.
- `--batch-size 1` avoids the cursor path entirely but is very slow (about 40 minutes for 100,000 rows on my laptop).

> If you cannot know the count in advance
>
> > use `SELECT count(*)` first and subtract one from the batch size if it divides evenly

That second quote is from a colleague's chat message, pasted with permission.

Reactions: 👍 5 · 😄 1 · 🚀 1

---

**@tobias-reen** commented on 2026-09-30:

Agreed with @jun-halloran, #398 is separate. I have a fix for this one. Opening a PR now.

---

## Pull request #415: Advance the export cursor after the batch is flushed

**@tobias-reen** opened this pull request on 2026-09-30 · base: `main` ← head: `fix/412-export-cursor` · fixes #412

### What this changes

The keyset cursor in `batcher.go` was updated when a row was read, not when it was written. When a batch ended exactly at the flush boundary, the next query started one row too late. The cursor now advances only after `flush()` returns.

### Checklist

- [x] Adds a regression test for batch sizes that divide the row count
- [x] Updates `CHANGELOG.md`
- [ ] Docs updated (no user-facing change)
- [x] `make check` passes locally

![build](https://example.invalid/badge/build-passing.svg)

<img width="600" alt="screenshot" src="https://example.invalid/shot.png">

### Review thread

**@priya-aldous** reviewed on 2026-09-30 and requested changes:

> Nice find. One small thing in `batcher.go`, and one nit in the test name.

In `batcher.go`, line 88:

```diff
-	b.cursor = row.ID
-	if err := b.flush(); err != nil {
+	if err := b.flush(); err != nil {
 		return err
 	}
+	b.cursor = row.ID
```

**@priya-aldous** commented on `batcher.go` line 91:

This reads better as a single helper, and it keeps the ordering rule in one place:

```suggestion
	if err := b.advance(row.ID); err != nil {
		return err
	}
```

**@tobias-reen** replied:

> This reads better as a single helper

Good idea, done in `c7d29aa`. I kept `advance` unexported so nothing outside the package can call it with a stale id.

**@priya-aldous** commented on `batcher_test.go` line 14:

Nit: `TestBatch` is too general to find later. Something like `TestBatchSizeDividesRowCount` says what the test is for.

**@tobias-reen** replied:

Renamed.

**@jun-halloran** commented on 2026-09-30:

Question, not a blocker: should `advance` also guard against an id that goes backwards? A keyset cursor that moves backwards would loop forever, and the loop would be silent.

- [x] Agreed it is worth a guard
- [ ] Agreed it belongs in this PR
- [ ] Agreed it needs its own issue

**@tobias-reen** replied:

My view is that it belongs in a separate change. This PR is a one-line ordering fix and I would like it to stay reviewable as one. I will open #417 for the guard and link it here.

**@jun-halloran** replied:

Fair. Resolving this thread.

### Checks

| Check | Status | Duration |
| --- | --- | --- |
| `build (linux-amd64)` | passed | 1m 42s |
| `build (darwin-arm64)` | passed | 2m 05s |
| `test` | passed | 3m 18s |
| `lint` | passed | 0m 44s |
| `changelog` | passed | 0m 03s |

**@priya-aldous** approved these changes on 2026-10-01.

---

### Commit message

The squash commit message, quoted from the merge dialog:

> fix(export): advance the cursor after the batch is flushed
>
> The keyset cursor moved when a row was read, so a batch that ended on
> the flush boundary skipped the next row. Move the update after flush()
> and add a regression test for batch sizes that divide the row count.
>
> Fixes #412
>
> Co-authored-by: Mira Quill <mira-quill@users.noreply.example.invalid>
> Co-authored-by: Priya Aldous <priya-aldous@users.noreply.example.invalid>

Merged via squash into `main` as `5be01f3` on 2026-10-01.
