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
