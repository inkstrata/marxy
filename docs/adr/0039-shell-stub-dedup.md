# ADR-0039 — One shared implementation for shell-api compile-time stub shells

- **Status:** accepted (lands with MARXY-285)
- **Date:** 2026-09-28
- **Follows:** ADR-0010 (`shell-api` is frozen), ADR-0026 (compile-time `Shell` completeness in `packages/shell-api/src/index.ts`, MARXY-94), ADR-0038 (`setWindowControls` negative check, MARXY-268)

## Context

`packages/shell-api/src/index.ts` is a types-only contract package, but it also carries
compile-time stub `Shell` objects so a missing interface member fails `pnpm typecheck` instead of
silently (MARXY-94). Those stubs were hand-copied object literals: the positive
`memoryShellLike` check and each `@ts-expect-error` negative check each listed every method
again. Adding a `Shell` member to one literal and not the others did not fail the build; only
the positive check had to stay complete.

`packages/shell-api/src/` is on `scripts/registry.json`'s frozen list, so deduplicating the stubs
is an ADR-only change with no behaviour change to real shells (`apps/desktop/src/shell/*`).

## Decision

1. **`stubShellImpl()`** in `packages/shell-api/src/index.ts` is the single definition of every
   no-op `Shell` member used for compile-time checks.
2. **`memoryShellLike`** is `const memoryShellLike: Shell = stubShellImpl()`.
3. **Negative checks** use a small helper (for example `stubShellWithout('fetchRemoteImage')`)
   that omits one key from `stubShellImpl()` so `@ts-expect-error` assignments still prove the
   member is required, without a second full literal.

No export surface changes; desktop and test shells are unchanged.

## Consequences

- A new `Shell` member is added once in `stubShellImpl()`; `memoryShellLike` and the negative
  checks stay aligned automatically.
- Verification: `pnpm typecheck` in `@marxy/shell-api` (the MARXY-94 / MARXY-268 compile-time
  checks, now sharing one implementation).
