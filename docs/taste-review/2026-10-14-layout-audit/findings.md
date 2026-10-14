# X-32 findings: floating text across the app (2026-10-14)

Run with `node scripts/layout-audit.mjs` (full: 65 surfaces, 1,000 cells, 145–170 s) or `--quick` (25–32 s). Raw output: [`audit-output.md`](audit-output.md), [`audit-output-quick.md`](audit-output-quick.md); screenshots in `shots/`. Window sizes are width × height; Night, and Paper shows the same.


| # | Sev | Surface | Window | Selector | What the reader sees | Story |
| ---: | :-: | --- | --- | --- | --- | --- |
| 1 | 1 | Popups | 1920x900 and narrower | `dialog#marxy-outline`, `li.marxy-outline-row` | The outline popup is behind the docked inspector at 1,600 px and wider (all rows covered) and under the toolbar, tabs and strip below that (first four rows unreadable) | F-101 |
| 2 | 1 | Settings | 1000x900 (about 900 to 1,150) | `section.marxy-settings-group`, `label.marxy-setting-label` | Card 250 px wide, one word a line, label over its value, a segment cut; the body grid keeps a 252 px right-hand track | F-102 |
| 3 | 1 | Menus | every size | `span.marxy-verb-menu-title` | The kind chip's reasons are cut to `n…` and `admonitions or Para…` | F-103 |
| 4 | 1 | Empty window | 1000x900 after widening; 1400x900 unfolded | `div.marxy-frontispiece-parallel > section.marxy-frontispiece-lang > p.marxy-set` | A two-language piece has its columns drawn over each other, or unequal and off the edge (10 of 38 pieces broke) | F-104 |
| 5 | 2 | Library | 1000x900, 1100x900 | `div.marxy-library-cell-path`, `.marxy-library-cell-name` | 496 of 748 px used, Name 100 px, Path one word, Modified cut | F-105 |
| 6 | 2 | Split | 800x600 after narrowing | `span.marxy-source-facts` | Two 250 px panes kept where a split is refused at open | F-106 |
| 7 | 2 | Tab strip | 1400x900, twelve tabs | `span.marxy-tab-name` | Ten tabs read `2026-…` | F-107 |
| 8 | 3 | Library | 800 to 1920 | `span.marxy-library-row-name` | 19 names and 17 paths ellipsised with no `title` | in F-105 |
| 9 | 3 | Palette | 800 to 1920 | `span.marxy-palette-title` | A long file name cut with no `title` | not boarded |
| 10 | 3 | Inspector | 1000x600 | `span.marxy-outline-text` | `Table: Step, Owner, Est. time, Rollback` cut, no `title` | not boarded |
| 11 | 3 | Settings, Library | every size | strip and status-bar regions | The document's strip and status facts stay up over a page that is not the document | not boarded |
| 12 | 3 | Source | 1400x900 | `div.marxy-source-top`, `.marxy-status-item` | Encoding, line ending and position said twice; the kind three times | not boarded |
| 13 | 3 | Popups (find) | 1000x600 | `div.marxy-find` | The find bar sits over the first row, as F-99's tooltip does | with F-99 |
| 14 | 3 | Split | 1920x900 | Source header breadcrumb | Crumbs shrink to `Us… › rea… › W…` | not boarded |

Per surface (Sev-1/2/3): Read 0/0/0, Split 0/1/1, Source 0/0/1, Tab strip 0/1/0, Sidebar 0, Inspector 0/0/1, Status row 0, Palette 0/0/1, Settings 1/0/1, Menus 1/0/0, Notices 0, Popups 1/1/2, Empty window 1/0/0.

**Boarded cases.** F-99 reproduces, and earlier than its card says: the `×` of the active tab touches the next tab's icon with three tabs. F-100 reproduces (Source's card is inset, its text about 120 px inside it). F-98 does not at Source's defaults (X-33's matrix has it). **F-97 did not reproduce**: the palette at 360 to 1,300 px tall and 800 to 2,560 wide, both variants, files, commands, content and empty, has no footer over a row, so the F-97 agent still has to find the author's state.

**Why the script is shaped as it is.** Each scene boots at the width under test (the sidebar and inspector dock by the width at which the workspace first unfolds; a 1,920 px window shrunk to 800 shows both, a window opened at 800 does not), except the split and the empty window, which resize on purpose because two defects live in the resize. `Escape` on an unfolded window folds the workspace, so overlays are closed only while open. False positives removed on the way are in the test file: ellipsis owners and scrollers are not cuts, a line box shorter than its font box is not a cut, a hanging indent and a wrapped line's trailing space are not spills, text under an opaque menu is not an overlap.

**Limits.** It runs in the Vite dev server, so the release build's CSP is not applied (X-33 found the release build refuses CodeMirror's styles; this cannot see that). It reads text boxes only: icons, a `×`, borders, and a baseline or inset that differs from its siblings were looked at in screenshots, not measured. Native tooltips and window chrome are outside the page. One device pixel ratio.

**Should it be a gate? Yes, once F-101 to F-105 land** (so the baseline is zero): the full matrix nightly with `--fail`, and `--quick --fail` (about 30 s) on a pull request that touches `packages/theme/src/*.css`, a `view.ts`, a `*.css` or `index.html`. Until then it reports 19 rows, so a gate story starts with a baseline list (kind and selector) the report subtracts. It cannot say a layout is right, only that no text floats, so it does not replace the pairs.
