# Hunt 03 triage

Every finding's outcome. Rows are in `../../todo.md`, section **Big files** (ids `L<n>`: hunt 01's and hunt 02's `B` rows were being numbered on their own branches while this hunt ran,
so this hunt took its own letter). Severity is the
verifier's where it differs from the catcher's: most came down, because the catchers timed by the wall clock on a
machine whose load average stood at 30 to 120, and the verifiers measured CPU or the browser's task time.

| Id | Title (short) | Catcher | Verdict | Outcome |
| --- | --- | --- | --- | --- |
| EDT-01 | an edit re-decodes the whole file when it holds one non-UTF-8 byte | S2 | CONFIRMED S3 | L16 |
| EDT-02 | every splice rebuilds the whole text and offsets | S3 | CONFIRMED (S4: 30-60 ms at 4.9 MB) | merged into L16 |
| EDT-03 | pasting HTML of 130,000 sibling blocks throws | S2 | CONFIRMED S3 | L14 |
| EDT-04 | select-all copy grows faster than the page, copies the drawn part only | S2 | CONFIRMED S2 | L9 |
| EDT-05 | leaving Source costs about 1 s at any size | S3 | CONFIRMED S3 | L18 |
| EDT-06 | Format as code over 80,000 code spans throws | S3 | CONFIRMED (S4) | merged into L14 |
| EDT-07 | Copy as parses the whole selection again | S1 | CONFIRMED S3 (linear, 1.3 s at 1 MB) | L17 |
| EDT-08 | Copy as at 2-4.9 MB | S1 | CONFIRMED S3 (2.7 s and 7.0 s of CPU at 4.9 MB for prose and a technical file, Slack 2.9 and 6.2 s; 2-3x per doubling) | merged into L17 |
| MEA-01 | 1 MB Markdown prose busy 62 s, 4x per doubling | S1 | DUPLICATE of R13 (S2: the longest task is about 1 s; 2.4, 10-14 and 29-38 s at 125, 250 and 500 KB) | R13's Why gains the macOS numbers; its fix is L1 |
| MEA-02 | 4.9 MB plain text busy 108 s; a line appended costs over 2 minutes | S1 | CONFIRMED S1 | L3 |
| MEA-03 | 1 MB JSON reload over 2 minutes; find 93 s | S1 | CONFIRMED S1 | L6 |
| MEA-04 | every key and scroll 0.19 s at 1 MB | S3 | CONFIRMED S3 | merged into L10 |
| MEA-05 | Source and back, edit, undo, reload 2-9 s at 1-2 MB | S2 | CONFIRMED S2 | L10 |
| MEA-06 | 4.9 MB diff 9.9 s; HTML reload 5.3 s | S2 | CONFIRMED S2 | L11 |
| MEA-07 | leaving Source on JSON 1.9 s, text 6.7 s | S2 | PLAUSIBLE S2 (JSON 2.6 s and text 2-2.8 s reproduced; 4.9 MB not run) | merged into L18 |
| MEA-08 | 0.5 MB technical Markdown busy 83 s | S1 | CONFIRMED S1 (40 s at 265 KB, 155 s at 509 KB; cause profiled) | L1 |
| MEA-09 | plain text 5x per doubling | S2 | CONFIRMED S2 (3.7-4.3x) | merged into L3 |
| MEA-10 | references 18 s at 0.5 MB, over 123 s at 1 MB | S1 | CONFIRMED S2 (2.6 s at 0.5 MB, 20 s at 1 MB, 7.9x) | merged into L1 |
| MEA-11 | text just under the lines threshold 84-108 s; the code says 5 MiB, the docs 5 MB | S1 | CONFIRMED S1 | merged into L3; the docs now say 5 MiB (`agent/scale-guard`) |
| MEA-12 | many headings not done in 120 s at 0.5 MB; 1 MB tables 340k nodes | S1 | NOT-REPRODUCED for headings (0.5 MB settles in 2.2 s); tables confirmed at S3 (2.85x, 340k nodes at 1 MB) | noted, no row: tables grow mildly (2.85x, 340k nodes at 1 MB, another cause from L1's); headings at 0.5 MB dropped, though RDR-05 confirms the cliff for headings at 1-2 MB (L1) |
| NAV-01 | find counts only the mounted part | S2 | CONFIRMED S2 | L7 |
| NAV-02 | the Line's `@` draws and redraws every heading | S1 | CONFIRMED S1 | L4 |
| NAV-03 | End on a page still mounting stops short | S2 | CONFIRMED S2 | L8 |
| NAV-04 | a second 2 MB open takes 30-38 s | S1 | CONFIRMED S1 | L5 |
| NAV-05 | each find key 0.5 s from 0.75 MB | S3 | CONFIRMED S3 | merged into L7 |
| NAV-06 | the Line's `@` over 5 MiB parses the whole file | S1 | CONFIRMED S1 | merged into L4 |
| RDR-01 | editing a definition re-parses the whole file | S1 | BY-DESIGN S3 (`docs/architecture.md`; only label changes) | the design is L24's to change |
| RDR-02 | opening a file with a definition parses it whole in one task | S1 | BY-DESIGN S2 (1.4 s at 1 MB, 2.3 s at 2 MB) | the design is L24's to change |
| RDR-03 | technical Markdown takes 6 s of CPU to finish mounting at 1 MB, 20-26 s at 2 MB | S2 | CONFIRMED S2 | merged into L1 |
| RDR-04 | block-dense 1 MB: first text after one 12-14 s task | S1 | CONFIRMED S1 | L2 |
| RDR-05 | tables, headings, transcripts 6-8x slower to mount at 2 MB | S2 | CONFIRMED S2 for headings (5.7 s to 24-27 s of CPU, 1 to 2 MB) and transcripts (5.4 to 28.5 s); tables not reproduced (1.7x) | merged into L1 |
| SHL-01 | non-UTF-8 decode: 4 bytes of map per byte | S2 | CONFIRMED S3 | L19 |
| SHL-02 | Shift_JIS and GBK shown as mojibake | S2 | CONFIRMED S2 | L13 |
| SHL-03 | save hash slow on Apple silicon | S2 | CONFIRMED S3 (0.3 s CPU at 40 MB) | merged into L19 |
| SHL-04 | Read with encoding costs seconds | S2 | CONFIRMED S3 (0.1-0.3 s CPU) | merged into L19 |
| SHL-05 | a writer in a big folder makes the watch rescan it | S3 | CONFIRMED S3 | merged into L19 |
| VWR-01 | deeply nested HTML grows about 3x per doubling | S2 | CONFIRMED S2 | L12 |
| VWR-02 | JSON or YAML over 100 KB costs about 2.3 s to open | S3 | CONFIRMED S3 | L15 |

## Seen by verifiers, not written as findings

- After a reload from disk the page holds about twice its nodes: plain text 76,000 to 153,000 at 1 MB (verifier of
  MEA-02), HTML at 4.9 MB (verifier of MEA-06), JSON 53,000 to 491,000 (verifier of MEA-03). Folded into L6.
- A 20 KB JSON file already draws 5,300 nodes, about 3.9 per value (verifier of VWR-02). Folded into L15.
- The encoding guess in SHL-04 never runs for Shift_JIS, because SHL-02's misdetection returns first.

## Fixed before the rows landed

The same day, other branches fixed five rows while this pull request waited, so they never reached `todo.md`:

- **L1** by #804 (a typesetting batch writes its breaks and hangs without a layout read between) and #807 (the Chromium
  restyle of the whole page on each insertion, from one `:has()` rule with its siblings: md-technical at 500 KB from
  18.5 s to 2.1 s). What is left is the grid pass after a dense page is whole (L30, added by #808) and R13.
- **L4 and L6** by #806. L6 was not what MEA-03 said: the probe's change left text after the closing bracket, so the
  file no longer parsed and was drawn as lines, which costs the same on a fresh open; a valid change reloads like the
  open. The "twice the nodes after a reload" above is garbage not yet collected: with a forced collection the count
  holds.
- **L12** by #797 (nesting past 256 levels flattened, words kept).
- **L14** by #798 (spreads into calls replaced by chunked helpers across `apps/desktop/src` and `packages/core/src`).

In flight when this landed: L2 and L3 (#808), L13 (#805).

## Not reached

WebKit, the macOS engine, in every domain (every number is headless Chromium); the real window; Windows; memory
(`performance.memory` too coarse); notebooks, archives, office documents and books at size; 2 MB and 4.9 MB Markdown
beyond prose; the Spine; reopening a big file after a restart; the Search panel's results for one big file.
