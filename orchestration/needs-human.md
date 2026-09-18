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
- [ ] 2026-09-18 — Approve PR #1 (MARXY-10, Jira as the board of record) or send it back. I wrote
      it, so I am not the one who should also approve it: the cycle refuses to merge a PR until a
      reviewer writes `orchestration/results/KEY.approved`, and that rule is worth more than the
      one merge it is holding. If you are content with it, `printf 'reviewed by Ian\n' >
      orchestration/results/MARXY-10.approved` and the loop lands it as soon as the gates are green.
      Every other story is reviewed by the reviewer agent, not by its implementor, so this is a
      one-off.
- [ ] 2026-09-18 — Say whether a Linux desktop exists for MARXY-22 and whether an Apple Developer account exists for notarization.
