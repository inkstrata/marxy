# Wave 2 is verified and ready to land

`agent/wave2` at `84a815dd` holds master `978b8251` plus `typeset-waste` and `definitions-index`. Both merged without conflict, the full verify is green apart from one test that failed under load, and the measured numbers show the typesetter's change. Master has not moved. To land it, master is fast-forwarded to `84a815dd`, which needs your yes.

## What changed for the reader

- **Opening a long page does less wasted typesetter work.** The typesetter no longer measures every paragraph to find the ones on screen. It no longer reverts set paragraphs on a page that is about to be thrown away. And it no longer asks for a grid pass over the whole page when no line moved. Every paragraph still ends up set exactly as before.
- **A reload of a file that has footnotes or link definitions now parses only the changed region.** Before, one such definition anywhere in the file made every reload re-parse the whole file. On the 195 KB reference, parsing a one-line reload took 144 ms before and 1.3 ms now. The page itself is still rebuilt in full after such a reload. Fixing that is a later step, outside this wave.

## Numbers, 195 KB reference document (30 footnotes)

These were measured on a quiet machine, against the wave 1 record taken on master `978b8251`. Counts are the reliable column; durations move by tens of percent between runs.

| Action | Measure | Master | Wave 2 |
| --- | --- | --- | --- |
| Open | layouts | 396 | 342 |
| Open | style recalculations | 675 | 583 |
| Open | main-thread task time | 1,990 ms | 1,756 ms |
| Open | until idle | 2,316 ms | 1,977 ms |
| Undo | style recalculations | 865 | 761 |
| Undo | task time | 3,227 ms | 3,037 ms |
| Reload one line | top-level blocks replaced | 2,465 | 2,465 |
| Reload one line | longest task | 615 ms | 224 ms |
| Tab back | layouts | 515 | 450 |
| Tab back | task time | 3,208 ms | 2,717 ms |
| Cursor key, first click | all counts | unchanged | unchanged |

The same document without its definitions, on undo: 822 to 719 style recalculations and 3.7 s to 2.8 s. The 25 KB short document is unchanged within noise. A few small durations went up with identical counts, for example Source view at 111 to 185 ms. Those changes match the run-to-run spread, not anything either branch touches.

Full record: `work\wave2\interactions-wave2-84a815dd.json`; comparison log: `work\wave2\measure-wave2.log`.

## Verify

`pnpm verify --tier full` on `84a815dd` passed 17 of 18 steps:

| Step | Result |
| --- | --- |
| typecheck, lint, check (10/10), golden, fidelity, licences | pass |
| core | 4,238 pass |
| typeset | 90 pass |
| desktop unit | 1,256 pass |
| scripts | 281 pass |
| cargo | 624 pass |
| Tauri (built exe) | 117 pass |
| browser | 2,503 pass, 1 fail |

The browser failure is in `split-narrow.test.mjs`: a Source pane given back came up in Read mode. Run on its own, the file passed 16 of 16 in each of five runs, so the failure was load. Neither branch touches the split panes.

## Reviews

- `typeset-waste`: built by Sonnet and reviewed by Opus. It was ready after the reviewer's fix, which covers margin notes and the kill switch. Six mutations were each caught by a test.
- `definitions-index`: built by Opus, reviewed by Sonnet and then by a fresh Opus reviewer told to break it. Its adversarial search ran about 234,000 edits with 0 mismatches. The same search finds thousands of mismatches when the new seeding is turned off.

## Not verified

- Nothing in this wave was seen in an installed build or a real window. The measurements come from the measuring tool in headless Edge.
- The view does not yet use the typesetter's new options: the discard-on-destroy option and the list of paragraphs a pass set. The view's follow-up step makes it use them.
- The sliced parse used for opening big files still parses whole when a file may hold a definition. The plan expected this wave to fix that, and it did not.
