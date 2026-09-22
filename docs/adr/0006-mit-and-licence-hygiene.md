# ADR-0006 — MIT for the whole tree; OFL fonts isolated; grammar and pattern allow-lists

**Status:** accepted
**Amended:** 2026-09-18 (MARXY-58) — records the licence gate that already shipped; not a new decision

## Decision
Code is MIT, inbound = outbound, no CLA. Bundled typefaces are SIL OFL 1.1 in `fonts/<family>/`
with their licence verbatim, never modified. Syntax grammars and hyphenation patterns are
shipped from explicit allow-lists of MIT/Apache/BSD/MPL-licensed files; a GPL grammar
(Shiki's default pack contains several) or LPPL-quirky pattern fails the licence gate.

Specifications, test vectors and other content are subject to the same rule as code. The
worked example is the CommonMark spec (CC-BY-SA-4.0): transcribing its examples into the
tree is forbidden. Using the BSD-2-Clause reference implementation as an oracle over our
own inputs is not. An optional check may read a file a developer downloads themselves and
never commits; the check skips when that file is absent and never fetches it.

## Consequences
- `scripts/gate-licences.mjs` parses `pnpm-lock.yaml` directly, resolves every package from
  the store, records platform-only packages in a recorded-licence allow-list
  (`scripts/allowlists/dependency-licences.json`), and treats an undeterminable-licence
  failure as a hard fail: a package whose licence cannot be read from the store and is
  not recorded.
  The same gate audits the Shiki language allow-list, the hyphenation pattern list, and
  every crate in `apps/desktop/src-tauri/Cargo.lock`.
- `THIRD_PARTY_NOTICES.md` is generated, not hand-written.
- Linux packaging must not vendor `libwebkit2gtk`; use the distribution library.
- Relicensing later would need every contributor's grant; this decision is the cheap one now.

## Checks (MARXY-58)

These commands fail if this amendment is reverted. They are the acceptance checks.

```sh
adr=docs/adr/0006-mit-and-licence-hygiene.md
grep -q 'pnpm-lock.yaml' "$adr"
grep -q 'recorded-licence allow-list' "$adr"
grep -q 'undeterminable-licence failure' "$adr"
grep -q '^\*\*Status:\*\* accepted' "$adr"
grep -q 'Amended:\*\* 2026-09-18 (MARXY-58)' "$adr"
grep -F '| [0006](0006-mit-and-licence-hygiene.md) | MIT for the whole tree; OFL fonts isolated; grammar and pattern allow-lists | accepted |' docs/adr/README.md
grep -q 'specifications, test vectors and other content are subject to the same rule as code' "$adr"
grep -q 'CommonMark spec (CC-BY-SA-4.0)' "$adr"
grep -q 'transcribing its examples into the tree is forbidden' "$adr"
grep -q 'BSD-2-Clause reference implementation as an oracle over our own inputs is not' "$adr"
grep -q 'file a developer downloads themselves and never commits' "$adr"
# The historical two-word pnpm licence-listing subcommand must not name the gate.
# Expect no matches: rg -n 'pnpm[[:space:]]licenses' docs/
```
