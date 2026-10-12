# Waves: what each wave lets the reader do

Read this page for the features; [`progress.md`](progress.md) is the ledger of stories. The Story column links to
each story's card. State and PR are kept equal to the ledger by `node scripts/waves.mjs` (`--check` fails when
stale). The ledger was brought level with GitHub on 2026-10-12 (X-26).

**Summary (2026-10-11 night; edit by hand when a wave closes).**

1. **Done:** waves 1 to 3 (foundations, the new Night and Paper look, editing verbs) and waves 4 to 7 (the unfolded workspace, Copy as, kinds, keys, paste, toolbar, Transform, code opens in Source).
2. **Current:** wave 8, filling the unfolded window. Tabs, sidebar and library view are merged; only the inspector's Links tab (W-09, #607) is in review.
3. **Next:** the design pass (X-21, Opus, running): an aesthetics and usability pass on the chrome and Source view, moving toward the mock-v2 mockup, with the notifications pass (X-19) folded in. New UI surfaces wait for the author's ruling on its direction (see Design pass).
4. **Carded:** wave 9 (themes, five kinds, the sidebar's trees); see its section. Its author questions proceed on their defaults, except K-20's placement and K-10b's ADR question. Wave 10 is carded too (the inspector, Source's editing tools, new files, the menu bar); its V-06 and W-20 wait for ADR rulings.
5. **Not blocked:** every author ruling and open ADR was settled on 2026-10-11 (X-18); a few small questions wait with defaults (below).
6. **Ledger lag:** 18 states below come from GitHub, not from progress.md; the lead's ledger PR will catch up.

## Waves 1 to 3: foundations and the new look (2026-10-09 to 10-10)

Lay the parts the later waves wire up (token contract, file kinds, clipboard API, transforms, query language), and ship the new default look and the editing verbs.

| Feature | How to reach it | Story | State | PR |
| --- | --- | --- | --- | --- |
| The app opens in the new Night (dark) and Paper (light) look with a bundled type set; the old dark look stays as the theme Ink | Automatic at launch, folded or unfolded | [H-04](../direction-2026-10/10-cards-wave-3.md#h-04--night-and-paper-become-the-default-theme-ink-gets-its-own-directory) | merged | [#551](https://github.com/inkstrata/marxy/pull/551) |
| Select a line, block or section and grow the selection; move, duplicate, join and sort lines in Source | Source mode (`⌘E` or `⌘3`): `⌃⇧B` block, `⌃⇧→` grow, or the palette | [V-01](../direction-2026-10/10-cards-wave-3.md#v-01--structural-selection-and-line-operations-in-source) | merged | [#527](https://github.com/inkstrata/marxy/pull/527) |
| When a file changes on disk over your unsaved edits, keep yours as a copy or take theirs | A notice appears on its own, folded or unfolded | [V-07](../direction-2026-10/09-cards-wave-2.md#v-07--a-file-changed-on-disk-over-unsaved-edits-keep-mine-as-a-copy-or-take-theirs) | merged | [#549](https://github.com/inkstrata/marxy/pull/549) |
| Cmd-click a link to another document and it opens in the other pane | Rendered, folded or unfolded | [D-09](../roadmap-2026-10/04-phase-d.md#d-09--follow-a-link-into-the-neighbour-pane) | merged | [#528](https://github.com/inkstrata/marxy/pull/528) |
| Quit with two panes open and find both back, in the same modes and places | Automatic at launch | [D-12](../roadmap-2026-10/04-phase-d.md#d-12--remember-the-layout-and-each-panes-place-and-restore-them-on-launch) | merged | [#529](https://github.com/inkstrata/marxy/pull/529) |
| Edit one block in place in a code editor; Esc keeps the edit | Rendered, with a block selected (edit key); folded or unfolded | [E-04](../roadmap-2026-10/05-phase-e.md#e-04--edit-one-block-in-source-in-place) | merged | [#545](https://github.com/inkstrata/marxy/pull/545) |
| Promote and demote a heading with its sub-headings | Right-click verb menu, "All actions…", or `>` in the palette | [E-07](../roadmap-2026-10/05-phase-e.md#e-07--promote-and-demote-headings) | merged | [#536](https://github.com/inkstrata/marxy/pull/536) |
| Renumber a list, switch bullets and numbers, turn glyph bullets into a list | Same verb menu or `>` | [E-08](../roadmap-2026-10/05-phase-e.md#e-08--renumber-a-list-convert-bullets-and-numbers-turn-glyph-bullets-into-a-list) | merged | [#539](https://github.com/inkstrata/marxy/pull/539) |
| Pretty-print JSON and re-indent YAML inside a fence | Same verb menu or `>` | [E-10](../roadmap-2026-10/05-phase-e.md#e-10--pretty-print-json-and-re-indent-yaml-inside-fences) | merged | [#540](https://github.com/inkstrata/marxy/pull/540) |
| Open a scratch document that writes no file until Save As | Palette command | [E-13](../roadmap-2026-10/05-phase-e.md#e-13--open-a-scratch-untitled-document-that-writes-nothing-until-save-as) | merged | [#550](https://github.com/inkstrata/marxy/pull/550) |
| See what changed in a file that was rewritten under you | Palette command, offered after a reload | [E-17](../roadmap-2026-10/05-phase-e.md#e-17--show-what-changed-in-a-regenerated-file) | merged | [#554](https://github.com/inkstrata/marxy/pull/554) |

## Wave 4: unfold the window; copy as anything

Give the window a folded and an unfolded state, and put the clipboard API in front of the reader for the first time.

| Feature | How to reach it | Story | State | PR |
| --- | --- | --- | --- | --- |
| Unfold the window into a workspace of six named regions around the panes (empty until later waves fill them); fold back to today's page | `⌘\` folds and unfolds. Open beside moved to `⌥⌘\` | [W-02](../direction-2026-10/10-cards-wave-3.md#w-02--the-workspace-shell-folded-and-unfolded-and-the-grid-of-regions-around-the-panes) | merged | [#561](https://github.com/inkstrata/marxy/pull/561) |
| Copy the selection, block or document as Markdown, plain text, rich text, HTML source, Slack, Jira wiki, a JSON string, or a quote with its source | `⇧⌘C` opens the Copy as menu; folded or unfolded | [J-04](../direction-2026-10/11-cards-wave-4.md#j-04--copy-as-with-every-target) | merged | [#563](https://github.com/inkstrata/marxy/pull/563) |
| Open a large document beside a small one without freezing the small one | `⌥⌘\` or Cmd-click a link; folded or unfolded | [D-15](../roadmap-2026-10/04-phase-d.md#d-15--opening-a-large-document-beside-a-small-one-must-not-block-the-window) | merged | [#565](https://github.com/inkstrata/marxy/pull/565) |

**Fixes and follow-ups.**

| Fix or follow-up | Story | State | PR |
| --- | --- | --- | --- |
| Operation lists are one entry per line so two additions merge cleanly | [F-32](../direction-2026-10/11-cards-wave-4.md#f-32--operation-lists-one-entry-per-line-in-id-order) | merged | [#558](https://github.com/inkstrata/marxy/pull/558) |
| The taste walk: before-and-after pages of the new look for the author to rule on | [X-11](../direction-2026-10/11-cards-wave-4.md#x-11--the-taste-walk-todays-work-in-front-of-the-author-in-one-sitting) | merged | [#559](https://github.com/inkstrata/marxy/pull/559) |
| The Linux boot stall falls back to a frames-only signal | [F-31](../roadmap-2026-10/08-fixes-from-the-bug-sweep.md#f-31--a-linux-webkit-boot-stall-waitforenginepaint-never-gets-a-paint-entry) | merged | [#567](https://github.com/inkstrata/marxy/pull/567) |
| Bundle the Atkinson Hyperlegible Next and Inter fonts | [H-04.1](progress.md) | merged | [#566](https://github.com/inkstrata/marxy/pull/566) |
| Linux baselines for Night and Paper | [H-04.2](progress.md) | merged | [#560](https://github.com/inkstrata/marxy/pull/560) |
| The Phase E screen criterion is proved and the documents synced | [E-18](../roadmap-2026-10/05-phase-e.md#e-18--prove-the-screen-criterion-and-sync-the-documents) | merged | [#575](https://github.com/inkstrata/marxy/pull/575) |

## Wave 5: the kind is real; the keys are ruled; paste

Make "this file will open as X" true, give the ruled keys their meaning, and let a paste convert.

| Feature | How to reach it | Story | State | PR |
| --- | --- | --- | --- | --- |
| A file opens as the kind Marxy decided (README and CHANGELOG with no extension open Rendered); the palette row shows the kind | Automatic at open. Override with the kind commands in the palette ("Always open this folder as…") | [K-05a](../direction-2026-10/11-cards-wave-4.md#k-05a--the-kind-decided-once-at-open-on-the-pane-root-and-in-the-palette) | merged | [#573](https://github.com/inkstrata/marxy/pull/573) |
| Articles, READMEs and reports get their own typography | Automatic by kind | [K-05b](../direction-2026-10/11-cards-wave-4.md#k-05b--the-article-readme-and-report-profiles) | merged | [#581](https://github.com/inkstrata/marxy/pull/581) |
| `⌘K`, `⇧⌘P` and `⌘/` open the palette; `⌘1`, `⌘2`, `⌘3` choose Read, Split, Source; pane focus moves to `⌘⌥←` and `⌘⌥→` | Keys; folded or unfolded | [W-19](../direction-2026-10/11-cards-wave-4.md#w-19--keys-k-p--and-1-to-3-for-read-split-and-source) | merged | [#568](https://github.com/inkstrata/marxy/pull/568) |
| Paste HTML as Markdown in Source; paste in Rendered opens it as a new scratch document; `⌥⇧⌘V` pastes plain text | `⌘V`; folded or unfolded | [J-05](../direction-2026-10/11-cards-wave-4.md#j-05--paste-html-becomes-markdown-in-source-in-rendered-it-opens-a-scratch-document) | merged | [#569](https://github.com/inkstrata/marxy/pull/569) |

**Fixes and follow-ups.**

| Fix or follow-up | Story | State | PR |
| --- | --- | --- | --- |
| A launch document's kind is decided before its first paint | [K-05a.1](../direction-2026-10/11-cards-wave-4.md#k-05a1--decide-a-launch-documents-kind-before-its-first-paint-without-delaying-first-text) | merged | [#583](https://github.com/inkstrata/marxy/pull/583) |
| Keep the reading line when a block edited above it gains a line | [E-04.1](progress.md) | merged | [#580](https://github.com/inkstrata/marxy/pull/580) |
| Preload the Classic faces so a kind does not swap after paint | [H-04.3](../direction-2026-10/10-cards-wave-3.md#h-043--preload-the-classic-faces-a-kind-profile-sets-text-in) | merged | [#588](https://github.com/inkstrata/marxy/pull/588) |
| The keys table reads the palette's chords | [W-19.1](progress.md) | merged | [#628](https://github.com/inkstrata/marxy/pull/628) |
| Scratch notices wait for the unsaved-edits prompt; a pasted leading BOM stays text | [E-13.1](progress.md) | merged | [#613](https://github.com/inkstrata/marxy/pull/613) |

## Wave 6: the toolbar; code tables

Draw the first door: a toolbar in the unfolded window, and make one table decide how each file type opens.

| Feature | How to reach it | Story | State | PR |
| --- | --- | --- | --- | --- |
| A toolbar with back, forward, the document's name, Read/Split/Source, Copy and Find | Unfolded window only (`⌘\` to unfold) | [W-05](../direction-2026-10/14-cards-waves-6-7.md#w-05--the-toolbar-a-row-of-doors-each-drawn-only-when-its-command-exists) | merged | [#574](https://github.com/inkstrata/marxy/pull/574) |
| One table decides each file type's mode and language, so a code file is treated as code | Automatic at open | [V-09](../direction-2026-10/13-code-view.md#v-09--one-file-type-table) | merged | [#578](https://github.com/inkstrata/marxy/pull/578) |
| Rendered and Source share one tab width, read from EditorConfig correctly | Automatic | [V-16](../direction-2026-10/13-code-view.md#v-16--one-tab-width-and-a-correct-editorconfig-reader) | merged | [#572](https://github.com/inkstrata/marxy/pull/572) |

**Fixes and follow-ups.**

| Fix or follow-up | Story | State | PR |
| --- | --- | --- | --- |
| A standing seeded data-safety test over the document store | [F-33](../direction-2026-10/11-cards-wave-4.md#f-33--a-standing-data-safety-walk-over-the-store) | merged | [#570](https://github.com/inkstrata/marxy/pull/570) |
| The same walk, nightly at 2,000 seeds | [F-33.2](progress.md) | merged | [#571](https://github.com/inkstrata/marxy/pull/571) |
| More cases for the walk (Save As onto a dirty open path, paste) | [F-33.1](progress.md) | merged | [#639](https://github.com/inkstrata/marxy/pull/639) |
| The Source text holds every byte, so a fold writes what you changed | [F-34.1](../roadmap-2026-10/08-fixes-from-the-bug-sweep.md#f-341--the-source-text-holds-every-byte-so-a-source-fold-writes-exactly-what-the-reader-changed) | merged | [#584](https://github.com/inkstrata/marxy/pull/584) |
| A lone continuation byte no longer makes splice throw | [F-35](progress.md) | merged | [#584](https://github.com/inkstrata/marxy/pull/584) |
| Stray bytes survive a forged paste, a save's undo and a block edit | [F-34.2](../roadmap-2026-10/08-fixes-from-the-bug-sweep.md#f-342--stray-byte-follow-ups-a-forged-paste-the-second-undo-after-a-save-and-the-block-editor) | merged | [#589](https://github.com/inkstrata/marxy/pull/589) |
| Back is greyed at the start of history | [W-05.2](progress.md) | merged | [#595](https://github.com/inkstrata/marxy/pull/595) |
| Edit collection stays on the pane it was opened in | [F-37](progress.md) | merged | [#595](https://github.com/inkstrata/marxy/pull/595) |
| Edit collection answered after focus moved acts on the focused pane | [F-21.1](progress.md) | merged | [#595](https://github.com/inkstrata/marxy/pull/595) |

## Wave 7: one chrome; peeking; Transform; code opens in Source

Make every summoned surface look alike, let panels peek from the edges, and open Transform and code files properly.

| Feature | How to reach it | Story | State | PR |
| --- | --- | --- | --- | --- |
| One look for the palette, menus, find, outline, notices and toolbar, scaled by the chrome size setting | Automatic | [W-04](../direction-2026-10/14-cards-waves-6-7.md#w-04--one-chrome-for-every-summoned-surface-and-every-menu) | merged | [#579](https://github.com/inkstrata/marxy/pull/579) |
| Rest the pointer on a window edge to peek a panel; click or its key docks it; Esc folds | Folded window. Top edge shows the toolbar, left edge the sidebar (W-07); the right edge shows the inspector once W-09 merges. `⌃⌘S` docks the sidebar, `⌥⌘I` the inspector | [W-03](../direction-2026-10/14-cards-waves-6-7.md#w-03--peeking-an-edge-shows-one-panel-clicking-or-its-key-docks-it-esc-folds) | merged | [#582](https://github.com/inkstrata/marxy/pull/582) |
| Run a transform on the selection or document and see Before and After; copy, apply (edit transforms) or open as a new document | `⌘/` or the toolbar Transform button (unfolded), or `>Transform` in the palette | [W-21](../direction-2026-10/14-cards-waves-6-7.md#w-21--transform-the-toolbar-button-the-palettes-group-and-the-result-sheet) | merged | [#585](https://github.com/inkstrata/marxy/pull/585) |
| Run a transform on the clipboard and write the result back after you see it | Palette: "Transform clipboard: …"; folded or unfolded | [J-06](../direction-2026-10/14-cards-waves-6-7.md#j-06--transform-the-clipboard) | merged | [#603](https://github.com/inkstrata/marxy/pull/603) |
| A code file opens straight into Source, with no flash of Markdown; a failed mount says so | Automatic at open | [V-11](../direction-2026-10/13-code-view.md#v-11--a-code-file-opens-straight-into-source) | merged | [#587](https://github.com/inkstrata/marxy/pull/587) |
| Table tools in Source: align columns, add a row or column, sort by column, copy as CSV | Palette "Source" group, caret in a table | [V-02](../direction-2026-10/11-cards-wave-4.md#v-02--table-tools-in-source) | merged | [#577](https://github.com/inkstrata/marxy/pull/577) |

**Fixes and follow-ups.**

| Fix or follow-up | Story | State | PR |
| --- | --- | --- | --- |
| The Transform sheet runs off the main thread and keeps every byte | [W-21.1](progress.md) | merged | [#600](https://github.com/inkstrata/marxy/pull/600) |
| The transforms are linear on large text | [J-03.2](progress.md) | merged | [#591](https://github.com/inkstrata/marxy/pull/591) |
| Defer the Markdown parse of a file that opens in Source | [V-11.1](progress.md) | merged | [#602](https://github.com/inkstrata/marxy/pull/602) |
| Notices on the chrome spec, with baselines | [W-04.1](progress.md) | parked | — |
| Esc closes an open peek | [W-03.1](progress.md) | merged | [#641](https://github.com/inkstrata/marxy/pull/641) |
| A notice when Add column refuses | [V-02.1](progress.md) | merged | [#664](https://github.com/inkstrata/marxy/pull/664) |
| The five transforms still deferred | [J-03.1](../direction-2026-10/09-cards-wave-2.md#j-031--the-five-deferred-transforms) | merged | [#643](https://github.com/inkstrata/marxy/pull/643) |

## Wave 8 (current): tabs, sidebar, inspector, library

Fill the unfolded window's regions: tabs, a sidebar, an inspector and a library view, plus the kind chip.

| Feature | How to reach it | Story | State | PR |
| --- | --- | --- | --- | --- |
| Tabs for the documents opened in this window; click to switch (asks about unsaved edits); close with the x | Unfolded window | [W-06](../direction-2026-10/15-cards-wave-8.md#w-06--tabs-the-documents-opened-in-this-unfolded-window-one-click-apart) | merged | [#601](https://github.com/inkstrata/marxy/pull/601) |
| A sidebar with Recent, Pinned and files changed since you read; each section folds and is remembered | Unfolded window; `⌃⌘S` | [W-07](../direction-2026-10/15-cards-wave-8.md#w-07--the-sidebar-i-recent-pinned-and-changed-since-you-read-each-section-foldable) | merged | [#606](https://github.com/inkstrata/marxy/pull/606) |
| An inspector with a Links tab listing every link as written, flagging a label that names another host | Unfolded window; `⌥⌘I` | [W-09](../direction-2026-10/15-cards-wave-8.md#w-09--the-inspector-shell-and-its-links-tab) | merged | [#607](https://github.com/inkstrata/marxy/pull/607) |
| A library view: scopes, a query field with chips, results that say why they matched, and a preview | Palette command "Library" (unfolded window) | [Q-03](../direction-2026-10/15-cards-wave-8.md#q-03--the-library-view-scopes-a-query-field-results-that-say-why-they-matched-a-preview) | merged | [#609](https://github.com/inkstrata/marxy/pull/609) |
| A chip showing the file's kind with a menu to show it as another kind, and a strip of tools for the kind | Unfolded toolbar | [K-07](../direction-2026-10/14-cards-waves-6-7.md#k-07--the-kind-chip-and-the-per-kind-tool-strip) | merged | [#586](https://github.com/inkstrata/marxy/pull/586) |
| Source has its own text size, line height, gutter and wrapping | Automatic in Source | [V-12](../direction-2026-10/13-code-view.md#v-12--source-has-its-own-metrics) | merged | [#594](https://github.com/inkstrata/marxy/pull/594) |

**Fixes and follow-ups.**

| Fix or follow-up | Story | State | PR |
| --- | --- | --- | --- |
| The find-pane 1 MB test checks typesetter progress, not completion | [F-36](progress.md) | merged | [#608](https://github.com/inkstrata/marxy/pull/608) |
| Parse warnings for `[strip]` and `[[kind]]` shown to the reader | [K-07.1](progress.md) | merged | [#655](https://github.com/inkstrata/marxy/pull/655) |
| An ordered list `start` is judged as the browser reads it | [F-38](progress.md) | merged | [#593](https://github.com/inkstrata/marxy/pull/593) |
| The transform timing test takes the fastest of several runs | [F-39](progress.md) | merged | [#596](https://github.com/inkstrata/marxy/pull/596) |
| Undo after a save adds no byte; a block edit keeps its line endings | [F-40](progress.md) | merged | [#605](https://github.com/inkstrata/marxy/pull/605) |
| Deleting only a CR in a mixed-ending block is written | [F-40.1](progress.md) | merged | [#611](https://github.com/inkstrata/marxy/pull/611) |
| A setext heading starting with `#` keeps its first character | [F-41](progress.md) | merged | [#604](https://github.com/inkstrata/marxy/pull/604) |
| A key typed with Mod+S in Source is kept | [F-42](progress.md) | merged | [#610](https://github.com/inkstrata/marxy/pull/610) |
| Read, source or split from split returns to one pane | [F-44](progress.md) | merged | [#615](https://github.com/inkstrata/marxy/pull/615) |
| Notices float over the pane instead of pushing the page | [F-46](progress.md) | merged | [#618](https://github.com/inkstrata/marxy/pull/618) |
| Keys typed while Mod+E or Save's title refresh works are kept | [F-42.1](progress.md) | merged | [#619](https://github.com/inkstrata/marxy/pull/619) |
| A no-displacement guard for command-opened surfaces | [F-45](progress.md) | merged | [#614](https://github.com/inkstrata/marxy/pull/614) |
| strip-citations parses once; strip-emoji skips an idle parse | [W-21.2](progress.md) | merged | [#612](https://github.com/inkstrata/marxy/pull/612) |

## Design pass

X-21 (Opus, running) is an aesthetics and usability pass on the chrome and the Source view, moving toward
[`mock-v2`](../direction-2026-10/mock-v2/), with X-19 (how notifications, errors and command-opened surfaces reach the
reader; its card is merged) folded in. **New UI surfaces are on hold until the author rules on X-21's direction.** Data-safety,
performance and non-visual Source work continue. So the candidates for the next wave (the look track, V-10, V-13 to V-15) wait too.

## Carded and ready, no wave yet

These have cards and wait for a slot. They are the code view's remaining stories.

| Fix or follow-up | Story | State | PR |
| --- | --- | --- | --- |
| Rendered shows a code file as code | [V-10](../direction-2026-10/13-code-view.md#v-10--rendered-shows-a-code-file-as-code) | merged | [#668](https://github.com/inkstrata/marxy/pull/668) |
| Generous highlighting: a hue per role | [V-13](../direction-2026-10/13-code-view.md#v-13--generous-highlighting-a-hue-per-role-every-tag-mapped-the-modes-agree) | merged | [#638](https://github.com/inkstrata/marxy/pull/638) |
| Source grammars for the common languages | [V-14](../direction-2026-10/13-code-view.md#v-14--source-grammars-fences-in-markdown-every-line-ending) | merged | [#646](https://github.com/inkstrata/marxy/pull/646) |
| The swap keeps Rendered right | [V-15](../direction-2026-10/13-code-view.md#v-15--the-swap-keeps-rendered-right) | merged | [#656](https://github.com/inkstrata/marxy/pull/656) |

## Wave 9 (carded): themes, five kinds read as their kind, the sidebar's trees

Choose a bundled theme, read logs, diffs, data, transcripts and articles as what they are, and browse repositories,
folders and saved queries from the sidebar. Cards and the dispatch order are in
[`18-cards-wave-9.md`](../direction-2026-10/18-cards-wave-9.md); V-10 (above, ready) merges before K-08 and K-09.

| Feature | How to reach it | Story | State | PR |
| --- | --- | --- | --- | --- |
| Choose Ink, Dusk and Sepia, Fjord or a high-contrast theme; the choice is remembered | Palette: "Theme: …"; folded or unfolded | [H-05](../direction-2026-10/18-cards-wave-9.md#h-05--more-themes-ink-made-reachable-dusk-and-sepia-fjord-hc-dark-and-hc-light) | merged | [#673](https://github.com/inkstrata/marxy/pull/673) |
| An article shows its byline and dek from its front matter | Automatic for an article, in Read | [K-20](../direction-2026-10/18-cards-wave-9.md#k-20--read-an-article-the-byline-and-the-dek-from-its-front-matter) | ready | — |
| A Markdown transcript sets each speaker as an outdented label | Automatic for a transcript, in Read | [K-11](../direction-2026-10/18-cards-wave-9.md#k-11--read-a-markdown-transcript-speakers-outdented-turns-spaced) | merged | [#675](https://github.com/inkstrata/marxy/pull/675) |
| A log opens in Read with level words, timestamps and escapes shown; filter by level, jump to the first error | Automatic at open; the strip's tools (unfolded) or the palette | [K-08](../direction-2026-10/18-cards-wave-9.md#k-08--read-a-log-read-by-default-level-words-timestamps-escapes-shown-and-a-level-filter) | ready | — |
| A diff or patch opens in Read, unified as written, with its lines tinted | Automatic at open | [K-09](../direction-2026-10/18-cards-wave-9.md#k-09--read-a-diff-read-by-default-unified-as-authored-tinted) | ready | — |
| Fold a JSON or YAML file to a depth, each fold saying how many lines it hides | Source; palette "Fold to depth 1…4" | [K-10a](../direction-2026-10/18-cards-wave-9.md#k-10a--read-data-the-depth-lens-in-source) | merged | [#683](https://github.com/inkstrata/marxy/pull/683) |
| See a CSV or TSV as a table with sticky headers, sorting and column stats | The strip's Table tool (unfolded) or the palette | [K-10b](../direction-2026-10/18-cards-wave-9.md#k-10b--read-data-the-table-lens-for-csv-and-tsv) | ready | — |
| Browse repositories and folders as trees in the sidebar | Unfolded window; `⌃⌘S` | [W-08](../direction-2026-10/18-cards-wave-9.md#w-08--the-sidebar-ii-repositories-and-folders-as-lazy-trees) | merged | [#672](https://github.com/inkstrata/marxy/pull/672) |
| Save a library query as a smart collection and open it from the sidebar | Library: "Save as smart collection"; the sidebar | [Q-07](../direction-2026-10/18-cards-wave-9.md#q-07--smart-collections-in-the-sidebar-and-save-as-smart-collection) | merged | [#678](https://github.com/inkstrata/marxy/pull/678) |

## Wave 10 (carded): the inspector fills, Source gets its editing tools, new files and the menu bar

See where you are in the status bar, move sections from the inspector's outline, go back to an earlier version of a file,
format and replace in Source with a preview, be told quietly what is wrong with a file, find broken paths and near copies
in the library, start or fork a file, and find every command in the menu bar. Cards and the dispatch order (three lanes,
five steps) are in [`19-cards-wave-10.md`](../direction-2026-10/19-cards-wave-10.md). V-06 waits for the ruling on
ADR-0072 (local versions), and W-20 for the ruling on ADR-0011's menu note.

| Feature | How to reach it | Story | State | PR |
| --- | --- | --- | --- | --- |
| See the file's kind, a measure, where you are, its encoding, the theme and the text size at the window's foot; click an item to open its inspector tab | Unfolded window, the status bar | [W-11](../direction-2026-10/19-cards-wave-10.md#w-11--the-status-bar-what-the-file-is-and-where-you-are-one-click-from-its-inspector-tab) | ready | — |
| List a document's headings with words per section in the inspector; jump to one, move a whole section up or down, promote or demote it | Inspector › Outline (`⌥⌘I`); `⌥↑` `⌥↓` on a row | [W-10](../direction-2026-10/19-cards-wave-10.md#w-10--the-inspectors-outline-tab-jump-words-per-section-move-a-section) | ready | — |
| Go back to an earlier version of a file, see what changed since you read it, and restore a version as a copy beside the original | Inspector › Versions; palette "Show changes since you read" | [V-06](../direction-2026-10/19-cards-wave-10.md#v-06--the-inspectors-versions-tab-what-changed-earlier-copies-restore-beside-the-original) | ready | — |
| Bold, italic, inline code, strikethrough and link in Source, and insert a table, fence, rule, details block or footnote; show whitespace and a column guide | Source: `⌘B`, `⌘I`, ``⌃` ``; palette `>Insert`, "Show whitespace", "Column guide" | [V-08](../direction-2026-10/19-cards-wave-10.md#v-08--formatting-commands-and-inserts-in-source-show-whitespace-and-the-column-guide) | ready | — |
| Replace across a file in Source after a preview of every change, applied as one undo step | Source: `⌥⌘F`, then Replace all… | [V-03](../direction-2026-10/19-cards-wave-10.md#v-03--find-and-replace-in-source-with-a-preview-of-every-change) | ready | — |
| See where a Markdown file has an unclosed fence, a skipped heading level or a missing path, as quiet marks at Source's right edge; go to the next one | Source's right edge and bottom bar; palette "Go to next note" | [V-04](../direction-2026-10/19-cards-wave-10.md#v-04--notes-about-a-file-quiet-marks-at-the-edge-a-count-and-go-to-next-note) | ready | — |
| Find files that mention paths that do not exist, and files that are near copies of each other | Library: `is:broken`, `is:dup`; the sidebar's built-in smart collections | [Q-06](../direction-2026-10/19-cards-wave-10.md#q-06--broken-paths-and-near-duplicates-in-the-library) | ready | — |
| Start a new file, a new file in a folder, or a fork of the open file written beside it | `⌘N`, `⇧⌘N`; the toolbar's and tab bar's +; a sidebar folder's menu; the palette | [W-14](../direction-2026-10/19-cards-wave-10.md#w-14--new-file-new-file-here-fork-this-file) | ready | — |
| Find every command in the macOS menu bar, with its shortcut | The menu bar (macOS) | [W-20](../direction-2026-10/19-cards-wave-10.md#w-20--the-native-menu-bar-every-command-findable-every-shortcut-checked) | ready | — |

## Waiting on the author

Nothing blocks a wave. The lead's rulings and the open ADRs were settled on 2026-10-11 (X-18), and every
code-owned pull request (#394, #407, #450, #470, #494) has merged. Open, and each proceeds on its default unless you say:

- The taste walk: rule on the pages in `docs/taste-review/2026-10-walk/README.md` (X-11), including the 16 queued rows.
- Tabs keep no unsaved edits of their own, so switching from a dirty tab asks (W-06). Veto to get background tabs (an Opus card).
- Backlinks in the inspector: a button, or left to the library (W-09).
- A key to open the Library, a Preview tab, and the Inbox scope (Q-03).

## Where the states came from

All states come from `progress.md`. The ledger was synced to GitHub (`gh pr list --state all`) on 2026-10-12 (X-26), so no
state is read from anywhere else; `waves-github.json`, the override file `scripts/waves.mjs` can read, is not needed.
