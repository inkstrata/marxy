# ADR-0045 — Contracts change by pull request; the invariants are tests

- **Status:** proposed (audit 2026-10)
- **Date:** 2026-10-02
- **Amends:** the `AGENTS.md` rule "Contracts are frozen", ADR-0004 (the operation signature is
  frozen), ADR-0026 (`shell-api` "amended once for all of v1") and ADR-0041. The `--marxy-*`
  token names and units keep needing an ADR to change (item 4, a change of meaning); their values
  stay taste (ADR-0031).
- **Evidence:** `docs/research/audit-2026-10/10-overfit-decisions.md` §3.2.

## Context

`package.json` has a script, `test:contracts-frozen`, that pins five files under
`packages/core/src/contracts/` (`ast.ts`, `index-entry.ts`, `operation.ts`, `position.ts` and
their own `contracts.test.ts`) to git blob hashes, and `pnpm test` runs it first. `AGENTS.md`
extends the freeze to `packages/*/src/contracts/` and to the theme token names. The rule was sensible for a fleet of implementors who could not be
trusted to widen an interface quietly. It now sits in front of everything the author wants next:
a collection adds fields to `index-entry.ts`, a split view adds a second position, richer copy
makes an operation return more than a string. Each is an ADR, a PR touching only the contract and
a hash update, before the feature's first line. The `shell-api` freeze has already been amended
twice (ADR-0026, ADR-0038, ADR-0041): honoured in form, routed around in practice.

What the freeze protected is a short list of properties, and each is already a test.

## Decision

1. **Delete `test:contracts-frozen` from `package.json`** and its call at the head of the `test`
   script, with the freeze-point hash it carries. `packages/core/src/contracts/contracts.test.ts`
   stays, is no longer pinned, and keeps its type-level assertions.
2. **The invariants stay as tests.**
   - "Every AST node carries `{file, start, end}`": the golden files, `pnpm gate:golden`.
   - "An operation never changes bytes outside its range": the fidelity property,
     `pnpm gate:fidelity`.
   - "No `@tauri-apps` outside `apps/desktop/src/shell`, core takes no DOM": `scripts/check-boundaries.mjs`.
   If a property that mattered turns out to have no test, the pull request that finds it adds one.
3. **A contract change is an ordinary pull request.** It regenerates the goldens it moves and says
   in the description what changed and why. Adding a field, widening a union or adding an optional
   parameter needs no ADR.
4. **An ADR is for a change of meaning**: a new node kind, a new selection granularity, a new
   coordinate, a new privileged capability in `shell-api`. The test is whether a reader of the old
   contract would be surprised by what the new one allows.
5. **`AGENTS.md` and `docs/ci-contract.md` drop** the frozen-contracts paragraph and the hash row.
   The `contracts-frozen: diff vs <hash>` row of the red-CI table goes with them.
   `.github/CODEOWNERS` is unchanged: it protects the sanitiser, the CSP and the workflows, not
   contracts.

## Consequences

- The next feature that needs a field on `index-entry.ts` is one PR instead of two.
- Pull requests that touch a contract are no longer forced to be contract-only. A reviewer reads
  the diff, which is what the hash was standing in for.
- `docs/ci-contract.md` loses one way for CI to go red, which is the point.
- A breaking change to a contract reaches `packages/theme` and `apps/desktop` through the type
  checker, which already runs on every pull request.

## Rejected

- **Keep the hash and make it cheap to update.** A check that fails for every honest change and
  passes for every careless one is a ritual, not a gate.
- **Move the frozen set to a `contracts-v1/` snapshot.** The same freeze, in more files.

## How we would know this was wrong

1. A contract change breaks a consumer that the type checker and goldens did not catch. Then an
   invariant has no test: write it, do not restore the hash.
2. A change of meaning lands without an ADR because it looked like a field. Then item 4's
   wording needs an example, not a gate.
