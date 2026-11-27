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
| NAV | panels | rail and drawer: Alt+1–8, rail clicks, each panel's build and repaint over a big file, folding, docking |
| RDR | relayout | what a change in page width costs: the drawer docking or undocking, the rail hidden, split, resize, on big files |
| CMD | menus | the "right menus": verb menu, right-click, tab menu, the Line and palette, Look/Studio and Settings at the rail's foot |
