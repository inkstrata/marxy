# Needs a human

Appended by the orchestrator; cleared by Ian when done. Newest at the bottom.

Only unanswered work belongs here. Discharged 2026-09-21: twelve stale open
bullets (merged PRs #1/#10/#14/#23/#25/#28, typeface and cold-start rulings
already recorded as ADR-0015 and ADR-0029, taste follow-ups MARXY-128/129/130
already shipped, MARXY-6 Done). 2026-09-21 evening: no Linux desktop now
(MARXY-22 stays `human-gated`); ADR-0026 accepted (MARXY-94 label comes off;
the ADR status line stays proposed until that PR merges). Taste rows still
waiting on a person sit in `docs/taste-review/queue.md`, not here.

- [x] 2026-09-18 — Linux desktop for MARXY-22? **No, not now. Deferred.** Stays `human-gated` until a real GNOME box exists.
- [x] 2026-09-21 — **MARXY-94** / ADR-0026: **accepted.** Remove `human-gated` so the contract amendment can dispatch. Status line stays proposed until MARXY-94 merges.
- [ ] 2026-09-21 — **MARXY-122** is `human-gated` on a GitHub merge-queue ruleset only you can turn on. Decide, then remove the label to dispatch it. Do not enable the queue until `ci.yml` listens for `merge_group` (that is the story).
- [ ] 2026-09-21 — Apple Developer account for notarization (needed before a tagged macOS build can ship)? Still unanswered.
