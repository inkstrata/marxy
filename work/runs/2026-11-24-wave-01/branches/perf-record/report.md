# perf-record report

Commits (branch agent/perf-record):
- 40d36308 feat(perf): measure-interactions records what the reader feels on a long page
- 9bed3e34 feat(perf): measure a long page whose definitions are escaped, and any file given with --doc

What changed for the reader: nothing. New: scripts/measure-interactions.mjs, scripts/lib/interactions-record.mjs (record, medians, comparison, tables, neutraliseDefinitions), scripts/measure-interactions.test.mjs, package script `perf:interactions`, entries in scripts/README.md and docs/testing.md (section "Interactions, before and after a change"; says launch time is measure-startup.mjs's job).

Run:  node scripts/measure-interactions.mjs --record <path>        (or pnpm perf:interactions ...)
Compare to a record:  node scripts/measure-interactions.mjs --compare <record>
Two saved records, nothing run:  node scripts/measure-interactions.mjs --compare a.json --against b.json
Options: --runs N (3), --keys N (20), --docs long-reference,long-reference-plain,short-document, --doc <path> (repeatable), --browser. About 10 minutes. Exit non-zero only when a requested number could not be taken.

Saved record: C:\Dev\reader\work\wave1\interactions-master-17cfe661.json (code = master 17cfe661 plus the tool; the record's commit field reads 9bed3e34; 3 runs, 20 keys, msedge 158, quiet machine).

Measured on master vs expectation (long-reference / plain / short):
- cursor key: 67 ms (exp 40-110); short 13.5 ms handler, 14 ms task (exp under 10: slightly over; the number is a message-hop after keydown, includes 4 layouts per key). Counts: 4 layouts, 5 recalcs.
- first click: handler 185 ms, task 390 ms (exp 166-250 handler: matches).
- undo: long 8.7 s task, replacedTop 2733 (exp 4-5 s, ~2,700 nodes); plain 6.4 s, replacedTop 2513 (exp 3-5 s, whole page). Task time runs to the page going quiet, so it exceeds the time to show.
- reload: long 8.2 s, replacedTop 2765; plain 0.74 s, replacedTop 0 (exp ~0.8 s, a few nodes: time matches; replacedTop counts removed top-level nodes only, an append removes none).
- tab switch to the long page: 0.84 s shown (exp 0.5), then 7.2 s of task time; away 0.3 s.
- Source to Read: long 0.44 s shown; short 60 ms.
- open: long 6.4 s task, 337 ms first content, 10,080 nodes; plain 2.4 s, 9,841 nodes.
Earlier busier-machine runs gave about 1.5x higher durations; counts were identical. Compare counts first.

Tests: scripts/measure-interactions.test.mjs 11 pass (record shape, medians, comparison, tables, args, --doc, neutralise over the real fixture: 30 definitions to 0). readme-index 7 pass. typecheck, lint, pnpm check (10/10) green on the tip.
Verify turn (first commit): 12/13 green; unit-core red on notebook.test.ts "10 MB notebook" wall-clock assertion (1656 ms) under load; passes alone (19/19). Not rerun after the second commit (scripts and docs only, per the coordinator).
Revert-and-fail: not applicable to the tool's pure parts beyond this: neutraliseDefinitions test failed while the replacement string was wrong (a lost backslash), passed once fixed. The browser measurement is not a repair and has no revert proof.

Calls made / not done: documents renamed long-reference and short-document; landing tab is fixtures/demo reading/on-the-measure.md (an identical landing page distorted first-content time). longestTaskMs sees tasks of 50 ms or more only; click handlerMs only handlers of 16 ms or more. Tab switch is measured away to the landing tab and back. Plain document measures open, undo, reload only. Not checked: Chrome or Chromium launch (msedge only tried).

## Orchestrator's notes for the reviewer

- The tool's durations run until the page is quiet, so they are larger than the evaluation's figures for the same actions (undo 8.7 s here against 4 to 5 s measured to the last long task). The counts agree (2,733 top-level nodes replaced by an undo). Check that the output says plainly what each duration covers, so a reader does not compare it with the evaluation's numbers.
- "Reload of one appended line: 0 nodes replaced" on the plain document, because the count is of removed top-level nodes and an append removes none. The number meant to show an in-place update should not read as zero for the most common case: count nodes added as well, or replaced-or-added, and say which.
- The record's commit field reads `9bed3e34` (the tool's branch), though the code measured is master `17cfe661` plus the tool. A baseline named for master should say what it measured: check how the record states this and whether `--compare` warns when the two records were taken on trees that differ only by the tool.
- A full run takes about ten minutes and durations moved by half again under load with identical counts: confirm the table leads with counts, and that the docs tell the reader to compare counts first.
- Only Edge was run.
