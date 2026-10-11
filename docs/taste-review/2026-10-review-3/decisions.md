# Taste review — 2026-10-11

Recorded with the author through the `resolve-taste-queue` harness.

## MARXY-236 — Invisible and bidi characters show as quiet 1ch hex markers

- **Fine.** Default accepted (1ch hairline box, hex, marker at 4.5:1). Visible without shouting, and it keeps commitment 4 (nothing hidden silently).
- Asked: Confirm or tune: visible without shouting. (Default: 1ch hairline box, hex, marker colour at 4.5:1.)

## MARXY-235 — Diff fences tint added and removed lines (marker stays in the text)

- **Fine.** Handbook ch.9 diff tints stand; the deuteranopia check is the evidence. Not re-judged by eye.
- Asked: Confirm or tune the diff tints (handbook ch.9 defaults: added raised, removed near the ground)?

## MARXY-130 — Four new corpus documents — an API reference, a changelog, an agent transcript, and a sour

- **Fine.** Superseded by the reader-typography handbook (ADR-0033) and the MARXY-199 reset; per-format layouts now follow reader-artifacts 07 and are exercised by the MARXY-346 pages.
- Asked: Does each document read as its own format rather than as another page of prose?

## MARXY-24 — Opening quotes hang into the left margin

- **Fine.** Superseded by the reader-typography handbook (ADR-0033) and the MARXY-199 reset; hanging quotes and hyphenation are handbook ch.5 defaults.
- Asked: Does the hung quote read as a book edge rather than a dent? Any hyphen that looks like a mistake?

## MARXY-25 — First rag baselines from the headless render entry at 960 / dark / 17, over the corpus, pe

- **Fine.** Rag baselines are per-engine monitoring (ADR-0047), not a judgement; nothing to rule on.
- Asked: Do these numbers match the page you already preferred after MARXY-23, or is a document now holey or too even?

## MARXY-128 — Review #1's six faults, each a rule in `base.css`

- **Fine.** Superseded by the reader-typography handbook (ADR-0033) and the MARXY-199 reset; the six faults are now spec. The checkbox sit that survives is recorded under MARXY-199.
- Asked: Does it read as a book now? Specifically: heading bind, italic/strike, code-box air, quote rule, checkbox sit, table wrap. Same question in light.

## MARXY-129 — Pair-A tune from review #0

- **Fine.** Superseded by the reader-typography handbook (ADR-0033) and the MARXY-199 reset; code at 18 px and heading weights 560/580 are in the spec.
- Asked: Are the code size and the heading voice right now at 1× and 2×? Do numbered lists still look odd?

## MARXY-28 — Rendered math on `06-math.md`

- **Defer.** The committed 06-math 960 dark baseline shows raw LaTeX in mono, not typeset math: the capture is taken before KaTeX runs, so grid fit cannot be judged from it. B-02 re-baselines on the real app; judge there.
- Asked: Do display blocks sit on the grid without looking cramped? Is inline math on the text baseline?

## MARXY-138 — A local image on `09-gfm-everything.md` loads in the reserved box

- **Fine.** The blocked-host notice reads as the app speaking (bordered box on the column, see MARXY-264), not an error banner.
- Asked: Does the reserved box read as stable typesetting rather than an empty frame? Is the blocked-host line legible without feeling like an error banner?

## MARXY-76 — Review #0 re-rendered on the shipping dark and light palettes (dark first, ADR-0024)

- **Fine.** Dark decision stands; light does not change it. Face choice is now the handbook (Literata + JetBrains Mono).
- Asked: **Decide on dark; confirm light does not change the choice.** Does either pair read differently enough in light that you would swap the recorded decision?

## MARXY-198 — Footnote references written in a different case from their definition (`[^A]` / `[^a]

- **Fine.** One entry per label is the right behaviour; covered by tests.
- Asked: Does a footnote list with one entry per label read right on a document that repeats a definition?

## MARXY-31 — Tier-2 review #1 kit

- **Defer.** The Typora and Marked 2 captures were never taken, so the blind A/B/C cannot run. Needs a human capture.
- Asked: After competitor PNGs land, does Marxy rank first on at least two of the three documents at reading distance? Any grid or rag drift on the long doc at ~70% scroll?

## MARXY-169 — First time CodeMirror appears in the real app

- **Fine.** Superseded by the reader-typography handbook (ADR-0033) and the MARXY-199 reset; the Source look was reworked by L-06 and MARXY-265.
- Asked: Does Source mode read as the same book as Rendered (mono voice, background, line rhythm), or like an IDE dropped over the reader?

## MARXY-164 — Fenced code on `03-ai-plan.md` gains per-scope syntax colour after idle highlight (plain m

- **Fine.** Restrained highlighting (strings, literals, comments, names only; comments not dimmed) is ADR-0033 §4.
- Asked: Do the token colours read as a book's code voice rather than an IDE theme pasted onto the page? Any scope that clashes with the body or feels loud at reading distance?

## MARXY-30 — First committed screenshot baselines

- **Fine.** Baselines reflect the page after MARXY-199. Per-engine pixel gates stay nightly monitoring (ADR-0047), not merge-gating.
- Asked: Do these captures match the pages you already preferred after MARXY-128/129/137, separately on macOS and Linux? Any engine pair that should not gate merges yet?

## MARXY-137 — Hyphenation and hanging punctuation on in the app

- **Fine.** Superseded by the reader-typography handbook (ADR-0033) and the MARXY-199 reset; even rag and hung punctuation are the default.
- Asked: Does the rag and the hung punctuation read better than the greedy rag they replace? Any hyphen that looks like a mistake on the technical page?

## MARXY-87 — First summoned palette

- **Defer.** The review-2 kit still renders in a fallback serif with a heavy blue rule, so it no longer shows the palette. Judge the current palette in the app against mock-v2 04-palette.
- Asked: Does the summoned palette read as native chrome rather than a web form dropped on the page? Is the list legible at 1× without feeling cramped?

## MARXY-39 — Taste review #2 kit

- **Defer.** The 5-second reach task needs a stopwatch and a human; the kit PNGs predate the current palette.
- Asked: Can you reach `02-readme-real-world.md` from three switches ago using only the palette in under 5 s? Do the summoned states read as native chrome at 1×?

## MARXY-96 — Nothing visible in the app yet

- **Fine.** Nothing visible; nothing to flag.
- Asked: None expected until MARXY-44. Flag any golden diff that would change a typeset page once wired.

## MARXY-193 — A heading chosen in the palette lands on the reading line (40% down) and stays there while

- **Defer.** Where the eye expects a jump to land is a feel judgement; try it in the app.
- Asked: Does a palette jump land where the eye expects, and does holding the heading through a resize feel right rather than like the page fighting the scroll bar?

## MARXY-43 — Toggling a task item and aligning a table's pipes, then undo

- **Defer.** Undo after toggle and align is a behaviour check; try it in the app.
- Asked: After a task is toggled and a ragged table is aligned, does the page still read as the same book, and does undo put the marks back?

## MARXY-46 — Light is its own warm paper palette (400 body weight, code background `#f1eee8`), not an i

- **Fine.** The 03-ai-plan light baseline reads as warm paper, not a negated dark theme. Paper is also the default light in mock-v2 (07-themes).
- Asked: Does light read as a book on paper rather than a dimmed dark theme? Any token that still feels like a negated dark value?

## MARXY-177 — First user theme in the real app

- **Defer.** A one-frame restyle is a motion judgement; try it in the app.
- Asked: Does the one-frame restyle after first text feel like the book choosing a binding, or like a flash of the wrong theme? Does the theme-file notice read as helpful rather than modal chrome?

## MARXY-199 — The whole page, reset by the reader-typography research

- **Tune.** Page is right within the research. One fix: task checkboxes sit visibly high against the first line (03-ai-plan baseline, dark and light); centre them on the first line. The sub-bullet markers look right.
- Asked: Size, measure and code colour follow the research and are not up for re-decision. Is the page beautiful within them? Does the code breakout read as the page's own margin or as a box escaping the column? Is the continuation rule enough of a mark? Task checkboxes now sit high on the taller line (noted, not changed).

## MARXY-239 — Source gutter on code files (muted line numbers, toggle)

- **Fine.** Quiet gutter and the slash break are fine.
- Asked: Confirm or tune: gutter quiet; slash break reads right.

## MARXY-196 — The palette's empty and typed lists now come from the repository index, built at idle, ins

- **Defer.** Search quality by path, title and heading needs real queries in the app.
- Asked: Does a typed query find the document you meant by path, title or heading, and does the list still read as the same summoned chrome?

## MARXY-258 — An indented line of verse now opens with a curled quote. A straight quote after an em spac

- **Fine.** Same fix; tests pin the em-space case. The Keats kit page shows the pre-fix closing quote.
- Asked: Does that opening quote curl open, as a book would, rather than closed?

## MARXY-257 — A launch with no document shows a random Commonplace passage instead of the one grey hint

- **Fine.** The Keats page reads as a frontispiece: title at h3, flush-left verse with one-em indents, quiet colophon. The delegate rulings stand. Its closing-form opening quote before "Beauty" is the MARXY-258 bug, now fixed.
- Asked: Does it read as a frontispiece rather than a document with nothing in it? Decided provisionally by the author's delegate (2026-09-26), each open to overturn: vertical centring over starting at the top; title at h3; verse flush left rather than centred on its longest line (Bringhurst: in the form the poet chose); turnovers hang past the deepest indent so a turnover never reads as an indented line; parallel texts centred as a pair; no hyphenation in colophons (names and titles). The EM SPACE quote on the Keats last stanza was fixed by MARXY-258; these captures are from before that fix.

## MARXY-184 — On macOS, a native menu bar appears for the first time

- **Fine.** Labels are the macOS standard and the menu has no document-specific command, as a reader-first app should (mock-v2 09-macos).
- Asked: Do the item labels ("Open File…", "Close Window", "Quit Marxy") read naturally, and is the menu shape (no document-specific command) right for a reader-first app?

## MARXY-264 — The notice/dismiss banner above the article — blocked-image, disk-change, theme-file notic

- **Fine.** Reads as the app speaking: bordered box on the article column, a quiet bordered Dismiss, no heavier than the text below.
- Asked: Does the banner read as the app speaking rather than an error page, without feeling heavier than the reading it sits above? Same question in light (contrast checked: text ≥ 14:1, dismiss border ≥ 5.9:1 on the notice background)

## MARXY-263 — An opened document's first line now sits one grid unit (half a line) from the top of the w

- **Fine.** Page now starts near the top. 16 px at 380 px reads well and 480 px is a sensible breakpoint.
- Asked: Does the page now open reading as a book you start at the top of, rather than one that opens centred on the window? Is a 16/24px gutter too tight on a phone-width window, or does the extra measure read better? Is 480px the right breakpoint for the floor to rise?

## MARXY-265 — Source mode no longer looks unstyled

- **Tune.** Mono face and one-grid inset are right. Wrapped lines in Source return to the left edge with no hang (`use nucleo_matcher…` continuation); hang them one level, as Rendered code does.
- Asked: Is a grid-unit inset on all sides of `.cm-content` enough margin, or does Source still read tighter than Rendered's column? This is a basic legibility pass only — no gutter or syntax-colour rework — so leave those for a later story

## MARXY-234 — SKILL-shaped front matter appears as a quiet key/value head above the title

- **Fine.** Defaults accepted (caption size, 14ch keys, 12 lines; label-only alerts).
- Asked: Confirm or tune: head quiet enough that the title still reads first; Warning noticed without a box. (Defaults: caption size, 14ch keys, 12 lines; label-only alerts.)

## MARXY-240 — Nothing visible

- **Fine.** Nothing visible; no slug flagged.
- Asked: None expected on the page itself. Flag any corpus heading whose slug looks wrong (case, punctuation, duplicate suffix)

## research — A titlebar that collapses to zero height at rest and expands on hover/proximity (instead o

- **Change.** Do not prototype the hover-reveal titlebar. It has no precedent in Tauri, risks false reveals while reading, and the palette hotkey already meets "chrome at rest is zero". Revisit only if a real need appears.
- Asked: Is a hover-reveal titlebar worth prototyping given zero precedent found anywhere in the Tauri ecosystem? Does approach-to-summon fit "chrome at rest is zero" better than the palette's existing hotkey-only summon, or does it risk accidental reveals/false triggers during reading? What proximity distance and dismiss timing would need to be tuned before this could even reach a screenshot pair

## MARXY-258 — A straight quote after an em space, no-break space or thin space now opens, so an indented

- **Fine.** Opening quote after an em space, no-break space or thin space now curls open (tested in typography.test.ts). The kit PNGs predate the fix.
- Asked: Does an indented verse line's opening quote read as the start of speech?

## MARXY-280 — Resizing the window re-measures paragraph font size, so a fluid type scale does not keep t

- **Defer.** Re-measure on resize is a behaviour check; try resizing in the app.
- Asked: After a resize, do the breaks still sit where the paragraph would be set again?

## MARXY-283 — The optional justif breaker now charges a cost for two hyphenated lines in a row and for a

- **Fine.** Penalising consecutive hyphens and a last-line hyphen is the standard TeX cost and matches handbook ch.5.
- Asked: Does a paragraph still hyphenate where it should, without a stack of hyphens along the rag?

## MARXY-320 — The app icon (Dock, Finder, window switcher) is the new Marxy M — a glossy letter in cyan,

- **Change.** The glossy cyan, magenta and amber 3D M does not suit a plain-paper-and-ink reader. Want a quieter mark: same squircle, a single-colour serif M, matte.
- Asked: Does it read at Dock size and at 32 px, on a light and a dark Dock? Does its gloss suit a reader that is otherwise plain paper and ink, or does it need a quieter mark?

## MARXY-230 — Raw HTML `kbd`, `code`, `samp` and `pre` inside a paragraph keep the characters that were 

- **Fine.** Faithful to the bytes (commitment 3); a double hyphen stays two hyphens.
- Asked: Does a key cap now read as the keys that were written, including a double hyphen that should stay two hyphens?

## MARXY-49 — An edit no longer writes to disk on its own

- **Tune.** A trailing " •" is too easy to miss. Also set macOS's native edited state (the dot in the close button), and keep the bullet; mock-v2 shows the unsaved dot, not a title suffix.
- Asked: Is a trailing space-bullet enough of a dirty mark on the title bar, or does it need more weight (bold, an asterisk) to be noticed before closing?

## MARXY-241 — Nothing on the default page. The base stylesheet now carries the media-query blocks the ae

- **Defer.** Forced colours, higher contrast and reduced motion are listed Open in the conformance chapter; needs a rendered check under each.
- Asked: Under reduced motion, forced colours and higher contrast, does the page still read as the same book?

## commonplace — A launch with nothing to read shows the passage only. The front-matter head, the language 

- **Defer.** Two texts without a language label needs eyes on a bilingual passage; no image in the kit.
- Asked: Does the pair still read as two texts without the language name? Is the gap enough, and is the colophon still the right thing under the text?

## A-02 — A 1 MB document shows its first two screens under a second

- **Fine.** Default accepted: a growing scroll bar while the rest arrives is acceptable.
- Asked: Is the scroll bar growing while the rest arrives acceptable, or should it be hidden until the document is whole? (Default: acceptable.)

## B-02.2 — Inline math such as ΔT in a list item or paragraph no longer makes the block about a pixel

- **Defer.** Same capture problem as MARXY-28: baselines show raw TeX; check baseline fit at 16, 20 and 24 px after B-02.
- Asked: Does the formula still sit on the text baseline at 16, 20 and 24 px?

## B-02 — The aesthetics gate now photographs the real app instead of a copy of its render

- **Defer.** Judge the real-app baselines at 960 px after fixing the math capture (MARXY-28); code colour and hidden-character marks look right in the sampled pages.
- Asked: Do code colour, KaTeX and the hidden-character marks look as they should at 960 px in dark and light, now that the gate sees them?

## B-03 — Wide code and tables run into the margin of the box the article sits in, not the window

- **Fine.** Default accepted: 16 px gutter in a narrow container.
- Asked: Is a 16px gutter right in a narrow container, as in a narrow window? (Default: yes.)

## L-03 — In a narrow window (up to about 750 px at 20 px type, wider at larger sizes) a top-level l

- **Fine.** Default accepted: indent by the part of the hang the margin cannot hold; part-hang at 720 px is acceptable.
- Asked: A narrow list now reads as slightly indented against its paragraphs, which is the trade ch.4 "a minimum gutter" asks for: acceptable? And at 720 px the ordered list is part-hung (15 px in) while bullets hang fully: is that partial hang right, or should a list either hang fully or not at all? (Default: as is.)

## H-04 — The default look changes

- **Fine.** Night and Paper stay the default (the author kept them, 2026-10-11, in the 2026-10-walk). Heading weights held at 560/570: right.
- Asked: Is Night's pure black too stark against the cool grey text, or right? Is Paper's cooler ink better or worse than the warm paper it replaces? Heading weights are held at 560 and 570 (the repo's ceiling is 570), lighter than the mock's 590 and 640: right? (Default: as is.)

## A-05 — `Mod+P` on a known repository lists documents at once (the last session index), then settl

- **Fine.** Default accepted: the check is under a second.
- Asked: Is a stale row that vanishes after the check noticeable? (Default: no, the check is under a second.)

## A-06 — Palette results rank by when you really read each document, and the current repository com

- **Fine.** Default accepted: recency strength as shipped.
- Asked: Does recency feel strong enough against match quality? (Default: yes, weights unchanged.)

## B-09 — A README with remote badges shows one plain notice that names how many images were held an

- **Fine.** Default accepted; the notice is plain and honest as worded.
- Asked: Is the notice's wording plain and honest enough now that it makes no offer about images, or should it say they stay blocked on purpose? (Default: as is.)

## E-09 — Sort list items in the palette on a selected list reorders its items A to Z

- **Fine.** Default accepted: sort by text with the box included, so open tasks come first.
- Asked: Is sorting task items by their text (the `[ ]` box included, so open tasks come before done ones) what you want, or should the box be skipped? (Default: as the card says, box included.)

## A-12 — The palette `>` list shows every applicable command with its key at the right of the row

- **Fine.** Default accepted: key label same weight, pushed to the row end (mock-v2 04-palette).
- Asked: Is the key label quiet enough beside the title? (Default: yes, same weight, pushed to the row end.)

## C-12 — C-12 — the empty palette's sections, ages and mark. Open the palette with nothing typed. J

- **Fine.** Section names (Pinned, Changed since you read, Recent) match mock-v2 library views; age at the right edge and a quiet accent dot are right. Modified-age on Recent rows is expected. Unread files count as changed once modified after first index: agreed.
- Asked: The section names (Pinned, Changed since you read, Recent): quiet enough, right words?
The age (`now`, `4m`, `3h`, `2d`, `5w`, `1y`): dim, at the right edge; is it the file's modified age you expect on every row, Recent included?
The mark: a 0.4em accent dot before the age on a changed row; too faint, too loud, or right?
A file never read counts as changed once it is modified after Marxy first indexed its folder; a reasoned default for the author to rule on.

## A-13 — Palette `>` lists Toggle Rendered / Source (Mod+E), Back (Mod+[) and Forward (Mod+]) with 

- **Fine.** Default accepted: Back and Forward are clear.
- Asked: Are the titles "Back" and "Forward" clear enough beside the other commands? (Default: yes.)

## A-14 — The light variant and text size in config apply at launch

- **Defer.** A visible jump at 24 px needs a try in the app.
- Asked: Does the page re-set on the grid without a visible jump at 24 px?

## A-15 — The outline

- **Fine.** Default accepted (320 px max, 75 % opacity, 2 px bar).
- Asked: Is the rail quiet enough over the page: width, opacity of the non-current rows, the accent bar on the current one? (Default: yes, 320px max, 75% opacity, 2px bar.)

## MARXY-231 — Task items whose first inline is code, emphasis, or a link regain a checkbox in Rendered m

- **Fine.** Default accepted: identical to every other task item. (Checkbox height is under MARXY-199.)
- Asked: Do the recovered checkboxes sit like the others? (Default: identical to every other task item.)

## MARXY-346 — Five new corpus pages render for the first time

- **Change.** Bug, not taste: in the issue thread the ordered-list numbers ("1.", "2.") sit alone on a line above their item text when an item has a code block. Fix in the list layout. The rest of the page, the damaged forms and the grid read as the documents they are.
- Asked: Do the damaged forms (hand-typed bullets, a stray `<style>` shown as code, ESC bytes) read as the document they are, and does the 195 KB page stay on the grid to the end? (Default: the renderer as it stands.)
