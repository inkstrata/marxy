# geometry-table: first review (Sonnet)

Saved by the orchestrator, 2026-11-26.

Verdict: ready after the reviewer's own fix (one test-only commit). Tip `8277b4e6` on `57fca039`. Verify turn on it 12/12 (browser 510, desktop 1270, core 4248). typecheck, lint, check green on `57fca039`, not rerun on `8277b4e6` (test file only). Tree clean.

**Checked**
- Full diff read. `currentPosition`, scroll-top-for-position, saved position, `view.position()`, spine, `holdPlace`, `holdAnchor` all go through the table. Remaining list reads: the derived (transcript) view by design, and tests.
- `block-list.ts` and `colour-reports.ts` not reached by string. No process ids in diff or commit subjects. Docs match the code.
- The differential test compares every entry's top and height, plus places and scroll tops, to a fresh whole-list measurement after open, mount, type, code colour, image sized, splice, narrower and wider pane, theme, Source and back, and a second document; also at each notification. Fails when stale: removing the inner-block reset on resize fails it, as does keeping the offsets.

**Mutations**
- Spine unit test: removing the start-byte guard fails 1; ignoring the finer lookup fails 1.
- Dropping the "unmeasured after a gap" flag in `rebuild` survived the builder's tests (a block taken out above blocks of unchanged size). Reviewer added the step "a block taken out" to `block-geometry.test.mjs`; it passes on the tip and fails under that mutation.

**To file for later**
- A margin-only change (a theme or rule changing spacing but no block's size) leaves the table stale, since only size changes are notified; untested (the theme step changes font size and line height). Cheap fix: check the last entry's bottom against the page when only the article moved.
- Two panes on one document, and a hidden article shown again: untested (each view has its own table; code looks right).
- `check:tauri` not run.
