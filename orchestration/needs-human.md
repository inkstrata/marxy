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
- [ ] 2026-09-18 — **For information, no action yet:** `main` is red and so is every PR, on
      `pnpm gate:perf` alone — the ADR-0013 product budget of 500 ms for first text is being
      measured on GitHub runners, which report 7719 ms (ubuntu, software-rendered WebKitGTK)
      and 1901 ms (macos) for today's hello-world shell. Nothing can merge until the policy is
      fixed; the planner is deciding between per-environment budgets and a release-only hard
      gate. v0.0.1 cannot be tagged before that lands.
      Also worth knowing: `cursor-agent` is not on PATH, so `orchestration/dispatch.mjs` cannot
      run implementors headlessly; they are being dispatched as in-app subagents into
      `../marxy-wt/<KEY>` worktrees instead.
- [ ] 2026-09-18 — Taste review #0 (typeface pair) once MARXY-17 lands its artifact.
- [ ] 2026-09-18 — Say whether a Linux desktop exists for MARXY-22 and whether an Apple Developer account exists for notarization.
