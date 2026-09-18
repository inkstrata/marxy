# Jira structure

The Atlassian connector was not authorised in the session that produced this plan, so the
issues are delivered as an import file plus a script rather than created directly.

- `jira-issues.csv` — epics (one per phase) and vertically sliced stories with executable
  acceptance criteria and the paths each story may touch. The project key is written as
  `MARXY`; replace it if the provisioned project uses another key.
- `../../scripts/jira-import.mjs` — creates the epics and stories through the Jira Cloud REST
  API v3, linking stories to their epic. Needs `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`,
  `JIRA_PROJECT_KEY` in the environment. Discovers the issue-type ids (Epic / Story) from the
  project's scheme rather than assuming them.

Alternatively, Jira's CSV importer accepts the file directly (map `Issue Type`, `Summary`,
`Description`, `Epic Name`, `Parent`, `Labels`).

## Conventions in the issues

- **Summary** starts with a verb and names the observable result.
- **Acceptance criteria** are machine-checkable; each maps to a test or gate in the PR.
- **Paths** lists the directories the branch may touch (ADR-0017). One agent per story.
- **Labels**: `phase-0..4`, `typography`, `speed`, `security`, `agent-loop`, `release`.
- **Key ordering** follows the plan; MARXY-001 is the first story of Phase 0.
