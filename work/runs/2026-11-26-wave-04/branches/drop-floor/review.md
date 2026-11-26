# drop-floor: review (Opus)

**Verdict: ready.** No commits; tree clean at `ffb4cc7e`.

## Checked

- The 'a small document' refusal in `splicePageNow` and `INCREMENTAL_MIN_BYTES` are gone; no string or doc reaches them. Remaining "64 KB" mentions in `docs/`, `src/`, `registry.json` are other limits (`SLICED_BYTES`, `BLOCK_EDIT_CAP`, the tail read, long-runs). `docs/architecture.md` line 71 already describes the splice with no size limit.
- At open, small pages get their render record from `renderRecord`, the same path long pages used: the first edit after open splices from a whole-render record.
- Readings and derived views still refuse ('a reading is set whole'; `rerenderFromBuffer` gives readings their own record).
- Notices take merged whole-document removals.
- New blocks get `watchIslands`, `typeset.adopt` and `deferAfterComplete`: images, maths and diagrams drawn for them.
- No other size rule decides the splice; a page crossing 64 KB between edits matters only at open (which slices from 64 KB).

## Mutation

Floor put back as a one-line refusal under 64 KB: `splice-all` 8 pass, 1 fail (the new 25 KB Mod+Z test). The small-corpus chain test still passes (it calls `spliceRendered` directly: equality at small sizes, not the floor). Restored.

## Browser files run (two at a time, `--jobs 1`), pass/fail

- block-edit + store-undo 39/0
- operations-edit + undo-endings 31/0
- find-pane + jump-to-source-edits 24/1: the 1 MB find-typesetter timing test (31 s with find open against 4.7 s without), no edit in it; find-pane alone 14/14: load
- place-across-modes + data-loss 21/0
- paste-rendered + paste-source 51/0
- replace + progressive-large 14/0
- split-narrow + pane-set 29/0
- table-lens + transform-sheet 37/0
- source-structure + tail-follow 157/0
- demo-tour + notices-pill 34/0
- command-scope + scratch-document 22/0
- save-trust + progressive 18/0

The builder's verify (12 browser files including view-lifecycle, view-modes, typing, reading and transcript files) plus live-reload and mode-swap cover the rest. Typecheck, lint, check green on this tip in that verify.

## For later

- The find-pane typesetter timing test fails under load; it should count work instead of milliseconds.
- `splice-all.test.mjs` header still says "on a long page".

## Integration-found red, settled (Sonnet fixer)

`selection.test.mjs` "after the page fails to render a change, nothing stays selected" failed on this branch (found by typeset-view's verify; neither this branch's verify nor its review ran the file). Case (a): the test pinned the old path. A failure inside the splice is caught by `splicePage`, which falls back to the whole render; only if that also fails does `showRenderFailure` run and call `selection.clear()`. The old one-shot `article.querySelectorAll` throw was only hit by the whole render. Test now makes `article.removeChild` (splice) and `article.querySelectorAll` (whole render) throw until the commit settles, asserts both warnings and selection 'none'. Mutation: removing `selection.clear()` fails it. Commit `8395ac8d` (test only). Also run: live-reload + block-edit 64/64, mode-swap + progressive-large 32/32, reading-root-lookup 3/3, selection + splice-all 20/20; typecheck, lint, check green. No verify turn.
