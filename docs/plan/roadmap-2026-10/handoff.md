# Lead handoff: the 2026-10-10 evening

**For:** the next lead session, and the author. **Read with:** `00-orchestration.md` §3 to §6, then `progress.md`
(the ledger holds the detail of every story named here). This page says what to do next.

## What merged on 2026-10-10

All agents ran on Sonnet (the author asked for cost-effectiveness).

- **Direction and chrome:** H-07 (`chrome_size`), W-01 (the two-state at-rest gate), J-02 (`shell-api` clipboard),
  H-03.1 (palette and outline edge roles), H-06 (character-width measurement), V-01 (structural selection and line
  operations in Source), X-08 (the wave-3 cards).
- **Panes and layout:** D-09 (Cmd-click into the neighbour pane), D-12 (remember the layout and each pane's place).
- **Large documents and scroll:** B-24 (re-render only what a reload changed), B-27 (a hidden Source page is not
  rebuilt on every fold; fold on 1 MB 5,095 to 898 ms), F-27 (each pane keeps its block under the reading line).
- **Text operations (Phase E):** E-01, E-02 (gap-fill tests), E-03, E-06, E-07, E-08, E-09, E-10, E-11, E-14, E-16.
- **Test infrastructure:** F-30 (a stuck live-reload test fails by name) and F-30.1 (boot deadline and retry).

## Open pull requests, and what each needs

| PR | Story | State | Next |
| --- | --- | --- | --- |
| #538 | D-10 | re-check merged at `0a3d143a`; main merged in after B-27 | the lead's re-verdict, then merge |
| #545 | E-04 | Sonnet review dispatched | **hold the merge**: it amends ADR-0048 clause 3 (see below) |
| #546 | J-03 | Sonnet review dispatched; 45 of 50 transforms | merge on a merge verdict; then J-03.1 for the five deferred |
| #547 | E-05 | Sonnet review merge | merge (notes in the ledger) |
| #494 | F-26 | review merge at `0c8f0358` | code-owned: the author merges |
| #407 | sanitiser test | browser-lite and ci red | code-owned: the author merges |
| #450 | G-03 | `ci.yml` / `nightly.yml`; browser-lite and ci red | code-owned: the author |
| #470 | F-21 | returned twice | re-run on Opus (see `progress.md`) |
| #445 | K-00 | docs, plan lane K | no checks yet; read, then merge or return |

Ready to dispatch: H-04 (held, author taste), K-05, W-02, F-28 (code-owned; point 2 needs the author), E-08.1,
J-03.1 (after #546), F-31 (after the author rules), V-07, A-03.

## Waiting on the author

1. **Code-owned pull requests:** #494 (F-26, the sanitiser), #407 (the sanitiser test), #450 (G-03, `ci.yml` and
   `nightly.yml`).
2. **ADRs:** ADR-0060 and ADR-0061 are proposed.
3. **ADR-0048 clause 3 (E-04, #545):** the card has Esc keep the edit; the ADR has it discard. The PR amends the ADR.
   The lead holds the merge for the author's ruling.
4. **The `⌘\` conflict (W-02):** D-07 shipped it as Open beside, while ADR-0058 gives it to fold and unfold. W-02
   registers without a key until the author names one.
5. **V-01:** the keys ⌃⇧→ and ⌃⇧B take over macOS emacs defaults.
6. **Taste:**
   - K-18's html glyph;
   - H-03.1's palette and outline edges (the old literals were wrong in light, so the default look moved);
   - K-03's "a task list means report";
   - E-11's copy-plain keeps list markers (the card said dropped; the lead decided).
7. **F-31's ADR-0013 question:** may the paint signal fall back after two frames and about 2 s, marked
   `signal=frames-only`? The card is in `08-fixes-from-the-bug-sweep.md`.
8. **The Docker incident:** an agent ran `docker stop` on all containers and stopped another session's
   `tender_shannon` (since gone, likely `--rm`). Future briefs: stop only the containers you started.

## Lessons

- **browser-lite timeouts (7 times) were a boot stall, not the suite's size.** The same job takes 5 to 6 minutes on
  other runs and hits the 15 minute cap on others. F-30 named the hanging test (F-19.3) and F-30.1 bounded the boot.
  The residual is a product stall, F-31. Do not raise the timeout (#394) for this.
- **Append-only operation lists conflict between parallel E stories.** `MUTATING_OPERATIONS` and the catalogue list
  conflicted for E-06 and E-07, E-08 and E-10. Merge those stories serially, or expect a list-union merge.
- **The lead's regex conflict resolution once dropped ADR index rows** (#516 fixed it). Diff a resolved file against
  both parents before committing.
- **Cards can be wrong on a number.** B-27's 28 to 30 s, F-27's 1,300 px, H-06's "two sizes within 0.5 %" and E-16's
  CRLF rule did not hold; the implementors who measured and reported saved a round each time.
- **Adversarial reviews with an oracle still pay:** B-24 (KaTeX ran twice, Save as threw), D-10 (two silent-overwrite
  paths) and V-01 (Join, Delete line, mixed CRLF) were each found by a reviewer's probes, not the PR's tests.
- **A usage limit stops agents mid-work** (about 18:00: E-04, J-03, E-05). Their worktrees were intact; resume rather
  than restart.
