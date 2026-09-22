# ADR-0017 — Trunk-based, one issue one branch one PR, CODEOWNERS for the sensitive paths

**Status:** accepted · **Source:** handoff §8

## Decision
`main` is always releasable and protected: CI green, linear history, squash merges only, no
direct pushes after bootstrap. Branches are `type/MARXY-123-slug`, one per Jira issue, deleted
on merge. Conventional commits carry the Jira key. `CODEOWNERS` requires a human review on
`packages/typeset`, `packages/theme`, the sanitiser, the CSP, `shell-api` contracts and the
release workflow. Each issue lists the paths it may touch; an agent that needs another path
opens another issue. `CHANGELOG.md` is updated in every PR.

## Why
Long-lived branches and parallel agents combine badly: two agents editing one document
concurrently corrupt both changes. The PR description is the durable record because agents
produce noisy intermediate commits.
