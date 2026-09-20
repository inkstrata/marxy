// The no-network gate's own checklist (ADR-0009, MARXY-83). Every id here is one thing
// `scripts/gate-no-network.mjs` asserts, by name, before it will pass; the gate builds a `Set` of
// which ids it actually ran in a given execution and fails if that set is not exactly this one, so
// deleting a `check(id, ...)` call without also editing this list fails the gate itself the next
// time it runs. Deleting an id from both this list and the gate's call site — the only way to make
// nothing fail there — is caught instead by `gate-assertions.test.ts`, which proves each id
// separately from the gate's own execution and asserts it covered exactly this list, not a count
// that could happen to match by coincidence.
export const GATE_ASSERTION_IDS = [
  'control-interception',
  'control-hostile-unsanitised',
  'control-dirty-element',
  'control-dirty-containment',
  'control-traversal-escaped',
  'reference-contained',
  'rendered-not-empty',
  'no-remote-requests',
  'no-escaped-requests',
  'no-live-dom-violations',
  'parity-element-names',
  'parity-attribute-urls',
] as const;

export type GateAssertionId = (typeof GATE_ASSERTION_IDS)[number];
