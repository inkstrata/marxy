# Lead handoff: the 2026-10-08 round, stopped at the author's request

**For:** the next lead session, and the author. **Read with:** `00-orchestration.md` §3 to §6, then `progress.md`,
then the phase documents the stories below name. This page says what to do next.

## Where things stand (2026-10-08, evening)

The author asked the lead to run the implementation cycle, then to stop gracefully. Twenty-five pull requests merged
this round, each after an Opus review that the lead acted on (the ledger has the detail): C-06, B-15, C-10.1, C-11.2,
C-13, C-13.1, C-17 (Phase C is complete), F-17.1, F-19, F-19.1, F-19.2, F-19.3, F-20, B-16, B-16.1, B-17, B-17.1,
B-23, B-25, L-02, L-02.1, L-03, D-01, D-04, D-05; and the plan PRs #455 and #477.

Large documents, the author's first priority, moved most:

- A live reload of a 1 MB document dropped from 5.4 s to about 0.2 s (B-23, incremental reparse; two adversarial
  reviews, about 475,000 fuzzed edits, no mismatch).
- The first full mount of a transcript-shaped document was cubic: 59 s at 256 KB, over 11 minutes at 1 MB. With B-25
  merged and B-25.1 open, it is 0.8 s and about 4 s. **B-25.1 (#479) is the next merge to land.**

## Open pull requests, and what each needs

| PR | Story | State | Next |
| --- | --- | --- | --- |
| #479 | B-25.1 | review was stopped | a fresh Opus review (brief: the sanitiser keeps `language-*` on `pre` for every language name; goldens moved only by the attribute; captions unchanged; re-measure), then merge |
| #475 | D-06 | fixed after return 1; re-review stopped | a fresh re-review of `14473ac1` (check the `dialog[open]` rule does not block pane focus while a notice shows), then merge |
| #480 | F-20.1 | review stopped just after it reported "an introduced divergence" against commonmark.js | **do not merge**; re-review, comparing CR-heavy inputs against commonmark.js 0.31.2 |
| #470 | F-21 | returned twice on Sonnet | re-run on Opus after D-08 merges (it needs an `onCommitted` hook in `document/open.ts`, which D-08 is editing); the second review describes the race |

## Stopped mid-work: resume in the worktree

Each was stopped with uncommitted work. Read `git diff` in the worktree before continuing; do not `git stash` (the
stash is shared across worktrees).

| Story | Worktree | Model | What is there |
| --- | --- | --- | --- |
| D-08 | `../marxy-wt/D-08` | opus | close, save, title and quit for two documents; most files edited, test file written; the pane/index.ts title listener and the command were next |
| B-26 | `../marxy-wt/B-26` | opus | the typesetter's keep-place reads the pane's scroller; implemented, mutations were running |
| F-23 | `../marxy-wt/F-23` | sonnet | CRLF position helpers (`source/cm-position.ts`) and their use; tests written |
| F-24 | `../marxy-wt/F-24` | sonnet | a CR-only file's line separator; test written, precheck was running |

## Next, in order

1. Land #479 (B-25.1), #475 (D-06); re-review #480.
2. Finish D-08, then F-21 on Opus; then D-07 (the D-05 review's stale-offset fix is on its card), D-11, D-13 (each
   after D-06), and B-24 (re-render only what a reload changed; after F-23 lands, same file).
3. F-23, F-24, B-26; then F-22 (ordered lists; after B-25.1, same file `base.css`), B-18 (after D-08: `app.ts`).
4. A-11.2 waits for G-03 (#450, lane G's session).
- **Cap:** four implementors, at most two on Opus. Reviews are not capped, and every one this round found something.

## Waiting on the author

1. **Code-owned files**, which the lead cannot merge:
   - **B-16.1:** `nightly.yml`'s perf job still builds `dist/`, which it no longer uses.
   - **L-02.1:** the probe tests' nightly step (the YAML is in #469's body).
   - **B-23:** a nightly `pnpm --filter @marxy/core test:reparse-stress`.
   - **B-25:** the transcript step (YAML in #471's body).
   - **`release.yml`:** it runs `gate:bundle` after `tauri-action` has published; move it before.
   - Merge #394 and #407.
2. **Decision 4 (classic scrollbar):** L-03 measured macOS and Linux and recommends no root rule. The measurement was
   at 20 px type only; the overflow range grows with size.
3. **Rulings carried from earlier:**
   - L-01 decisions 6, 7 and 9;
   - ADR-0053, ADR-0054, ADR-0055 and now ADR-0057 (proposed);
   - the image-scope ceiling;
   - a Rust-owned root allow-list for `read_file` and `search_content`.
4. **New questions from this round:**
   - **Content search (C-17):** a hit in a code file opens in Source.
   - **The `/` prefix (C-17):** it collides with typing an absolute path.
   - **The verb menu (C-13):** a right-clicked link offers only "Jump to source"; and Enter on a Tab-focused link
     follows it, while on a selected link it opens the menu.
   - **WKWebView's menu (C-13):** whether `contextmenu`'s `preventDefault` hides WKWebView's own menu in the built app.
   - **Taste (L-03):** the partial list hang at narrow widths.
   - **TCC prompts (C-10.1):** whether walking `~` raises a prompt for Pictures, Music or Movies on macOS 26.

## Lessons from this round

- **Machine load is the bottleneck.** With about ten WebKit-running agents, load reached 100 and test runs timed out
  for hours. Brief every agent to run tests serially and targeted, and to re-run a timeout alone.
- **Adversarial reviews with an oracle pay.** B-23's first reparse was wrong on lists and line ends, and F-20's checker
  loosening hid a wrong range. Both were found by fuzzers the reviewers wrote, not by the PRs' own tests.
- **A test that waits can hide a product race.** F-21's 300 ms wait hid a Back press going one step too far.
- **The lead's own requests need the same scrutiny.** The APG Home/End behaviour the lead asked of D-04 broke it.
- **A card's paths can be wrong.** F-19 named the wrong file, and F-19.1's "offset 0" was never held by an unscrolled
  reader. Implementors who stopped and reported saved a round each time.
