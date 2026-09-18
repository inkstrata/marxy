# Needs a human

Appended by the orchestrator; cleared by Ian when done. Newest at the bottom.

- [ ] 2026-09-18 — Push the bootstrap commits (token needs the `workflow` scope) and tag v0.0.1 (`docs/plan/next-steps.md`, week 0).
      **This is now the critical path.** `git push origin main` is rejected: the 7 unpushed
      commits touch `.github/workflows/ci.yml` and the active `inkstrata` token carries only
      `gist, read:org, repo`. The account has admin on the repo, so it is scope, not access;
      the `ijdio` account has `workflow` but only `pull` on `inkstrata/marxy`, so switching
      does not help. Fix (interactive, opens a browser):
      `gh auth refresh -h github.com -u inkstrata -s workflow`
      Blocks every merge, and MARXY-5, MARXY-6, MARXY-15 and MARXY-16 outright. Phase 0 cannot
      end without a CI run, a tag and a release.
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
