# Needs a human

Appended by the orchestrator; cleared by Ian when done. Newest at the bottom.

Only unanswered work belongs here. Discharged 2026-09-21: twelve stale open
bullets (merged PRs #1/#10/#14/#23/#25/#28, typeface and cold-start rulings
already recorded as ADR-0015 and ADR-0029, taste follow-ups MARXY-128/129/130
already shipped, MARXY-6 Done). 2026-09-21 evening: no Linux desktop now
(MARXY-22 stays `human-gated`); ADR-0026 accepted (MARXY-94 label comes off;
the ADR status line stays proposed until that PR merges); MARXY-122 is yes
(adopt the merge queue; GitHub ruleset stays off until that story lands).
Taste rows still waiting on a person sit in `docs/taste-review/queue.md`, not here.

- [x] 2026-09-18 — Linux desktop for MARXY-22? **No, not now. Deferred.** Stays `human-gated` until a real GNOME box exists.
- [x] 2026-09-21 — **MARXY-94** / ADR-0026: **accepted.** Remove `human-gated` so the contract amendment can dispatch. Status line stays proposed until MARXY-94 merges.
- [x] 2026-09-21 — **MARXY-122**: **yes.** Adopt the merge queue. Leave the GitHub ruleset switch off until MARXY-122 lands (`ci.yml` must listen for `merge_group` first). `human-gated` removed.
- [ ] 2026-09-21 — Apple Developer account for notarization (needed before a tagged macOS build can ship)? Still unanswered.
