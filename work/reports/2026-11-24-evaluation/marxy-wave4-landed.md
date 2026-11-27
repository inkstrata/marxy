# Marxy wave 4: landed

26 November 2026. On your "merge when finished", master was fast-forwarded from `b0d9cb52` to `663a7f7f`. Five branches, each reviewed by a different model from its builder (the footnote branch by two), fixed where the reviews found something, merged, and verified in full on the exact tip that landed: 18 of 18 steps green, browser 2,536 with none failing.

## What changes for the reader

- **Pages with footnotes update in place.** An edit, undo or reload on a page with footnotes replaces only the blocks it touched, as long as the edit does not renumber the notes; the list at the end redraws only the notes whose text changed. On the 195 KB reference (30 footnotes), a one-line reload replaces 31 top-level blocks instead of 2,465 and takes 0.48 s instead of 3.0 s. Large files with footnotes now also open in slices, like other large files.
- **Small pages update in place too.** The 64 KB floor below which every change rebuilt the page is gone. On the 25 KB demo document, an undo replaces 7 blocks instead of 198 and takes 87 ms instead of 229 ms, and the paragraphs that did not change keep their set type.
- **Coming back to a tab reuses what is open.** The last three clean documents are kept in memory, so a tab switch or Back reads, decodes and parses nothing, and undo history survives the switch. On returning, the file's size and times are checked, so a change made on disk while the tab was away is read again. Documents with unsaved edits are never kept. On the 195 KB reference, the page shows in 349 ms instead of 598 ms.
- **The page's own upkeep does less.** Tearing down a page no longer undoes its typesetting first; a typesetting pass re-pads only the blocks it set; the reading position is found without copying the block list; the spine writes its styles only when they change.
- **Folder watching skips ignored folders.** Build output hidden from the index by `.gitignore`, `.ignore` or a deny rule is no longer watched, rescanned or counted toward the 200,000-file limit. In the test folder, the watched files fell from 54 to 4.

Two bugs found along the way are fixed: a note opened under its line kept its old text after the note changed, and a heading inside a footnote could keep a stale link target.

## Numbers before and after

Measured back to back on the same machine today, master `b0d9cb52` against `663a7f7f`:

| Interaction | master | wave 4 |
| --- | --- | --- |
| Reload, 195 KB with footnotes: blocks replaced | 2,465 | 31 |
| Reload, 195 KB with footnotes: layouts | 489 | 82 |
| Reload, 195 KB with footnotes: main-thread time | 3.0 s | 0.48 s |
| Undo, 195 KB with footnotes: blocks replaced | 2,463 (wave 3 record) | 33 |
| Undo, 25 KB: blocks replaced | 198 | 7 |
| Undo, 25 KB: main-thread time | 229 ms | 87 ms |
| Tab back, 195 KB: shown | 598 ms | 349 ms |
| Tab back, 25 KB: shown | 177 ms | 135 ms |
| Open, 195 KB with footnotes: layouts | 355 | 353 |

The 30 blocks left on the footnoted page are the margin-note copies, which an idle pass takes out and puts back after any change; a later branch can place only the notes that changed.

Today's master run failed on the footnoted page's undo and its Source-to-Read row is not usable (10 layouts against 60 in both earlier records of the same code); wave 4 measured 59 there, as before. Opening the long pages measured 5 to 10% more style recalculations on wave 4, within the drift seen between runs of identical code (13 to 20%).

## What came up in verification

- The integration's first full verify found three real failures, each fixed on its branch: a test double without a file-stat call made opens fail after the tab-return check was added (a real bug in the review's own fix); a test expected an old document's previous version to vanish when it is now kept warm (test changed, property kept); and a source-scanning test could not read the typesetter's options any more (test changed).
- Two earlier failures were tests that pinned whole-page rebuilds that are no longer needed: the selection-after-a-failed-render test and the reload-behind-Source test.

## Experiment X10

Below 64 KB, updating in place costs less than rebuilding (25 KB undo 90 ms against 289 ms) and keeps every unchanged paragraph set. That decided removing the floor. Report: `C:\Dev\reader\work\experiments\X10-small-splice\report.md`.

## Not verified

- Nothing has been tried in an installed build beyond the automated real-window checks (117 pass).
- Symlink cases are skipped on this machine; junction cases ran.
- Durations were taken with other work on the machine; counts are firmer.

## For later

- One part of `typeset-view` (patching the block list instead of rebuilding it) is correct but runs in about half the cases and saves only cheap reads; its reviewer suggests dropping it unless a measurement shows the rebuild costing whole milliseconds.
- Back after a link opened in the same tab, and a find-and-replace across files, lose a warm document.
- A build folder created after a folder was scanned stays watched until the next scan; the first scan of a folder is still whole.
- The margin-note pass rebuilds every note copy after any change.
- A footnote referenced twice gives both references the same link id (as before).
- The measuring tool ignores `--docs` and has no Source-to-Read-after-an-edit step.
- Next in the plan: `geometry-table` (Opus), then typesetting near the reader; X2 is waiting on its experiment.
