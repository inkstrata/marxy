# Needs a human

Appended by the orchestrator; cleared by Ian when done. Newest at the bottom.

- [x] 2026-09-18 — Push the bootstrap commits (token needs the `workflow` scope) and tag v0.0.1 (`docs/plan/next-steps.md`, week 0).
      **Discharged.** `origin/main` and `main` are both at `ba7ed37`; CI has run on every push
      to `main` since 08:43. What remains of this item is the tag, which still waits on the
      cold-start ruling and MARXY-69.
- [x] 2026-09-18 — Jira. Done: project MARXY exists with the four-state board, all 51 issues
      imported (MARXY-4 … MARXY-54), and an API token in `~/.config/marxy/jira.env`.
- [ ] 2026-09-18 — **For information, no action:** the perf gate flaked on a docs-only PR (#6, macOS
      measured 2244 ms against a 2091 ms ceiling), which is the risk I accepted when I approved
      MARXY-55: baselines set to the exact observed median tolerate only 10 %, and macOS runners vary
      by 1.5×. The planner's fix is MARXY-63 — gate the *floor* of 12 launches rather than the
      median, since runner noise is one-sided, with a per-runner tolerance bounded by a
      machine-checked invariant that a 20 % regression still cannot pass, and confirm a breach by
      re-measuring before failing. The baseline is deliberately **not** being edited to make this
      green: that would write a noise excursion into the number permanently and teach the fleet that
      a red perf gate is fixed by raising the budget. Reasoning in
      `docs/plan/deltas/2026-09-18-perf-variance.md`.
- [x] 2026-09-18 — ~~**For information, no action yet:**~~ Resolved by MARXY-55. `main` was red on
      `pnpm gate:perf` alone, because the ADR-0013 product budget of 500 ms for first text was being
      measured on GitHub runners that report 7719 ms (ubuntu, software-rendered WebKitGTK) and
      1901 ms (macos) for a hello-world shell. ADR-0022 split the tiers and merges flow again.
      Still true: `cursor-agent` is not on PATH, so `orchestration/dispatch.mjs` cannot
      run implementors headlessly; they are being dispatched as in-app subagents into
      `../marxy-wt/<KEY>` worktrees instead.
- [ ] 2026-09-18 — **Taste review #0 is ready to decide: the typeface pair.** The artifact is PR #6
      (MARXY-17): 20 PNGs, both ADR-0015 pairs, five matched passages of `01-long-technical.md`, 1×
      and 2×, with the checklist in `docs/taste-review/queue.md`. ADR-0015 is proposed until you
      answer, and MARXY-20 and MARXY-21 build on the answer, so this is the first thing in the taste
      queue that actually blocks work. Two things fell out of rendering that you should know before
      looking:
      - The same 68 `ch` measure gives the pairs columns 75 px apart (Literata 670 px, Source Serif 4
        595 px), and the narrower pair sets the *longer* document. Constraint 1 working as intended,
        but 68 `ch` is the right number for exactly one of these faces, so choosing the pair also
        means revisiting the measure.
      - IBM Plex Mono has no variable font at all, so pair B means a file per weight and no axis to
        compensate for WebKitGTK's lighter rendering; Source Serif 4 also has no italic vendored, so
        pair B's italics are synthetic.
      Read them for a while rather than a page: the question is which you would still want to be
      reading on the fourth page. Record the answer in the queue's Decision column.
- [ ] 2026-09-18 — Approve PR #1 (MARXY-10, Jira as the board of record) or send it back. **This now
      has a second consequence:** `.githooks/` lives only on that branch, so every worktree cut from
      `main` runs no `commit-msg` hook, and a `Co-authored-by: Cursor` trailer duly reached PR #7.
      I audited all five open branches — only that one — and the merge path now refuses any PR whose
      commits carry a trailer, but implementors will keep hitting it until this lands. I wrote
      it, so I am not the one who should also approve it: the cycle refuses to merge a PR until a
      reviewer writes `orchestration/results/KEY.approved`, and that rule is worth more than the
      one merge it is holding. If you are content with it, `printf 'reviewed by Ian\n' >
      orchestration/results/MARXY-10.approved` and the loop lands it as soon as the gates are green.
      Every other story is reviewed by the reviewer agent, not by its implementor, so this is a
      one-off.
- [x] 2026-09-18 — ~~**A rule of mine needs your ruling, or the planner's:** the WIP limit is 3~~
      Ruled: uncap. `models.json` `lanes` is `null`; dispatch is limited only by path overlap.
      Returns re-enter freely. `docs/sdlc.md` matches.
- [ ] 2026-09-18 — Say whether a Linux desktop exists for MARXY-22 and whether an Apple Developer account exists for notarization.

## Taste review #0 is ready — 2026-09-18

PR #6 merged, so the specimen is on `main`. Two typeface pairs, five passages each, at 1x and 2x:
`docs/taste-review/review-0/`, with the entry and the checklist in `docs/taste-review/queue.md`. Read
that entry before the images — it now carries the measured optical-size behaviour of both faces and
says outright that neither number tells you which is better, because this is the one decision no gate
and no agent here can make for you. Nothing downstream of the default theme should be dispatched until
you have chosen a pair.

## The cold-start budget has not been enforced — 2026-09-18

`cold_start_first_text_ms` has never measured a cold start. `scripts/measure-startup.mjs` launches the
packaged app eight times two seconds apart and takes the median, so only the first launch is cold and
the reported figure is a warm start by construction; on Ubuntu seven of eight launches never emit the
mark and are dropped with nothing checking the count, leaving a median over one sample. The macOS
numbers say the cold launch is 2400-3500 ms against ADR-0013's 500 ms budget, five to seven times over.
Two consequences you should decide on, and the planner is drafting the reasoning: the release runbook
step in `docs/sdlc.md` that claims to enforce product budgets on reference hardware is enforcing a warm
number, so no release has yet measured what a reader feels; and if the true cold start really is that
far over budget, that is a product fact about Tauri startup rather than a gate problem, and it may
belong in `docs/risks.md` and in scope decisions rather than only in a CI fix.

### Update: the budget finding has a decision — 2026-09-18

The planner accepted the finding and withdrew ADR-0022's Amendment 1 before it landed. The metric splits
in two: `cold_start_first_text_ms` becomes launch 1 alone, held to an absolute per-class ceiling, and
`warm_start_first_text_ms` becomes the median of launches 2..N and keeps today's baseline rule and
numbers under a name that is true. ADR-0022 needs two sentences replaced rather than extended, and the
premise needs one added saying the opposite of what it assumed: CI does not measure a scaled version of
the reader's experience, it detects change in a related quantity on a rented machine, and the reader's
experience is enforced on reference hardware and nowhere else. Reasoning in
`docs/plan/deltas/2026-09-18-cold-start-metric-falsified.md`.

What still needs you: the release runbook in `docs/sdlc.md` has been comparing a warm median against the
cold budget and passing leniently, so a tag cut today would carry a green perf run and an unmeasured
product. MARXY-69 rewrites that step to run at least five genuinely cold launches with the cold-making
procedure recorded. Until it lands, no release should claim the budget is met. And if the true cold start
really is 2400-3500 ms against 500 ms, that is a product fact about Tauri startup rather than a gate
problem, and it belongs in `docs/risks.md` and in scope.

### The cold start is roughly six times its budget — 2026-09-18

With the measurement fixed, the first honest numbers are 2844 ms on macOS and 1735 ms on Linux for a
packaged cold start, against ADR-0013's 500 ms. The Linux figure is now credible because the launch is no
longer stalling thirty seconds on a missing D-Bus session bus; the old 7719 ms "baseline" was a median
over the one launch in eight that escaped that stall, so it never described the application.

This is very likely a product fact about a packaged Tauri launch rather than a gate problem, and it is
the kind of fact the budgets were written to surface. It wants a decision from you rather than a story:
whether 500 ms to first readable text is still the commitment, whether it applies to a cold OS-level
launch or to a warm one, and what the honest claim is in the meantime. `docs/risks.md` and `docs/scope.md`
are the places it would land. Note that reference mode now fails on purpose, naming MARXY-69, so a tag is
blocked until the product budget can be measured properly — which is the correct thing to block, but it
does mean no release until that story lands.

## Planner pass, 2026-09-18 — five things, in the order they cost you

Reasoning for all of them: `docs/plan/deltas/2026-09-18-review-throughput.md`.

- [x] **Discharged, no action: the `workflow`-scope push.** It landed. `origin/main` and `main` are
      both at `ba7ed37`, `.github/workflows/ci.yml` is on `main`, and CI has run on every push to
      `main` since 08:43. The first item in this file is stale; tick it. MARXY-5 has lost its
      `human-gated` label as a result. What is still true, and was recorded nowhere: **`main` is
      red**, and has been since 11:33. Last green run `35340189174` (MARXY-11); every run since fails
      on exactly one step, `Perf gate (CI envelope and baseline, ADR-0022)` on `macos-latest`, with
      `ubuntu-latest` green. That is MARXY-63's subject and MARXY-5 now depends on it.

- [ ] **Two repository settings, and the second one is a hole in the safety net.** MARXY-6 is mostly
      already done — strict required checks on both runners, `require_code_owner_reviews`,
      `required_linear_history`, squash-only, no force pushes, and `.github/CODEOWNERS` on `main`
      covering `/packages/theme/`. Two gaps, one setting each:
      1. `enforce_admins` is **false**, so a direct push to `main` by the admin account the fleet
         uses is not rejected. MARXY-6's second criterion is therefore false as stated.
      2. `required_approving_review_count` is **0** and **no open pull request has ever reported
         `REVIEW_REQUIRED`** — including PR #11, which edits `packages/core/src/sanitize/`, and PR
         #10, which amends an accepted ADR under `docs/adr/`. Both are CODEOWNERS paths.
         `cycle.mjs` holds on `REVIEW_REQUIRED`, so the CODEOWNERS net is wired to a signal GitHub
         is not sending, and the security-posture path and the project's memory are both currently
         mergeable without their owner.
      MARXY-6 stays yours and stays `human-gated`. The standing check that stops it drifting back is
      a new story, MARXY-82, which depends on it.

- [ ] **Too late to review PR #10's amendment before it merged — it is on `main`.** Read it now
      rather than before: ADR-0022 is amended at `375f8dc`, which landed through a GitHub auto-merge
      queued by an earlier cycle and executed after I had withdrawn the approval. Nobody asked you,
      for the reason in the item below this one, and the cycle no longer leaves such an instruction
      standing. The work itself is sound — the branch is the reviewed tree, green on both runners,
      and the implementor found and fixed a real falsification in its own claim on the way: since
      MARXY-13's CLI smoke check landed, the build step launches the app four times seconds before
      the measurement, so the "cold" launch was measuring a warm webview and the macOS ratio came
      out at 0.78. If you disagree with the amendment, it now costs a revert rather than a hold.
      Original note follows. It replaces two sentences in an
      **accepted** ADR and reverses its premise. `docs/adr/` is a CODEOWNERS path, so this should
      have been requested of you automatically and was not, for the reason above. The same applies to
      MARXY-69 and MARXY-70 when they arrive. Until `enforce_admins` and the approval count are
      settled, the orchestrator must not treat a silent `reviewDecision` as "no owner review needed".

- [ ] **The cold-start budget ruling — unchanged, still yours, and here is exactly what it blocks.**
      I have not decided it. Precisely: **MARXY-16 only.** MARXY-69 can be built and merged without
      your answer — it lands a reference-mode gate that is red by design at 2844 ms against 500 ms,
      and reference mode runs before a tag rather than on pull requests, so it blocks a tag and
      nothing else, which is the correct thing to block. What is genuinely stopped until you answer
      is the *response*: `docs/roadmap.md`'s tripwire for this has **fired, and early** — in Phase 0,
      on both platforms — and it already prescribes the order, font subsetting first and
      resident-mode-by-default second, never a bigger bundle. Which of those gets written depends on
      whether 500 ms is still the commitment and whether it applies to a cold OS-level launch or a
      warm one. No story written for either. Phase 0 cannot be released until you rule.

- [ ] **PR #14 (`docs/design-runway`, MARXY-74) needs a ruling, and it is in the way of the typeface
      decision.** 76 files, three commits, yours, open, in conflict and red. It edits
      `packages/theme/src/tokens.css` (a frozen contract), `AGENTS.md`, `.github/workflows/ci.yml`,
      `orchestration/prompts/planner.md` and `orchestration/review.mjs`; adds ADR-0023 and ADR-0024;
      adds a `docs/design/` tree, a `docs/plan/tasks/` card system and a `scripts/check-*.mjs` suite;
      and introduces MARXY-74, MARXY-75 and MARXY-76, none of which exist in
      `docs/plan/jira-issues.csv` or `orchestration/state.json`. Three things a planner cannot decide
      for you:
      1. It cannot merge under the rules it is written alongside — one issue one PR, frozen contracts
         only in a story whose paths name them and that carries an ADR, no file outside a story's
         paths. Split it, or change the rule and say so in `AGENTS.md`.
      2. `docs/plan/tasks/*.md` is a **second machine-readable spec** beside the CSV, and
         `AGENTS.md` plus `docs/sdlc.md` say the CSV is the spec. One of the three has to give.
      3. **ADR-0024 makes dark the primary variant**, which invalidates all 20 light-mode PNGs in
         taste review #0 — the decision that currently blocks MARXY-20 and MARXY-21. MARXY-76 on that
         branch exists to re-render them. So do not take the typeface decision before this is
         resolved, or you will take it twice.
      I left MARXY-74, 75 and 76 out of the CSV and `state.json` on purpose: adding rows for your
      unmerged branch would fabricate a plan around work whose shape you have not settled. ADR-0025
      takes number 0025 so 0023 and 0024 can land unmoved.

- [ ] 2026-09-18 — **PR #28 (MARXY-65) is merge, unsigned.** Agent review is satisfied;
      `orchestration/results/MARXY-65.approved` exists and was deliberately not signed, so the
      cycle cannot land it. It edits `.github/workflows/ci.yml` (CODEOWNERS). No blocking notes.
      Approve on GitHub if you are content. Same hole as PR #23.

- [ ] 2026-09-18 — **PR #23 (MARXY-62) is signed but held.** Agent review is merge against
      `17ee2dc`. Two reasons the cycle will not land it: `.github/workflows/ci.yml` is
      CODEOWNERS, and `gates (macos-latest)` is red on a `pnpm test` perf-budget flake the
      reviewer says already exists on `main` (the new `gate:specimen` step never ran on that
      job). Ubuntu gates and conventions are green. Do not treat a silent `reviewDecision` as
      owner approval. Approve on GitHub if you are content; the macOS red still has to go
      green or be shown to be the known main flake after a re-run.

- [ ] 2026-09-18 — **Review PR #25 (MARXY-58) before it merges.** Agent review is **merge**,
      unsigned: `orchestration/results/MARXY-58.approved` exists and was deliberately not signed,
      so the cycle cannot land it. It amends accepted ADR-0006 under `docs/adr/` (CODEOWNERS).
      GitHub is still not sending `REVIEW_REQUIRED`. Three non-blocking notes only (stale CSV
      filename — already corrected to `0006-mit-and-licence-hygiene.md`; checks live in the ADR
      body because Paths allow no test file; amendment covers both the lockfile audit and the
      content-licence rule, both named in the story). Approve on GitHub if you are content.

- [ ] 2026-09-18 — **MARXY-20 is now `human-gated` and blocked on the board.** ready.mjs would
      have dispatched the default theme because its deps (MARXY-11, MARXY-13) are done and it
      does not read the taste queue or PR #14. It stays off the dispatch list until you resolve
      PR #14 (dark-is-primary would invalidate review #0) and record the typeface pair in
      `docs/taste-review/queue.md`. MARXY-21 and everything downstream wait on that.

- [x] 2026-09-18 — **For information, no action: `main` is green again.** The planner's item above
      says `main` has been red since 11:33 on the macOS perf gate; that was true when it was written
      and is now stale. MARXY-63 landed the cold/warm split and the last two runs on `main` are
      green. Several open PRs still show a red macOS gate from before that merge and need a re-run
      rather than a fix.

- [x] 2026-09-18 — **For information: two holes in my own merge gate, both closed.** The first was
      the signing rule I landed this morning turning into a livelock, which the planner found: an
      approval names a commit, the cycle updates every branch that falls behind, so each merge voided
      every signed approval in the queue and the queue could not drain by reading faster. An approval
      now survives a head change when everything that changed since arrived from `main` — file by
      file, either byte-identical to `main` or, for a file both sides touched, carrying no line that
      neither side already had. A commit that is not a descendant of the reviewed one, or that
      carries a line the reviewer never saw, is still refused. MARXY-81 can build on this rather than
      cap around it. The second is why MARXY-63 (PR #10) merged with no valid approval at all: an
      earlier cycle enabled GitHub auto-merge while its checks ran, I withdrew the approval before
      they finished, and GitHub merged it anyway — auto-merge is a decision taken now and executed
      later on information that may have changed. The cycle now cancels a standing auto-merge when
      the bar stops being met. The outcome was fine here: PR #10 was reviewed, returned, fixed, and
      green at the commit it merged. The mechanism was not.

- [x] **Settled by the planner, no action: does a returned story count against WIP?** **No.** It
      leaves In Review when it is returned, so the lane is freed by construction, and it consumes one
      again on re-entry. A return is the same unit of work, not a new one; charging it twice makes
      returning a story more expensive than abandoning it, which is the wrong incentive to put in
      front of a reviewer. It re-enters the review order at its own phase, disturbance and
      **original** age, so it cannot starve by being returned. Recorded in ADR-0025 (proposed) and
      landed into `docs/sdlc.md` by MARXY-80. Note this is now about a
      new `reviewLanes` cap on *review*, not about `lanes`: your ruling that dispatch is uncapped
      stands untouched.
