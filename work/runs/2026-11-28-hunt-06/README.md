# Hunt 06

Goal: owner asked for another bug sweep, avoiding known (tracker) bugs and not investigating big-file bugs. Five Sonnet catchers, one round, small files only (under 500 KB); no performance findings. Axes are domains no earlier hunt covered with a correctness lens.

## Round 1

Catchers: LOK (5 findings), CMD (8), VWR (10), EDT (3), NAV (6), all Sonnet at medium effort; none ran out of budget. Five Sonnet verifiers (batches A to E). 32 findings: 27 confirmed, 2 plausible, 2 duplicates, 1 by design. Rows made: B43 (S1), B44 to B48 (S2), B49 and B50 (S2, in Later), B51 to B55 (S3), W11 (real window). One round only.

| Axis | Findings | Confirmed | Plausible | Alone | Dup. of another axis | By design | Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VWR | 10 | 10 | 0 | 10 | 0 | 0 | B49, B50, B54, B55 |
| CMD | 8 | 5 | 1 | 6 | 1 | 1 | B47, B48, B53, W11 |
| NAV | 6 | 6 | 0 | 5 | 0 | 0 | B44 to B46, B51 |
| LOK | 5 | 3 | 1 | 4 | 1 | 0 | B52, W11 |
| EDT | 3 | 3 | 0 | 3 | 0 | 0 | B43 |

## For the next hunt

- **Extend**: EDT found the only S1, three findings in one family (mixed line endings), and was clean on 21 other probes; extend to Replace all, paste and the block editor in CR-only files, and the tab cap with staged changes. NAV and VWR found bugs alone at a high rate: the left panels' models and the Rust readers (zip, tar, 7z, sheets, fonts) were not reached.
- **Drop**: none; every axis found something. LOK found only S3, so a second round there is low value.
- **Converged**: none; no area was covered by two axes. Found clean: the config.toml byte-preserving edit code, the look file parser, contrast of bundled looks, theme switching, Save and Save As across BOM and encodings, undo across a save.
