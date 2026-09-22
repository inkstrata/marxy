# ADR-0029 — There is no product cold-start ceiling

**Status:** accepted · **Amends:** ADR-0013 (the 500 ms product-ceiling clause only;
"regressions are hard failures" and the other named budgets stand) · **Source:**
the author's ruling 2026-09-18, `docs/taste-review/2026-09-cold-start/decision.md`;
already recorded as ADR-0022 Amendment 2 (MARXY-69)

## Decision

There is no product cold-start budget. `cold_start_first_text_ms` is a standing
observation of the sphere of concern. Keep measuring it. Do not claim a duration
on a tag, in release notes, or in `CHANGELOG.md`. A slower launch is a cost a
story must own; CI never writes a higher number into the repo to make a red gate
green.

The 500 ms figure that ADR-0013 and the `AGENTS.md` budget table still print is
not a ceiling the gate may fail a release on. ADR-0022 Amendment 2 already
withdrew the reference-tier comparison. This ADR withdraws the same claim from
the documents a new session reads first.

Honest numbers already on record: 2844 ms on macOS, 1735 ms on Linux (packaged).

## Why

A packaged Tauri launch is several times 500 ms. Treating 500 ms as a promise
makes every later story either lie or reopen the budget. The author ruled it is not a
promise. The tripwire in `docs/roadmap.md` that reopens foundations when
"cold start > 500 ms after Phase 2" has already fired, and fired on a number
that is not a commitment.

## Consequences

- `AGENTS.md`'s budget table stops stating cold start < 500 ms as a CI failure.
- The `docs/roadmap.md` tripwire is rewritten to the resist-inflation rule, not
  a 500 ms product ceiling.
- ADR-0013 is not edited (accepted ADRs are append-only). This record is the
  amendment.
- `fixtures/perf-budgets.json` is **not** in scope here. MARXY-70 still owns
  re-deriving CI numbers; MARXY-16 still must not claim a time.
