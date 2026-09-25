# .cursor

- `rules/` — always-on project rule (points at `AGENTS.md`) and two path-scoped rules for frozen
  contracts and the human-reviewed typography/security paths.
- `agents/` — subagent definitions for `planner`, `implementor`, `reviewer`. Frontmatter field
  names (`model`, `reasoning`) follow the common convention; if your Cursor build uses different
  keys, adjust here only — the behaviour lives in `orchestration/prompts/`.
- `environment.json` — background-agent environment (mise + pnpm). Fill `snapshot` from
  Cursor's settings if you use cloud background agents.

Model ids in `agents/*.md` are the **default** compute profile (Opus 5.5 medium for the
planner, Sonnet 5 high for the reviewer, Composer 2.5 for the implementor). Escalation in
that profile is Opus 5.5 medium. `orchestration/models.json` also has `high` (Opus 5.5 medium for planner, escalation,
and reviewer), `low` (Sonnet 5 medium, Grok escalation), and `minimal` (Composer 2.5, with the
planner on Grok 4.7 high and escalation on Grok 4.6). When compute is not `default`, the
orchestrator passes the role's `inApp` model instead of the frontmatter default. Verify ids
against the picker once and edit both.
