# Marxy wave 3: ready to land

25 November 2026. Integration branch `agent/wave3`, tip `b0d9cb52`, cut from master `84a815dd`. Seven branches, each built, reviewed by a different model, fixed where the review found something, and verified. Full verify green apart from one load flake; master has not moved and waits on your word.

The plan changed today: the skipped-layout experiment says no-go as built. That is the second section.

## What changes for the reader

- **Undo, redo, a ticked checkbox and a Source commit** on a long page replace only the blocks that changed, where before they rebuilt and re-typeset the whole page. On the 195 KB reference without footnotes, undo now replaces 3 top-level blocks instead of 2,513 and takes 0.35 s of main-thread time instead of 2.8 s. On a page with footnotes nothing changes yet: the in-place update still refuses footnotes until the footnote step.
- **Back from Source to Read** after typing does the same: the edited blocks are replaced, the rest of the page and its set type are kept.
- **Code, formulas and diagrams** drawn once are reused by their text, in Read and Source alike. Reopening a closed tab sends 2 code blocks to the colouring worker instead of 143.
- **Content search** spreads over up to 8 threads and reads each file once: a rare word over this repository's 1,943 files took 386 ms and now takes 44 ms (taken while builders ran; information only). Results are identical, same order and limits. On Windows each file is now judged by the handle actually opened, the same check the file reader uses.
- **Watching folders** lists each folder once on Windows instead of opening every file: scanning 2,484 files went from 85-111 ms to 18-22 ms (debug build).
- **The path check** behind every file command keeps its allowed places as hash sets instead of rebuilding a list on every call; its cost no longer grows with the number of files opened.
- **`pnpm verify`** takes one of two machine-wide places for its heavy steps, so builders sharing the machine wait their turn instead of starving each other's browser tests.

Two bugs that were already on master are fixed along the way:

- With two panes open, a notice from the other pane (an image over plain http) was shown in the focused pane after a reload.
- Changing text size, theme or typesetting while Source showed left Read in the old size or face when it came back.

## The plan changed: skipped layout is no-go as built

The experiment measured four variants on the 195 KB, 25 KB and 1 MB documents. With everything in place, the work from opening the 195 KB page until it settles fell to 12% of today's (576 ms against 4,977 ms), but three of the four go conditions failed:

| Condition | Limit | Measured |
| --- | --- | --- |
| Work to settle, 195 KB, against today | a third or less | 12%: met |
| A typesetting slice on 1 MB against 25 KB | at most 2x | 3.5x |
| Places in the code that read into skipped blocks | at most 15 | 22 |
| What the reader sees | nothing a clip margin cannot fix | block quotes half a line taller, tables a line shorter, margin notes moved |

Bounding the typesetting queue alone gave 83% of the gain, so the order changes: typesetting near the reader is built first, and skipped layout moves to after everything else, to be tried again once the table of block positions has removed the reads. One new finding the plan did not cover: on a 1 MB page, 47% of the time to open is the progressive mount forcing a layout once per chunk. It is a candidate branch of its own.

Report: `C:\Dev\reader\work\experiments\X1-skipped-layout\report.md`. Its branch and worktree stay until you have seen this.

## Numbers before and after

Against the wave 2 record, taken on master `84a815dd`:

| 195 KB reference, no footnotes | wave 2 | wave 3 |
| --- | --- | --- |
| undo: top-level blocks replaced | 2,513 | 3 |
| undo: layouts | 422 | 72 |
| undo: style recalculations | 719 | 82 |
| undo: main-thread time | 2.8 s | 0.35 s |
| reload of one line | 2 blocks, 0.30 s | 2 blocks, 0.30 s |

Opening the long pages showed more layouts than the wave 2 record (342 to 414 on the footnoted page). Master re-measured today on the same machine, twice, already sits 13-15% above that record, and tab-back on identical code varies by 20% between runs, so most of it is the machine. On opening the footnoted page wave 3 still measured about 10% above today's master (431 layouts against 386 and 392). That may be real and is not settled. Node counts are identical.

## Verification

- Full verify on `e2deff56`: 17 of 18 steps green. Rust 637, real-window checks 117, release build, core 4,238, typeset 90, scripts 289, desktop 1,258, browser 2,513 pass with 2 fail.
- Of the two browser reds, `split-narrow` passes alone (load, as on wave 2). `mode-swap` failed alone too: the test still expected a whole rebuild after a reload behind Source, and the in-place update was correct. The test was changed, not the code. The tip `b0d9cb52` differs from the full-verify tip by that test file only, and both files pass on it, 43 of 43.
- Each branch's review tried deliberately broken versions of the change; every one was caught by a test after the reviews' fixes. Reports and reviews: `C:\Dev\reader\work\wave3\<branch>\`.

## Not verified

- Nothing has been seen in an installed build or the real window beyond the automated real-window checks.
- Symlink cases are skipped on this machine (no Developer Mode); junction cases ran.
- Going back from Source to Read has no timing: the measuring tool's Source-to-Read step makes no edit.
- Durations were taken with builders running; counts are firmer.

## For later

- Two edits far apart still replace everything between them (the in-place update makes one cut).
- The measuring tool ignores `--docs` and needs a Source-to-Read-after-an-edit step.
- Content search can hold the hits of files read ahead of a slow early file without a bound.
- Search index rows can be stale while another program holds a file open for writing and no change event arrives.
- A diagram measured before its font loads keeps those widths while it stays cached.
