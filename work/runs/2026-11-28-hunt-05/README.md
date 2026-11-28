# Hunt 05

Goal: owner asked for a bug sweep. Small shape: the three unrun axes of hunt 04 (TWO, SCH, PRS), Sonnet catchers, one round, no planner. WKT left out (needs WebKit on a Mac).

## Round 1

Catchers: TWO (5 findings), SCH (3), PRS (4), all Sonnet at medium effort; none ran out of budget. Verified by four Sonnet verifiers (batches A to D). 12 findings: 9 confirmed, 1 duplicate, 2 not reproduced. Rows made: B36 (S1, three findings), B37 to B41 (S2), B42 (S3). Stopped after one round (small shape).

| Axis | Round | Findings | Confirmed | Alone | Shared | Dup. of another axis | Not reproduced | Precision | Rows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRS | 1 | 4 | 4 | 4 | 0 | 0 | 0 | 100% | B36, B41 |
| TWO | 1 | 5 | 4 | 3 | 1 | 0 | 1 | 80% | B37 to B40 |
| SCH | 1 | 3 | 1 | 1 | 0 | 1 | 1 | 33% | B42 |

## For the next hunt

- **Extend**: PRS found four bugs alone; run it on the callers left in the triage's "Not reached" (`commands/transform.ts`, `commands/copy-as.ts`, the palette's own cost) and on any other whole-text scan keyed by distinct values (`linesNaming`'s shape). TWO: the open path with tab switch and Back while a parse runs.
- **Drop**: SCH's priority-lane lens (the highlighter is a worker; the lanes beyond `input` are unused on the main thread).
- **Converged**: nothing yet; `scheduler/index.ts` and `parse-worker.ts` abort paths were found clean by SCH and TWO.
