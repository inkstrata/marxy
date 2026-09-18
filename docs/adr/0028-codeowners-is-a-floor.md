# ADR-0028 — CODEOWNERS is a security floor, not a taste gate

- **Status:** proposed
- **Date:** 2026-09-18
- **Amends:** ADR-0017 (trunk-based agent workflow) — the list of CODEOWNERS paths only.
  Everything else in ADR-0017 stands.
- **Numbering:** 0026 and 0027 are claimed by PR #42 and are not on `main`. This ADR takes 0028
  so the two can land unmoved.

## Context

ADR-0017 put nine paths behind a human review, covering both the thesis (typesetting, theme,
contracts, `shell-api`, ADRs) and the security posture. Since MARXY-79 the fleet lands its own
pull requests once the quality bar is met: an independent reviewer's signed approval of that
exact commit, green gates and the story's path boundary. CODEOWNERS is the one step it cannot take,
and most stories in Phases 1–2 touch a thesis path. Nearly every merge waits on one person, and
review is already the constraint (ADR-0025).

Taste already has its own check. ADR-0016 sends anything a reader sees through the taste-review
queue, with before/after screenshots, and the design constraints are machine gates. A human
reviewing the merge adds a second pass over the same thing, and it blocks the merge while it waits.

## Decision

CODEOWNERS covers only the paths where an autonomous mistake cannot be caught later by a reader:

1. **Security posture (ADR-0009):** `packages/core/src/sanitize/`, `tauri.conf.json` (the CSP)
   and `src-tauri/capabilities/`.
2. **The gate itself:** `.github/` (CI, release, and `CODEOWNERS`), plus `orchestration/approve.mjs`,
   `merge-bar.mjs` and `cycle.mjs`. Without these, an agent could approve its own change by
   editing the code that decides the merge. They were not covered before.

`packages/typeset`, `packages/theme`, `packages/shell-api`, `packages/core/src/contracts` and
`docs/adr/` leave CODEOWNERS. A change there lands on the signed-review bar like any other path.
Visual changes still get a taste-queue row (ADR-0016). A change that reverses an accepted ADR
still gets flagged to Ian in `needs-human.md`, but the flag no longer blocks the merge.

## Consequences

- Most stories merge with no human in the loop. Ian vets after the fact, through the taste queue
  and `needs-human.md`.
- A bad typographic or contract change can reach `main` and is found by review #N or a failing
  gate, not before merge. Trunk is always releasable (ADR-0017), so a revert is cheap. A leaked
  CSP source or an over-broad capability would not be cheap to revert, so those paths stay gated.
- `shell-api` is the least certain call. It defines the IPC surface, but a privileged command
  only takes effect once it is granted in `capabilities/`, which stays gated.
