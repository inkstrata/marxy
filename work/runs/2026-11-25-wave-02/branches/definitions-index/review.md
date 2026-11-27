# definitions-index: first review (Sonnet)

Reviewer started 16:55, the only reviewer in the tree. Saved by the orchestrator from the reviewer's text report. A second, fresh Opus review follows.

**Verdict: ready after its fix** (`a6b0e42a`, tests only). The worktree is clean at `a6b0e42a`.

**Checks**, all green on `a6b0e42a`:

- typecheck, lint, `pnpm check` 10/10.
- Core suite 4320 pass.
- `test:spec` and `gate:golden` pass.
- `undo-endings.test.mjs` alone: 22/22.
- Verify turn 9/9, browser 120/120.

**Mechanism read against micromark's source:**

- Link definitions are pushed only in `definition.js`, on success. Link lookups happen only in `label-end`, in text. Footnote lookups happen only in text (call and potential call). The footnote definition only pushes, and dedupes with `includes`.
- The construct is tried before the extensions it follows, so seeding lands before any lookup.
- Rule 2 (`agrees`): `rule2.mts` ran 30,000 documents, 88,584 slices, 0 disagreements. It is a backstop the reviewer could not trigger.

**Independent differential** (`review-2\fuzz.mts`: character-level fuzz, chained edits, CRLF and BOM): 13,373 cases, 7,947 by region, 0 mismatches. Windows of corpus files with definitions: 360 cases, 0 mismatches. The builder's index differential: 0 over thousands more.

**Mutations**, each rerun alone and restored:

- `indexNotMoved`, `tailCheckSkipped`: killed.
- `noHookDoc`: survived, which showed a missing test. The document hook is the only thing that makes the hook run for a file holding only footnote definitions. Without it, such a file gets an `unknown` index and every reparse is whole (verified). The reviewer added `assertCase` cases for a footnote definition and for a link definition no text refers to; `noHookDoc` now fails.
- `noHookContent`: still survives and could not be made to fail. In 12,000+ seeded region parses plus 30,000 probe inputs, the document hook alone never lets a link label be pushed before the seed. Kept as a harmless backstop; it could go, but there is no proof either way.
- `agreesAlways`: still survives. Defensive and unreachable, as above. Keep.
- `freshPlain`: survived. The leftover patch from the stopped review was right, so the reviewer added it; the mutant now fails it.

**Fixes:** `a6b0e42a` adds those two tests plus the leftover one. No source change.

**For later:**

- The whole parse can push a link label before the document hook in some inputs. Harmless, since the index compares multisets.
- `parseMarkdownChunked` still parses whole when a file has definitions, as the builder says.
- The plan's claim that this unblocks sliced opening needs correcting.

## Orchestrator's notes

- Checked: the branch is `064bf53f`, `a6b0e42a` (committed 17:34:57; 10 lines added to `reparse.test.ts`). `definitions-index-verify.log` is a turn started 17:43:26, so after the fix: 9/9, exit 0 at 17:51:38. The tree is clean.
- The plan's sliced-parse claim is already corrected at the top of `marxy-plan-harder-waves.md` (the "24 November, evening" note). Line 82's original sentence still stands below it as written, which is how corrections are kept there.
- Second review: a fresh Opus reviewer, told to try to break the mechanism, especially the two survivors (`noHookContent`, `agreesAlways`). Goes to Ian afterwards.

# definitions-index: second review (Opus, told to break it)

Saved by the orchestrator from the reviewer's text report.

**Verdict: ready.** No counterexample found and nothing committed. The worktree is clean at `a6b0e42a`.

**Checks on the tip:** typecheck, lint and `pnpm check` (10/10) pass. The core suite passes 4320, with 0 failures and 3 skipped (run with `--test-concurrency=4`). No verify turn: nothing changed since the 9/9 run on `a6b0e42a`.

**Its own differential search** (`review-3\`). Each step is held to `parseMarkdown`, and so is the definition index the reparse carries forward.

- **`adv.mts`:** generated files with definitions inside quotes, lists, footnote bodies and nested containers.
  - Covers lazy lines, setext lines under definitions, titles and destinations spanning lines, labels that differ only by Unicode case folding (ẞ/ß/ss/SS, ǅ/Ǆ, İ, Kelvin K, σ/ς/Σ, ﬀ/FF) or by whitespace, duplicate labels, tables, fences, indented code, HTML, CRLF, CR, mixed endings, BOM and tabs.
  - Edits swap labels, toggle blank lines, add or remove container prefixes and indents, insert definition lines, setext lines and titles, and delete bytes. Each file takes 20 to 25 chained edits.
  - Result: 147,140 edits, 84,950 by region, 0 tree mismatches, 0 index mismatches.
- **`exhaustive.mts`:** 14 seam documents, each padded so regions get taken. Every 16-character insertion and every 1- and 2-byte deletion at every position, each then undone from the reparse. Result: 86,748 cases, 56,390 by region, 0 mismatches.
- **`phantom.mts`:** 150,000 random short inputs, 9,339 of them with definitions. micromark's label lists never disagreed with the tree's definitions.
- **Sanity check:** the search does catch a real break. With `noSeedLinks` applied, `adv.mts` reported 382 mismatches and `exhaustive.mts` 7,559.

**The two surviving mutations.** Both are unreachable, and neither can cause a wrong tree.

- **`noHookContent`:** the region count was the same with and without it (4,664 of 7,864).
  - micromark's `document.js` checks for new containers at every line start that is not inside fenced code, HTML or math. It skips up to 3 spaces, then tries the `document[91]` hook. Every definition starts on such a line, so that hook has always run before any label is pushed. Lookups happen only in text, after all the flow.
  - Even if this were wrong, a late seed would only make `agrees` false and send the reparse whole.
  - It can be deleted, or kept with that comment.
- **`agreesAlways`:**
  - A link label is pushed only when a definition succeeds (`definition.js:202`). Content is tried only as the fallback in `flow.js`, never inside a check or an attempt that is later undone.
  - A footnote label is pushed once `:` is consumed (`syntax.js:478`), and the container then always succeeds, so the attempt that follows the check succeeds too.
  - So a pushed label always has a definition in the tree, and the reverse. Keep it as a cheap backstop, with that comment.

**For later:** in `freshAmong`, the indented-code guard repeats one that `fresh()` already applies; removing it changed nothing. These comment and cleanup changes can wait for the next change to `parse.ts` and `reparse.ts`.

## Orchestrator's notes (second review)

- Checked: the tree is clean at `a6b0e42a`. Both reviews say ready, so the branch is ready to bring to Ian.
- Nothing yet shows the reader the gain: the page update still refuses on footnotes until `footnote-splice`.
