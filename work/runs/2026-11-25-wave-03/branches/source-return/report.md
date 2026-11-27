# source-return: builder report (Sonnet)

Branch `agent/source-return`, based on `agent/splice-all` `9b097001`. Commit `9cbfa6ef` perf(view): showing Read after Source replaces the changed blocks.

Reader: typing in Source and switching back to Read replaces only the edited blocks; before, the whole page was rebuilt.

## How

- `rendered-view.ts`: `markStale(bytesOnly)` and a flag `staleByBytesOnly`, set only by a commit made while Source shows; cleared by a theme change, a trust change, an unmade page or a transcript load.
- `showRendered` calls a new `spliceStalePage()` when the flag is set: `splicePage` on the store's newest snapshot against the held render record (several hidden commits covered by one splice); falls back to `rerenderFromBuffer` on refusal. All splice refusals still apply, including the 64 KB floor. Writes `marxy:repaint` with how and why. The following `snap(doc)` untouched.
- `docs/architecture.md` step 7 updated.
- No code moved to a module: about 25 lines tied to the closure state, no clean cut.

## Test

New browser test in `apps/desktop/test/splice-all.test.mjs`: 400-paragraph document over 64 KB; to Source, two nearby edits, back to Read; requires `marxy:repaint` 'replaced', fewer than 10 top-level nodes added, every other top-level node keeps identity, set paragraphs keep `marxy-set`, both typed paragraphs show. Revert-and-fail: with the splice branch disabled the test fails. The byte-for-byte chain test covers the splice itself; "hide, several commits, show" is covered by the two-edit case, not a separate chain test.

splice-all file 5/5. Builder states verify turn all PASS (typecheck, lint, check 10/10, unit-desktop 1258/2 skip, browser unit 44/1 skip). Log `work\wave3\source-return-verify.log`.

## Measurement

The tool's Source-to-Read scenario edits nothing, so it cannot show this change. No `source-return-after.json`; node count from the test only; no TaskDuration.

## Call

Edits far apart (paragraphs 120 and 300) make the splice replace everything between them (181 nodes); `splice-all` has the same limit (one cut between common prefix and suffix).

## Orchestrator notes

- At the time of this report the verify log had no closing line and no `browser` step result (12 files): the builder reported before its verify turn ended. Review waits for the turn to finish.
- File: the measuring tool needs a Source-to-Read-after-an-edit scenario.
- The one-cut limit is worth noting for Ian: two edits far apart still replace everything between. A multi-range splice would be its own branch.
- Verify turn finished 15:51: changed against `agent/splice-all`, 10/10 (browser 72 pass, 12 files). Tree clean. Opus review started.
