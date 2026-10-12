# Card X-19: a design pass on how notifications, errors and command-opened surfaces reach the reader

**In short.** Marxy says things to the reader in three ways today: a one-line **notice** in flow above each pane's article,
a **fixed-position sheet** (Transform, Clipboard, palette, outline), and a **native close confirmation**. They grew one
feature at a time and nothing states which kind of news belongs where. The author asked on 2026-10-11 to "defer doing too
much with the popups before doing a full design pass of how notifications and errors should be yielded to users.
Clipboard might end up with some fun special interface ux." This card frames that pass. **It decides nothing**: it lists
what exists, the constraints any answer must meet, the questions only the author can answer, and what the pass produces.
Written against `origin/main` at `feae5b61`.

Also from the author, the same day: "It's a violation of expectation for us to be inserting anything into a document
(distant special cases notwithstanding)." Read with ADR-0052 (*Faithful*: Marxy changes exactly what the reader asked),
this rules out any answer that puts a notice, banner or hint into the reading column's flow or into the document's text.

## Known facts

- **Notices sit in flow.** `notices/index.ts` makes a `[role=status]` region at the top of each `section.marxy-pane`
  (`docs/design/09-app-shell.md` §Notices); a notice pushed the text down by 44.5 px. F-45's guard
  (`apps/desktop/test/no-displacement.test.mjs`) covers sheets, popups, menus and pickers and **names notices as not
  covered, on purpose**, for this pass and W-04.1 to own. **F-46 floats the region** (positioning only; no new
  behaviour, no new kinds). It is a stopgap, not the answer.
- **W-04.1 is paused** in `~/Dev/marxy-wt/W-04.1` (uncommitted: `chrome-surfaces.test.mjs`, `05-theme.md`, eight
  macOS baselines). Its card ("Notices on the chrome spec, with their baselines") was left out of W-04 because it moved
  notice heights. It restyles what this pass may re-place, so it waits.
- **The Transform and Clipboard sheets are fixed-position modals** (`transform/sheet.ts`: `role=dialog`,
  `aria-modal=true`, an inner `role=status` line). The palette and outline are `role=dialog` too. None displaces text.
- **The clipboard may get its own interface** (author: "fun special interface ux"). Today its news is notices from
  `commands/paste.ts`, `copy-write.ts`, `copy-as.ts`, `transform-clipboard.ts` and a sheet.
- Chrome spec: `docs/research/reader-artifacts/10-spec.md`; chrome at rest is zero (ADR-0050, restated by ADR-0052);
  workspace regions are in ADR-0058.

## Inventory: what the reader is told today

Counted on `feae5b61`: **33** `ctx.showNotice(` calls (20 transient), **43** other `notify(` / `say(` calls, in
`apps/desktop/src`; the table groups them by what the news is about. Only two kinds exist in code
(`NoticeKind = 'blocked' | 'info'`); *all* refusals and errors are `info`. A notice dismisses by its **Dismiss** button
(mouse; a Tab stop), by a 4 s timer when `transient`, by the same words arriving again (replaces), or by opening a
document in that pane (clears that pane's notices). Nothing dismisses on Esc, and nothing is spoken other than through the
region's `role=status`.

| Group | What | Where it appears | Persistence / dismissal | Source |
| --- | --- | --- | --- | --- |
| Data safety | File changed on disk, edits kept; file removed on disk | pane notice | persistent; Dismiss; the first is replaced by the choose-version line | `notices/disk.ts` |
| Data safety | Source in the other pane changed this file; text not folded in (D-11) | pane notice | persistent; Dismiss | `notices/index.ts` (`SOURCE_HELD_APART`), `save.ts`, `close.ts`, `rendered-view.ts`, `commands/document.ts` |
| Data safety | Save failed; save-a-copy failed ("Nothing was changed; your edits are still here") | pane notice | persistent; Dismiss | `save.ts`, `commands/document.ts` |
| Data safety | Unsaved changes on open or pane close: Save / Discard / Dismiss | pane notice with three actions (the decision lives here); window close uses the **native** `shell.confirmClose` | persistent until chosen; Dismiss stops the action | `close.ts` (`confirmLeaveDocument`, `confirmClosePane`) |
| Data safety | Block editor could not keep the edit; changed underneath | pane notice | persistent | `commands/block-edit.ts` |
| Data safety | Trust: config unreadable, newer version, write failed, unsaved doc stays blocked | pane notice | persistent | `trust/controller.ts`, `commands/trust.ts` |
| Data safety / content | Blocked content: images held, HTML simplified, truncation; action "Show this document's HTML" | pane notice, up to two actions | persistent per document; Dismiss hides until next open | `notices/blocked.ts`, `docs/design/13-trust.md` |
| Refusals | Open, split, compare, Open beside refused (other pane has unsaved changes; window too narrow; same document; two-documents-only) | pane notice | persistent | `document/open.ts`, `commands/pane-open.ts`, `pane-split-same.ts`, `view-mode.ts`, `compare.ts`, `selection/view.ts` |
| Refusals | Link refused (scheme, not found, not text) | pane notice | persistent | `selection/view.ts` |
| Refusals | Clipboard refused / no clipboard access / nothing to paste / nothing to transform / nothing to copy | pane notice (some transient) | mixed | `commands/paste.ts`, `transform-clipboard.ts`, `copy-as.ts`, `copy-text.ts` |
| Refusals | External editor failed to open | pane notice | persistent | `commands/editor.ts` |
| Errors | A command threw ("X did not run: ..."); transform failed ("The document is unchanged") | pane notice (transform: transient) | mixed | `selection/bind.ts`, `commands/edits.ts`, `commands/transform.ts` |
| Errors | config.toml could not be updated | pane notice | persistent | `commands/appearance.ts`, `source-view.ts`, `theme/app-config.ts` |
| Errors | Theme warnings; "Use this theme" offer | pane notice with action | persistent | `theme/user-theme.ts` |
| Progress / outcome | Operation summary, Copy done ("Copied as X, 4 KB"), Applied / Pasted-and-converted, Showing HTML | pane notice | transient 4 s; Dismiss | `selection/apply.ts`, `commands/copy-write.ts`, `transform/sheet.ts`, `paste.ts`, `notices/blocked.ts` |
| Progress / outcome | Scratch document opened; BOM kept | pane notice | transient | `document/scratch.ts` |
| Information | Index skipped folders macOS protects; index truncated; collection load result | pane notice (app-level: focused pane) | persistent | `index/service.ts`, `collection/load.ts`, `commands/collection.ts` |
| Information | Layout restore, kind changed | pane notice | persistent | `layout/restore.ts`, `commands/kind.ts` |
| Surfaces (not notices) | Transform sheet, Clipboard sheet | fixed modal `role=dialog`, own `role=status` line | Esc / buttons; focus trapped | `transform/sheet.ts` |
| Surfaces (not notices) | Palette, outline | `role=dialog` | Esc | `palette/view.ts`, `outline/view.ts` |
| Surfaces (not notices) | Find count | `aria-live=polite` inside the find bar | with the bar | `find/view.ts` |
| Surfaces (not notices) | Window close with unsaved changes | native dialog | OS | `close.ts` |

Totals: **76** notice call sites in code, in **5** groups of news (data safety, refusals, errors, progress, information) plus **4** non-notice surfaces; **2** `NoticeKind`s;
**1** region per pane; **0** audible or OS-level notifications; **0** history.

## Constraints (any answer must meet these)

1. **Never displace the text.** No notice, error or hint changes the position of the reading column or the line under
   the reader's eye; F-45's guard is extended to cover whatever the pass chooses.
2. **Faithful to the bytes.** Nothing is inserted into a document or its Source text, and a message never claims a
   change the bytes do not show. A refusal says what was not done and that the file is unchanged.
3. **No telemetry, no network** (ADR-0052 *Private*). Error text is shown, never sent; no crash reporter, no "report this".
4. **Accessible.** What is shown is also announced: `aria-live` (polite for outcomes, assertive only where the reader must
   act), focus is not stolen except by a decision the reader must make, contrast and forced-colors hold, and motion
   respects reduced-motion.
5. **Keyboard reachable.** Every notice and its actions are reachable and dismissible without a pointer, with a stated
   key; a decision surface can be answered from the keyboard.
6. **Chrome at rest is zero** (ADR-0050). Nothing is drawn until there is news.
7. **Split windows.** A notice about a file shows with the file's pane (D-10); a pane is never made to shift for the
   other's news.

## Open questions for the author

1. **One notice region for the window, or one per pane?** Today one per pane, so a split window can say two things. A
   single window region is quieter but cannot say which file the news is about.
2. **Transient or persistent?** What may fade by itself (today: 20 of 33 command notices, at 4 s), what must stay until
   the reader acts, and whether a transient notice can be recalled.
3. **Where does an error that needs a decision live?** Save / Discard on leaving is a pane notice now; window close is a
   native dialog. Keep a notice with actions, a sheet, or an inline strip at the edge of the pane?
4. **Does the clipboard get a dedicated surface?** Copy, Copy as, Paste, Transform clipboard and "Pasted and converted"
   all speak through notices today. A clipboard-shaped surface (what is on it, what was copied) could replace five kinds
   of notice and the Clipboard sheet.
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
11. **Wording:** one voice and one template ("what happened, what is unchanged, what to do") across 76 strings?

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
- Any new popup, toast or notice: held until the ADR is accepted, apart from F-46's positioning and fixes to wrong text.

| Field | Value |
| --- | --- |
| **Model / effort** | opus (high) for the ADR and mocks; the inventory is done here |
| **Size** | M |
| **State** | needs author (questions above) |
| **Review** | the author, in the taste walk |
