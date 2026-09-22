# Needs a human

Appended by the orchestrator; cleared by the author when done. Newest at the bottom.

Only unanswered work belongs here. Discharged 2026-09-21: twelve stale open
bullets (merged PRs #1/#10/#14/#23/#25/#28, typeface and cold-start rulings
already recorded as ADR-0015 and ADR-0029, taste follow-ups MARXY-128/129/130
already shipped, MARXY-6 Done). Taste rows still waiting on a person sit in
`docs/taste-review/queue.md`, not here.

Discharged 2026-09-22 (author rulings):

- [x] **PR #180 / MARXY-183** — merged on `main` (`063ee42`); single-instance and open-file routing.
- [x] **MARXY-22** — no Linux desktop and no Apple Developer notarization account for now; **deferred** (story stays `human-gated` until hardware/account exist).
- [x] **MARXY-94 / ADR-0026** — author **accepts** the proposed v1 `Shell` surface; `human-gated` removed from the CSV row so MARXY-94 can dispatch (ADR moves to accepted when that story lands).
- [x] **Timing promises** — no hard CI merge gates on interaction-speed numbers; keep measuring per ADR-0032, do not fail PRs on budget overruns alone.
- [x] **MARXY-122** — merge-queue ruleset: not available on User-owned repos; `mergeQueue` false until org transfer (MARXY-182).
