# 06 Hands-on exploratory pass (headless WebKit, browser build)

**Bottom line.** Over 18 demo files and the everyday Markdown path, I found no BLOCKER. Every file rendered non-empty with a sensible, well-set page and no page errors. Read/Source keeps the place, Source typing undoes and redoes, find steps through hits, the Outline and the Line (`@heading`) jump correctly, the Studio's Day/Night switch works, and 800×600 and 1680×1050 show no overlap or horizontal overflow. What I found is small: one open question about the first-load colour scheme, console noise from sandboxed frames, and Tab reaching only two stops. Limits: this was the in-memory browser shell (`vite` on port 1437, Playwright WebKit, not WKWebView in Tauri), so file access, watching, Rust decoders, the system open dialog and real macOS light/dark are not tested. Nobody ran the desktop app.

## Files opened (1280×800, 3 s after load)

| File (under fixtures/demo) | Type | Rendered? | Console errors | Note |
| --- | --- | --- | --- | --- |
| reading/on-the-measure.md | Markdown, footnotes, maths | yes | 0 | Typeset page, byline, quote, footnote marks, KaTeX fine |
| data/soundings.json | JSON | yes | 0 | Tree, large (about 65 KB of text) |
| data/p95-latency.csv | CSV | yes | 0 | Table |
| logs/build-2026-10-14.log | log | yes | 0 | Level column, gap markers, stack continuation, good |
| patches/pg16-plan-tldr.diff | diff | yes | 0 | Word-level marks, two line-number columns |
| notebooks/tide-heights.ipynb | notebook | yes | 0 | Cells, output table, "HTML output, cleaned" note |
| images/tide-chart.png | PNG | yes | 0 | Checks background, strip of 8 neighbours; dark axis text on dark checks is the image's own (Light toggle exists) |
| images/sketch.svg | SVG | yes | 0 | Image viewer |
| reading/the-case-for-ragged-lines.pdf | PDF | yes | 0 | Page 1 of 3, 159 % fit width |
| archives/harbour-survey-2026.zip | zip | yes | 0 | Treemap, list, README preview beside it |
| sheets/tide-log-2026.xlsx | spreadsheet | yes | 0 | Values/Formulas, sheet tabs, hidden sheets named |
| documents/harbour-survey-2026.docx | Word | yes | 0 | Not viewed as a picture; text present |
| fonts/TidemarkSans-Regular.ttf | font | yes | 0 | Specimen, sizes, editable sample |
| data/journal.sqlite | SQLite | yes | 0 | Table view, WAL note (browser shell fixture) |
| mail/low-water-notice.eml | email | yes | 2 | Headers, remote-image notice, HTML part; see HO-02 |
| site/harbour-notice.html | HTML | yes | 2 | Sandboxed page; see HO-02 |
| src/indexer.rs | code | yes | 0 | Coloured source |
| transcripts/2026-10-12-session.jsonl | session | yes | 0 | Text present, not viewed as a picture |

Everyday path, all on reading/on-the-measure.md:

- Scroll to "Where the numbers come from", Cmd+E to Source: it opened at the same heading (Ln 32), caret in the editor. Typed a word, Cmd+Z removed it, Cmd+Shift+Z restored it. Cmd+E back to Read: place kept (about 24 px shift), the edit shows with an "Unsaved · 1 place" chip; Cmd+Z in Read undid it.
- Cmd+F: find box, "5 of 8" after typing and two Enters, hits highlighted and marked on the scroll rail.
- Alt+3 Outline: headings with size bars, current marked. Cmd+P then `@way` then Enter landed on "The way back" with the cursor bar. `>` lists commands with keys.
- Cmd+, was not tried; the Aa button opens the Studio (themes, Day/Night, Narrow/Column/Wide, contrast readouts). Day switch gives a light page.
- 800×600: the Places panel folds away and the page fills the width. 1680×1050: Places stays, page centred at a 66-character measure. No horizontal overflow at either (`scrollWidth <= innerWidth`).

## Findings

### HO-01 [SHOULD] A light system scheme did not give a light page on first load (check on the Mac)

- Did: new Playwright context with `colorScheme: 'light'`, opened the Markdown page.
- Saw: `matchMedia('(prefers-color-scheme: dark)')` was false, yet `<html data-marxy-variant="dark">` and a dark page (`rgb(21, 20, 18)`) (shot `shots/HO-01.png`). With no emulation, the Studio says "Night tone (the system is dark)".
- Expected: a light system to give a Day page, unless the look deliberately adapts by hour or defaults to Night for a fresh profile.
- Likely cause: `apps/desktop/src/look/paint.ts` (`resolveWindow` decides `win.scheme`, then `applyVariant`) using the look's hour or default instead of `systemDark` (`look/painted.ts`). I did not establish which; it may be by design. Worth ten seconds on a Mac set to Light with a clean profile.

### HO-02 [LATER] Console errors from sandboxed frames in mail and HTML pages

- Did: opened low-water-notice.eml and harbour-notice.html.
- Saw: two console errors each: "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set." The page itself looked right (shot `shots/HO-02.png`).
- Expected: no console noise from a deliberate sandbox. If the frame's srcdoc contains a script (a height reporter, say), check the frame is still sized correctly in WKWebView, which reports sandbox violations the same way.
- Likely cause: the HTML viewer's srcdoc builder under `apps/desktop/src` (search for `srcdoc`). Cosmetic as seen here.

### HO-03 [LATER] Tab reaches only two stops

- Did: clicked the page, pressed Tab eight times and read `document.activeElement`.
- Saw: focus cycles Places panel, document, then back to body. It never lands on the Read/Source buttons, crumbs, rail icons or the Aa button. The Places and document stops draw their focus with a box-shadow, not an outline.
- Expected: either those controls are reachable, or this is by design (the app is keys-first: Mod+E, Mod+P, Alt+1…8; the foot line says "Tab comes here"). I did not see a focus ring on a toolbar control to judge. Judge against the intent in `docs/keys.md`.

## Not found

No clipped or overlapping text, unstyled content, blank viewers, broken icons or layout jumps in the screenshots I viewed (Markdown, PDF, xlsx, notebook, diff, log, zip, font, image, SQLite, mail, HTML, the Studio, 800 and 1680 widths). Contrast in the Studio reads Text 13.3:1 (Night) and 15.9:1 (Day), Faintest 6.5:1 and 5.6:1.

## Not covered

Desktop-only behaviour (file watching, drag-drop, system dialogs, archive and decoder Rust code), docx/jsonl/svg as pictures, media files, real keyboard layouts on macOS, WKWebView-specific rendering (this used Playwright's WebKit build), light-mode screenshots of other viewers.
