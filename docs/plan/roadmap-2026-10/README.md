# The October 2026 roadmap — implementation plan

The plan that carries out `docs/research/audit-2026-10/14-roadmap-proposal.md`, written
2026-10-02 for implementation by Claude Opus and Claude Sonnet agents under one lead session,
with the author merging. It replaces `docs/plan.md` phases 2 to 4 and the first horizon of
`docs/roadmap.md` while the fleet is paused (ADR-0051, proposed). Every story is written so an
agent with no memory of the audit can start from the story and the files it names.

The author's stated priority (2026-10-02): the large-document performance work comes first. It is
Phase A's first wave.

| Document | What it holds |
| --- | --- |
| [00-orchestration.md](00-orchestration.md) | The operating model: roles, model assignment, the implementor and reviewer briefings, waves and parallelism, the PR path, the ledger, re-planning |
| [01-phase-a.md](01-phase-a.md) | Phase A — performance lane, pause, prune, wire; ends with v0.1.0 |
| [02-phase-b.md](02-phase-b.md) | Phase B — the shell refactor: N-document store, per-article view, deletions, unfrozen contracts; ends with v0.2.0 |
| [03-phase-c.md](03-phase-c.md) | Phase C — collections, the empty state, the copy pack, the verb menu, on-demand search; ends with v0.3.0 |
| [04-phase-d.md](04-phase-d.md) | Phase D — the two-pane split; ends with v0.4.0 |
| [05-phase-e.md](05-phase-e.md) | Phase E — edit one block in Source, the transform operations, paste as scratch, diff; ends with v0.5.0 |
| [06-story-index.md](06-story-index.md) | Every story on one page: id, title, model, size, dependencies, wave |
| [progress.md](progress.md) | The ledger the lead keeps; the only record of state |

The decision records the plan relies on are proposed in `docs/adr/0044` to `0051` and the
amendment to `docs/adr/0037`; the author accepts or strikes them before Phase A's second wave.

## How to start a session as the lead

1. Read `00-orchestration.md`, then `progress.md`, then the current phase document.
2. Pick the next wave whose dependencies are merged; check no live worktree touches its paths.
3. Spawn one implementor per story with the briefing in `00-orchestration.md` §3; record
   `running` in the ledger.
4. For each PR, spawn a reviewer (§4); relay the verdict; record the state.
5. When the wave is merged, write its outcome in the ledger and start the next.

## How to start a session as an implementor

Read your story's section and the files it names; nothing else is assumed. The briefing you were
given is in `00-orchestration.md` §3.
