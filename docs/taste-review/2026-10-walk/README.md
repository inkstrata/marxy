# The taste walk, 2026-10 (X-11)

Twenty minutes, top to bottom. Each section is one decision: what changed, the picture, the question, the lead's
recommendation, and a `verdict:` line for you to edit (`keep`, `change: ...` or `revert`). Nothing here changes
product code; every picture is the app's own page, driven headless.

Pictures are 1280 px wide (the 1280 x 800 window; the two long pages stop at 1600 px). Dark is the variant the
app starts in; light is the other. Where a section compares two states, the file names say which
(`main` is today, `h04` is PR #551's head, `today` and `v12` are Source's metrics now and as V-12 proposes).

**Regenerate every picture and text file with one command**, from the repository root, with Playwright's WebKit
installed (`pnpm install --frozen-lockfile`):

```
node docs/taste-review/2026-10-walk/capture.mjs [--h04 <worktree of #551's head>]
```

The H-04 worktree is also read from `MARXY_H04_WORKTREE`, and defaults to `../X-11-h04` beside the repository.
Without it, section 1 is captured for `main` only. The script serves the app's harness page over Vite, boots it on
the in-memory shell and takes the screenshots in headless WebKit: no window opens, nothing is read from or written
outside this folder. It checks the folder's limits at the end (1280 px wide, none taller than 2,400 px, under 8 MB).

---

## 1. H-04 (#551): Night and Paper against today's look

**What changed.** The default dark becomes Night (true black, cool grey text) and the default light becomes Paper
(near-white, cool ink); today's warm dark and light stay as the Ink theme. Type is unchanged.

Dark (Night), `main` on the left of each row, #551 on the right:

| Page | main (today) | #551 |
| --- | --- | --- |
| README | ![](s1-main-dark-readme.png) | ![](s1-h04-dark-readme.png) |
| Long article (first 1600 px) | ![](s1-main-dark-article.png) | ![](s1-h04-dark-article.png) |
| Code-heavy page (first 1600 px) | ![](s1-main-dark-code.png) | ![](s1-h04-dark-code.png) |
| Split | ![](s1-main-dark-split.png) | ![](s1-h04-dark-split.png) |

Light (Paper):

| Page | main (today) | #551 |
| --- | --- | --- |
| README | ![](s1-main-light-readme.png) | ![](s1-h04-light-readme.png) |
| Long article (first 1600 px) | ![](s1-main-light-article.png) | ![](s1-h04-light-article.png) |
| Code-heavy page (first 1600 px) | ![](s1-main-light-code.png) | ![](s1-h04-light-code.png) |
| Split | ![](s1-main-light-split.png) | ![](s1-h04-light-split.png) |

The pages are `02-readme-real-world`, `01-long-technical`, `19-source-file` and `14-marxy-plan` beside the README,
from `fixtures/corpus`, at 20 px type.

**The type set's licence state.** Vendored now and bundled: Literata (roman and italic), Source Serif 4 (roman) and
JetBrains Mono, all SIL OFL 1.1 with each upstream licence verbatim in `fonts/` (`fonts/README.md`, "Licence audit
(H-04)"). IBM Plex Mono is vendored, not bundled. **Not bundled yet:** Atkinson Hyperlegible Next and Inter, the
sans faces of the Classic set (H-04.1). They need a download of the upstream releases and their `LICENSE` files, so
until you say yes the sans roles use the platform face.

**Question.** Night's pure black against cool grey text, and Paper's cooler ink: right? May the lead download
Atkinson Hyperlegible Next and Inter with their licences (H-04.1)?

**Recommendation.** Keep. You have already looked at it; this section keeps the record. Say yes to H-04.1, which
unblocks the rest of the look track.

verdict: keep (author, 2026-10-11)

verdict (H-04.1, the download):

---

## 2. Split: two documents side by side, the notice in a pane (Phase D)

**What changed.** A window can hold two documents, each with its own mode, scroll place and notices. Here the
README's notice about held images sits at the top of its own pane only.

| Dark | Light |
| --- | --- |
| ![](s2-split-dark.png) | ![](s2-split-light.png) |

**Question.** Does a notice read as belonging to its pane, and is the divider quiet enough?

**Recommendation.** Keep as is.

verdict:

---

## 3. The verb menu, All actions... and the palette's operations (E)

**What changed.** A right-click on a block selects it and opens a short menu of what applies, with its keys. When
more applies than fits, the last row is *All actions...*, which opens the palette on `>`. Typing after the `>`
narrows to operations such as *Align table pipes*.

| | Dark | Light |
| --- | --- | --- |
| Verb menu on a table | ![](s3-verb-menu-dark.png) | ![](s3-verb-menu-light.png) |
| *All actions...* (the palette on `>`) | ![](s3-all-actions-dark.png) | ![](s3-all-actions-light.png) |
| `>align` narrows to an operation | ![](s3-operations-dark.png) | ![](s3-operations-light.png) |

**Question.** Is a seven-row menu the right size, and does *All actions...* as a last row read as "more"?

**Recommendation.** Keep. The `>` list is long before it is filtered and starts with the file commands; the
selection's operations are found by typing.

verdict:

---

## 4. H-03.1: the palette and outline edges, light and dark

**What changed.** The palette's and the outline's edges now come from the contract v2 roles of the theme rather than
fixed values.

| | Dark | Light |
| --- | --- | --- |
| Palette | ![](s4-palette-dark.png) | ![](s4-palette-light.png) |
| Outline | ![](s4-outline-dark.png) | ![](s4-outline-light.png) |

**Question.** Are the edges (palette frame and underline, the outline's left edge and current-row bar) quiet enough
in both variants?

**Recommendation.** Keep.

verdict:

---

## 5. K-18: the kind glyphs in palette rows

**What changed.** Every document row in the palette leads with a glyph for its kind, decided from the path alone.
Crops at twice the density, top to bottom: a log, an **html page** (the second row, a window frame; its glyph is the
one flagged as a guess), a plain document, a README (open book), a changelog, data (braces), a diff, code, and a
note (pencil).

| Dark | Light |
| --- | --- |
| ![](s5-glyphs-dark.png) | ![](s5-glyphs-light.png) |

**Question.** Is the html window frame the right picture for html? Are log and changelog (three bullets and lines
against lines with ticks) too alike at 16 px? Also visible: a row without an age (the note) sits slightly left of
the others.

**Recommendation.** Keep the html glyph; if log and changelog read as one, redraw changelog.

verdict:

---

## 6. K-03: a task list is a `report`

**What changed.** Detection now reads a file's kind. A document that is a task list with no working headings
(Summary, Context, Risk, Next step, Open question, Verified, Recommendation) is detected as `report`. Nothing looks different until K-05 lands, when the
reader sees only a `data-marxy-kind="report"` attribute on the pane, which the default theme will start to use. The
page below is what the reader sees today, and so then; the detection is the text under it.

| Dark | Light |
| --- | --- |
| ![](s6-tasks-dark.png) | ![](s6-tasks-light.png) |

```
kind: report
tier 6 (decides): task list without working headings -> report at line 5
tier 7: nothing else fired -> article at launch-checklist.md
```

**Question.** Is "a task list means report" the right call, or should a checklist stay `article`?

**Recommendation.** Keep: it is a weak, last-tier signal, and two of those headings, a file name, a format, a reader's rule or a byline all outrank it.

verdict:

---

## 7. E-11: copy as plain text keeps list markers

**What changed.** *Copy as plain text (strip markdown)* drops the markup but keeps the structure that carries
meaning: list markers, task boxes, table rows. This is what it copies for the item *Attestation policy decided* of
`03-ai-plan` and its sub-items, taken from the app's clipboard call (`s7-copy-plain.txt`):

```
- [ ] Attestation policy decided
  - [ ] Accept none
  - [ ] Log AAGUID for analytics (no telemetry to third parties)
```

**Question.** Should a plain copy keep `- [ ]` and the two-space nesting, or give bare words?

**Recommendation.** Keep the markers: without them a pasted list is a column of unrelated lines.

verdict:

---

## 8. V-01: `⌃⇧→` and `⌃⇧B` over the macOS emacs defaults (no screenshot)

**What changed.** In Source on a Mac, V-01 binds the Control key chords below, and removes the editor's own
binding on the same chord so one press runs one thing. Both displace an emacs-style default.

| Key | Marxy (V-01) | What the editor did before |
| --- | --- | --- |
| `⌃⇧→` | expand selection: word, line, block, section, document | extend the selection by syntax (the Control-Right move, with Shift) |
| `⌃⇧B` | select the block at the caret | extend the selection one character backward (emacs `⌃B` with Shift) |
| `⌃B`, `⌃F`, `⌃N`, `⌃P`, `⌃A`, `⌃E`, `⌃K` | untouched | the emacs cursor keys stay |

Only the Shift variants of two chords are taken; plain `⌃B` and `⌃→` keep their emacs meanings. Outside a Mac the
operations are palette commands.

**Question.** Is losing "select one character back" on `⌃⇧B` and "select by syntax" on `⌃⇧→` acceptable for a
structural selection that works on any file?

**Recommendation.** Keep. The structural keys earn the chords, and the character selections stay on `⇧←` and `⇧→`.

verdict:

---

## 9. Source metrics: today's 18 on 30 px against V-12's 14 on 21 px

**What changed.** Today Source sets code at 18 px on a 30 px line (the prose grid). V-12 proposes 14 px on 21 px
(the incumbents are GitHub's 13 and VS Code's 1.5 leading). The `v12` pictures set only those two custom properties
on the page; nothing else about Source changes (wrapping is as it is today). A `.py` file, `04-source.py` from the corpus.

| | Today (18 on 30) | V-12 (14 on 21) |
| --- | --- | --- |
| Dark | ![](s9-source-today-dark.png) | ![](s9-source-v12-dark.png) |
| Light | ![](s9-source-today-light.png) | ![](s9-source-v12-light.png) |

**Question.** Is the tighter Source right, or is 14 on 21 too small to read for long?

**Recommendation.** Take V-12's numbers (they are K-R1, the default the lead is proceeding on), and veto here if
the second column is too small.

verdict:

---

## 10. The 16 rows waiting in `docs/taste-review/queue.d/`

One line each, grouped by area, linked to its row. The rows' own questions and defaults are in the linked files.
Where a row has its own picture it is linked after.

**Palette and index**

- [A-02](../queue.d/A-02.md): A 1 MB document shows its first two screens under a second
- [A-05](../queue.d/A-05.md): `Mod+P` lists documents at once from the last session index
- [A-06](../queue.d/A-06.md): Palette results rank by when you really read each document
- [A-12](../queue.d/A-12.md): The palette `>` list shows every applicable command with its key
- [A-13](../queue.d/A-13.md): `>` lists Toggle Rendered / Source, Back and Forward with keys
- [C-12](../queue.d/C-12.md): The empty palette: section names, ages and the changed mark

**Settings and navigation**

- [A-14](../queue.d/A-14.md): Light variant and text size from config apply at launch
- [A-15](../queue.d/A-15.md): The outline rail: headings at the right edge, current one marked

**Layout and the page**

- [B-02](../queue.d/B-02.md): The aesthetics gate photographs the real app; 14 baselines moved
- [B-02.2](../queue.d/B-02.2.md): Inline math no longer pushes the next block off the grid
- [B-03](../queue.d/B-03.md): Wide code and tables run into the article box margin, not the window
- [L-03](../queue.d/L-03.md): Narrow windows indent a list by the part of its hang the margin cannot hold ([narrow](../evidence/L-03-marks-narrow.png), [wide](../evidence/L-03-marks-wide.png))
- [MARXY-346](../queue.d/MARXY-346.md): Five new corpus pages render for the first time

**Operations and notices**

- [B-09](../queue.d/B-09.md): One plain notice for held remote images, with Dismiss ([screenshot](../evidence/B-09-notice-after.png))
- [E-09](../queue.d/E-09.md): Sort list items A to Z, box included
- [MARXY-231](../queue.d/MARXY-231.md): Task items opening with code, emphasis or a link regain a checkbox

Reply with `ok` per row, or the row's id and what to change.

verdict:
