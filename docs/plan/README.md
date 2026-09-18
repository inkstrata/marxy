# The backlog, and its relationship to Jira

The board of record is the Jira project **MARXY** at <https://marxy.atlassian.net>: every epic
and story below exists there, and status lives there. This directory holds the same backlog in
the form scripts can read, because the gates need acceptance criteria and path boundaries as
text, not as API responses.

- `jira-issues.csv` — epics (one per phase) and vertically sliced stories with machine-checkable
  acceptance criteria and the paths each story may touch. The `Key` column holds the real Jira
  key. It is the source of truth for *what a story is*; Jira is the source of truth for
  *where a story stands*.
- `../../orchestration/jira.mjs` — the bridge. `sync` pushes summary, description and labels
  from the CSV into Jira and creates any row that has no issue yet; `push` makes Jira's statuses
  match the local board; `doctor` says whether credentials, project and statuses are sane.
  Credentials come from `~/.config/marxy/jira.env`, never from the repo.
- `../../orchestration/jira-map.json` — the phase-encoded plan ids used before the import,
  mapped to the keys Jira assigned, so commits, ADRs and plan deltas written before the tracker
  existed remain readable. It is the only file that still carries the old ids, along with the
  fixture corpus, whose bytes are never edited.

`docs/sdlc.md` describes the states, the definitions of ready and done, and the release runbook.

## Conventions in the issues

- **Summary** starts with a verb and names the observable result.
- **Acceptance criteria** are machine-checkable; each maps to a test or gate in the PR.
- **Paths** lists the directories the branch may touch (ADR-0017). One agent per story.
- **Labels**: `phase-0..4`, `typography`, `speed`, `security`, `agent-loop`, `release`,
  `research`, `human-gated`; `blocked` and `escalated` are applied by the orchestrator.
- **Key ordering** follows the plan: epics and stories were imported in plan order, so
  MARXY-4 is the Phase 0 epic and MARXY-5 its first story.
- A story the planner adds arrives with a placeholder key (`MARXY-NEW-<slug>`); `jira.mjs sync`
  creates the issue and rewrites the placeholder to the key Jira assigned.
