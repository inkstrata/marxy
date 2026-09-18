# .cursor

- `rules/` — always-on project rule (points at `AGENTS.md`) and two path-scoped rules for frozen
  contracts and the human-reviewed typography/security paths.
- `agents/` — subagent definitions for `planner`, `implementor`, `reviewer`. Frontmatter field
  names (`model`, `reasoning`) follow the common convention; if your Cursor build uses different
  keys, adjust here only — the behaviour lives in `orchestration/prompts/`.
- `environment.json` — background-agent environment (mise + pnpm). Fill `snapshot` from
  Cursor's settings if you use cloud background agents.

Model ids in `agents/*.md` and `orchestration/models.json` must match Cursor's picker; verify
once and edit both.
