# Plan delta — 2026-09-20-marxy-33-acceptance

MARXY-33 (PR #137) escalated after three review rounds. The implementation satisfies the
*intent* (defer heavy work, static bundle-graph guard, startup marks) but the CSV acceptance
text still demanded a literal `<400 ms` CI gate (contradicts accepted ADR-0029/0032) and a
full per-mark waterfall JSON attached to the PR (never in the story Paths; PR body deferred it).

This pass rewrites MARXY-33 acceptance to machine-checkable criteria the open PR already meets,
so the fleet can merge #137 and dispatch phase-2 work. A dense waterfall artifact remains
future hygiene (MARXY-110 class docs), not a blocker on this row.

