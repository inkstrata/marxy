# Card X-19: a design pass on how notifications, errors and command-opened surfaces reach the reader

**In short.** Marxy says things to the reader in three ways today: a one-line **notice** in flow above each pane's article,
a **fixed-position sheet** (Transform, Clipboard, palette, outline), and a **native close confirmation**. They grew one
feature at a time and nothing states which kind of news belongs where. The author asked on 2026-10-11 to "defer doing too
much with the popups before doing a full design pass of how notifications and errors should be yielded to users.
Clipboard might end up with some fun special interface ux." This card frames that pass. **It decides nothing**: it lists
what exists, the constraints any answer must meet, the questions only the author can answer, and what the pass produces.
Written against `origin/main` at `5c561ef8`.

Also from the author, the same day: "It's a violation of expectation for us to be inserting anything into a document
(distant special cases notwithstanding)." Read with ADR-0052 (*Faithful*: Marxy changes exactly what the reader asked),
this rules out any answer that puts a notice, banner or hint into the reading column's flow or into the document's text.

## Known facts

- **Notices sit in flow.** `notices/index.ts` makes a `[role=status]` region at the top of each `section.marxy-pane`
  (`docs/design/09-app-shell.md` §Notices); a notice pushed the text down by 44.5 px (the author's measurement, 2026-10-11; not yet in the ledger). F-45's guard
  (`apps/desktop/test/no-displacement.test.mjs`) covers sheets, popups, menus and pickers and **names notices as not
  covered, on purpose**, for this pass and W-04.1 to own. **F-46 floats the region** (positioning only; no new
  behaviour, no new kinds). F-46 is in flight and has no ledger row on `origin/main` yet; whether it is the answer or a
  stopgap is for this pass.
- **W-04.1 is paused** (the ledger says `ready`; it has not been dispatched again) in `~/Dev/marxy-wt/W-04.1` (uncommitted: `chrome-surfaces.test.mjs`, `05-theme.md`, eight
  macOS baselines). Its card ("Notices on the chrome spec, with their baselines") was left out of W-04 because it moved
  notice heights. It restyles what this pass may re-place, so it waits.
- **The Transform and Clipboard sheets are fixed-position modals** (`transform/sheet.ts`: `role=dialog`,
  `aria-modal=true`, an inner `role=status` line). The palette and outline are `role=dialog` too. None displaces text.
- **The clipboard may get its own interface** (author: "fun special interface ux"). Today its news is notices from
  `commands/paste.ts`, `copy-write.ts`, `copy-as.ts`, `transform-clipboard.ts` and a sheet.
- Chrome spec: `docs/research/reader-artifacts/10-spec.md`; chrome at rest is zero (ADR-0050, restated by ADR-0052);
  workspace regions are in ADR-0058.

## Inventory: what the reader is told today

Counted on `5c561ef8` with one command, run from the repository root (rerun it; a written count goes stale):

```sh
git grep -nP '(showNotice|notify|say)\(' -- apps/desktop/src ':!*.test.*'
```

It matches **129** lines: **4** are definitions (`commands/registry.ts:29`, `notices/index.ts:77`, `selection/bind.ts:78`,
and `transform/sheet.ts:429`, the sheet's own status line), leaving **125** call sites. Of those, **33** are
`ctx.showNotice(` (20 with `transient`); the rest are `notify(` and the local `say(` wrappers (`commands/kind.ts` 19,
`commands/collection.ts` 13, `source/paste.ts` 10, `transform/sheet.ts` 8, `commands/block-edit.ts` 8). Several sites share
one message, so the rows below group by what the news is about, not by site. Only two kinds exist in code
(`NoticeKind = 'blocked' | 'info'`); *all* refusals and errors are `info`. A notice dismisses by its **Dismiss** button
(mouse; a Tab stop), by a 4 s timer when `transient`, by the same words arriving again (replaces), or by opening a
document in that pane (clears that pane's notices). Nothing dismisses on Esc, and nothing is spoken other than through the
region's `role=status`.

| Group | What | Where it appears | Persistence / dismissal | Source |
| --- | --- | --- | --- | --- |
| Data safety | File changed on disk, edits kept; file removed on disk | pane notice | persistent; Dismiss; the first is replaced by the choose-version line | `notices/disk.ts`, `document/live-reload.ts` |
| Data safety | Source in the other pane changed this file; text not folded in (D-11) | pane notice | persistent; Dismiss | `notices/index.ts` (`SOURCE_HELD_APART`), `save.ts`, `close.ts`, `rendered-view.ts`, `commands/document.ts` |
| Data safety | Save failed; save-a-copy failed ("Nothing was changed; your edits are still here") | pane notice | persistent; Dismiss | `save.ts`, `commands/document.ts` |
| Data safety | Unsaved changes on open or pane close: Save / Discard / Dismiss | pane notice with three actions (the decision lives here); window close uses the **native** `shell.confirmClose` | persistent until chosen; Dismiss stops the action | `close.ts` (`confirmLeaveDocument`, `confirmClosePane`) |
| Data safety | Block editor could not keep the edit; changed underneath | pane notice | persistent | `commands/block-edit.ts` |
| Data safety | Trust: config unreadable, newer version, write failed, unsaved doc stays blocked | pane notice | persistent | `trust/controller.ts`, `commands/trust.ts` |
| Data safety / content | Blocked content: images held, HTML simplified, truncation; action "Show this document's HTML" | pane notice, up to two actions | persistent per document; Dismiss hides until next open | `notices/blocked.ts`, `docs/design/13-trust.md` |
| Refusals | Open, split, compare, Open beside refused (other pane has unsaved changes; window too narrow; same document; two-documents-only) | pane notice | persistent | `document/open.ts`, `commands/pane-open.ts`, `pane-split-same.ts`, `view-mode.ts`, `compare.ts`, `selection/view.ts` |
| Refusals | Link refused (scheme, not found, not text) | pane notice | persistent | `selection/view.ts` |
| Refusals | Clipboard refused / no clipboard access / nothing to paste / nothing to transform / nothing to copy; in Source, paste refused, the text moved, converted, nothing to paste | pane notice (some transient); Source paste through its own `say` | mixed | `commands/paste.ts`, `transform-clipboard.ts`, `copy-as.ts`, `copy-text.ts`, `source/paste.ts` |
| Refusals | External editor failed to open | pane notice | persistent | `commands/editor.ts` |
| Errors | A command threw ("X did not run: ..."); transform failed ("The document is unchanged") | pane notice (transform: transient) | mixed | `selection/bind.ts`, `commands/edits.ts`, `commands/transform.ts` |
| Errors | config.toml could not be updated | pane notice | persistent | `commands/appearance.ts`, `source-view.ts`, `theme/app-config.ts` |
| Errors | Theme warnings; "Use this theme" offer | pane notice with action | persistent | `theme/user-theme.ts` |
| Progress / outcome | Operation summary, Copy done ("Copied as X, 4 KB"), Applied / Pasted-and-converted, Showing HTML | pane notice | transient 4 s; Dismiss | `selection/apply.ts`, `commands/copy-write.ts`, `transform/sheet.ts`, `paste.ts`, `notices/blocked.ts` |
| Progress / outcome | Scratch document opened; BOM kept | pane notice | transient | `document/scratch.ts` |
| Information | Index skipped folders macOS protects; index truncated; collection load result | pane notice (app-level: focused pane) | persistent | `index/service.ts`, `collection/load.ts`, `commands/collection.ts` |
| Errors | Kind settings (`kinds.json`, `config.toml`) could not be read, written or applied (the largest family, about 19 sites) | pane notice | persistent | `commands/kind.ts` |
| Information | Layout restore | pane notice | persistent | `layout/restore.ts` |
| Surfaces (not notices) | Transform sheet, Clipboard sheet | fixed modal `role=dialog`, own `role=status` line | Esc / buttons; focus trapped | `transform/sheet.ts` |
| Surfaces (not notices) | Palette, outline | `role=dialog` | Esc | `palette/view.ts`, `outline/view.ts` |
| Surfaces (not notices) | Find count | `aria-live=polite` inside the find bar | with the bar | `find/view.ts` |
| Surfaces (not notices) | Window close with unsaved changes | native dialog | OS | `close.ts` |

Not in the table by design: `harness/test-hooks.ts` (test harness). What does not exist: audible or OS-level
notifications, and any history of past notices (checked by reading the notices module; no counts claimed).

## Constraints

Items 1 to 3 restate AGENTS.md and ADR-0052 (*Faithful*, *Private*) and item 6 ADR-0050. Items 4, 5 and 7 are **proposed** here
for the author to accept; they are not yet rules.

1. **Never displace the text.** No notice, error or hint changes the position of the reading column or the line under
   the reader's eye (F-45's guard covers sheets and menus; whether it also covers notices is a deliverable question).
2. **Faithful to the bytes.** Nothing is inserted into a document or its Source text, and a message never claims a
   change the bytes do not show. A refusal says what was not done and that the file is unchanged.
3. **No telemetry, no network** (ADR-0052 *Private*). Error text is shown, never sent; no crash reporter, no "report this".
4. **Accessible** (proposed). What is shown is also announced: `aria-live` (polite for outcomes, assertive only where the reader must
   act), focus is not stolen except by a decision the reader must make, contrast and forced-colors hold, and motion
   respects reduced-motion.
5. **Keyboard reachable** (proposed). Every notice and its actions are reachable and dismissible without a pointer, with a stated
   key; a decision surface can be answered from the keyboard.
6. **Chrome at rest is zero** (ADR-0050). Nothing is drawn until there is news.
7. **Split windows** (proposed). A notice about a file shows with the file's pane (D-10); a pane is never made to shift for the
   other's news.

## Open questions for the author

1. **One notice region for the window, or one per pane?** Today one per pane, so a split window can say two things. A
   single window region is quieter but cannot say which file the news is about.
2. **Transient or persistent?** What may fade by itself (today: 20 of 33 command notices, at 4 s), what must stay until
   the reader acts, and whether a transient notice can be recalled.
3. **Where does an error that needs a decision live?** Save / Discard on leaving is a pane notice now; window close is a
   native dialog. Options: keep a notice with actions; a sheet; an inline strip at the edge of the pane; none of these, or leave as is.
4. **Does the clipboard get a dedicated surface?** Copy, Copy as, Paste and Transform clipboard speak through
   notices and one sheet today. Options: (a) keep notices and the sheet as they are; (b) a clipboard-specific surface
   for what was copied or pasted; (c) fold it into whatever general surface question 3 picks; (d) something else.
5. **Do refusals and errors differ in kind and look from outcomes?** Today every refusal is `info`. Should the
   reader be able to tell "not done" from "done" at a glance, and without colour?
6. **Sound or OS notification?** None today. Never, or an opt-in for long jobs (index, large transform)?
7. **Is there a history of past notices?** A transient notice is gone for good. A recallable list (palette command) is
   one answer; none is another. It must stay on the machine and be bounded.
8. **Where does progress for slow work appear?** Index walk, large open and transform currently have no indicator;
   should one exist, and is it part of this region or separate?
9. **How does a notice about the app, not a file, show in a split window?** Today the focused pane's; a window-level
   place may be better.
10. **Keys:** one key to dismiss, one to focus the newest notice, one to recall? Esc is taken by peeks (W-03), find and
    sheets.
11. **Wording:** one voice and one template ("what happened, what is unchanged, what to do") across the strings in the inventory?
12. **What counts as "too much" popup work while the pass runs?** The author asked to defer it; say whether bug fixes to wrong
    text, F-46, and notice-only changes proceed, or everything waits.

## Deliverables of the pass

- **An ADR** (next free number) stating where each kind of news appears, how it is dismissed, how it is announced, and
  what stays out of the document; it amends `docs/design/09-app-shell.md` §Notices and names the chrome-spec entry in
  `docs/research/reader-artifacts/10-spec.md`.
- **Taste-review artifacts** in `docs/taste-review/`: the mock-ups for the author's judgement (notice, refusal, decision,
  clipboard surface, split window, narrow window, dark and forced-colors) built from the real stylesheet, one page the
  author can walk in one sitting.
- **A verification plan**: F-45's guard extended to notices and errors; an aria-live walk (VoiceOver); a keyboard walk;
  a string audit of the inventory above.
- **Follow-up cards**, written after the author rules, to implement the ADR in slices; no code in the pass itself.

## What this unblocks

- **W-04.1** (notices on the chrome spec, with baselines): resumes once the ADR fixes where notices live and what they
  look like; until then its worktree stays paused.
- **Clipboard UX** (the dedicated surface, and J-series paste and copy follow-ups): waits on question 4.
- New popup, toast or notice work: the author asked to defer "doing too much with the popups" before this pass; what counts
  as too much is the author's to say (question 12).

---

### X-19 — Design pass: how notifications, errors and command-opened surfaces reach the reader

**Model:** opus (high) for the ADR and mock-ups · **Size:** M · **Depends on:** the author's answers to the questions
above · **Parallel with:** nothing that adds popups; F-46 (positioning only) is unaffected.

**Outcome.** The deliverables above exist and the author has ruled on each question; the stories under "What this unblocks"
can then be carded. This file is the framing card, so it also holds the inventory and questions that a code card would not;
the format otherwise follows `15-cards-wave-8.md`.

**Why now.** The author asked on 2026-10-11 to defer popup and notice work until this pass is done.

**Paths.** *New:* `docs/adr/<next number>-*.md`, `docs/taste-review/2026-10-notifications/`. *Edited:*
`docs/design/09-app-shell.md` §Notices, `docs/research/reader-artifacts/10-spec.md` (if the ADR says so). No `src/` files.

**Done-check.** The ADR is accepted by the author; each of the 12 questions has a recorded answer or an explicit "not
now"; the inventory is regenerated with the grep above and has no row without a decided home; the ledger row X-19 moves
from `needs author` to `merged`.
