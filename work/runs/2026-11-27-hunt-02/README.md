# Hunt 02: freezes when moving through the panels and menus

**Goal.** The owner's report (NAV-01): moving through the left menus (the rail and drawer panels) and the
right menus freezes the window, often but not only with a big file open. Find the cause or causes.

**Out of scope.** Hunt-01's freezes B1 (Export as a web page), B2 (Search regex) and B3 (long unbroken run)
have builders already (`agent/export-long-page`, `agent/search-slow-pattern`, `agent/long-line-layout`).
Hunt-01's rows B1–B16 are not on `main`: #781 merged into `agent/bug-cycle` after #779 had already been
squashed. A copy is in `briefs/known-rows-hunt-01.md`.

**Domains.**

| Prefix | Catcher | Aim |
| --- | --- | --- |
| NAV | panels | the rail, and the panels Places, Outline, Links and Search: Alt+n, rail clicks, each panel's build and repaint over a big file, folding |
| RDR | relayout | what a change in page width costs: the drawer docking or undocking, the rail hidden, split, resize, on big files |
| CMD | menus | first sent at the "right menus" (verb menu, right-click, tab menu, Line, Studio); retargeted once the owner explained: the last four drawer panels (Metadata, Versions, Transforms, Export) and the in-panel keys |

**The owner's clarification (2026-11-27).** "Left and right menus" means the rail (left) and each rail item's
panel view in the drawer to its right. NAV took the rail and the first four panels, CMD the last four, and RDR
what the drawer opening, folding and docking costs the page.

## Counts

Nine findings: one owner report and eight from the catchers (NAV 2, RDR 2, CMD 4). Verdicts: 6 confirmed, 1
duplicate, 1 not reproduced; the owner report was superseded. Rows made: B17 and B18 (S1, Next), B19 (S3, Later);
CMD-03 adds to R13. The verifiers moved RDR-01, RDR-02 and CMD-03 from S2 to S3.

| Domain | Findings | Became rows |
| --- | --- | --- |
| NAV (panels) | 2 | B18; NAV-03 merged into B19 |
| RDR (relayout) | 2 | B19 |
| CMD (menus, then panels 5–8) | 4 | B17, B18 (CMD-02); CMD-03 to R13; CMD-04 dropped |

The drawer relayout, the first guess, is real but small. The freezes were two panels doing whole-file work
on the main thread. The next hunt should look for other callers of whole-file parses outside the store's kept
parse (`pathMentions`, `byNodes`, `fromMarkdown` calls in `left/`).

This pull request also brings hunt 01 onto `main` (its run folder, rows B2–B16 and its skill and ledger edits):
#781 had merged into `agent/bug-cycle` after #779 was squashed. B1 has left the tracker: it landed in #784.
B2 and B3 carry their builders' branches.
