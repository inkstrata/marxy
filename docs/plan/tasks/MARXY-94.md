---
key: MARXY-94
design: [06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-94]
---
# MARXY-94 — Amend the frozen shell-api once, for all of v1 (lands ADR-0026)

**Design:** [06-shell](../../design/06-shell.md) §Commands · **ADR:** [ADR-0026](../../adr/0026-shell-api-v1-surface.md) (proposed; this story moves it to accepted) · **Code owner:** the author (contracts path).

**Outcome.** `packages/shell-api/src/index.ts` names every privileged operation v1 uses, so the Tauri implementation is a complete implementation of the contract rather than `Pick<Shell, …> & extras`. No behaviour changes.

## Files and signatures
- `packages/shell-api/src/index.ts` — **only this file** (plus the ADR status line, `docs/adr/README.md` row, `CHANGELOG.md`). Add to `Shell` the twelve members in ADR-0026 §2 with exactly those signatures and a one-line JSDoc each; export `ShellError` (§4); mark `listRoot` and `fuzzy` `@deprecated ADR-0026`.

## Do this, in order
1. Edit the interface. Keep every existing member byte-identical apart from the two JSDoc deprecation tags.
2. `packages/core/src/contracts/contracts.test.ts` (or the shell-api equivalent if one exists) — if a test pins the contract's text or member list, update it in this PR; that is the point of the PR.
3. Run `pnpm typecheck`. `apps/desktop/src/shell/tauri.ts` still types as `Pick<Shell, …> & {…}`, so it keeps compiling; do **not** change it here (it is a product path; the next story that touches it narrows the type).
4. ADR-0026 status → accepted, with the merge date.

## Tests → expected
| Check | Expect |
| --- | --- |
| `pnpm typecheck` | green, no change to any file outside the list |
| `git diff --stat` | four files |
| contract diff check in CI | reports the change and passes because an ADR is referenced |

## Acceptance → check
The interface lists every row of ADR-0026 §2 → a unit test that does `const s: Shell = memoryShellLike` with a literal object implementing every member and `// @ts-expect-error` on an object missing `fetchRemoteImage`; ADR-0026 accepted → `docs/adr/README.md`.

## Do not
Add a member that is not in ADR-0026. Remove anything. Touch `apps/`.
