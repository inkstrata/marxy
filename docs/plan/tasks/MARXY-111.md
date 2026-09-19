---
key: MARXY-111
design: []
depends: []
verify: [pnpm done MARXY-111]
---
# MARXY-111 — Land the after-8 plan on main so MARXY-79 can rebase

**Depends on:** none · **ADRs:** none. Commits planner files already written.

**Outcome.** `origin/main`'s CSV has 79's new Paths and the 109 / 110 rows.
A 79 worktree cut from that main can add `orchestration/prompt-handshake.test.mjs`
without `check-story.mjs` failing.

Worktrees are cut from `origin/main`. Copy the listed files from the dirty
primary checkout (`/Users/ian/Dev/marxy`) if they are not already on the
branch. Do not invent new stories.

## Files (copy, do not rewrite)
- `docs/plan/jira-issues.csv` — 79 Paths are the prompt slice; 109 and 110 rows present
- `orchestration/deps.json` — phase 0 includes 109, 110, 111; 79/109/110 wait on 111
- `orchestration/jira-map.json` — `MARXY-NEW-after-8-plan` → `MARXY-111`
- `docs/plan/deltas/2026-09-19-after-8.md`
- `docs/plan/tasks/MARXY-79.md`, `MARXY-82.md`, `MARXY-109.md`, `MARXY-110.md`
- `docs/design/12-outline.md`, `docs/design/README.md`

`CHANGELOG.md` is an implicit extra. This card is an extra (`docs/plan/tasks/MARXY-111.md`).

## Do this, in order
1. Branch from current `origin/main`.
2. Bring in the listed files as they stand on the primary checkout.
3. Run the path-match check in Acceptance 3. Confirm 79's Paths string.
4. CHANGELOG line under Unreleased. Open the PR.

## Tests → expected
| Check | Expect |
| --- | --- |
| CSV MARXY-79 Paths | `orchestration/prompts, orchestration/prompt-handshake.test.mjs, docs/sdlc.md` |
| CSV 109 and 110 | both rows present, Paths and Acceptance non-empty |
| `pathMatches` of `orchestration/prompt-handshake.test.mjs` vs 79 Paths | true |
| `pathMatches` of `orchestration/cycle.mjs` vs 79 Paths | false |
| `docs/design/12-outline.md` first heading | `# 12 — Outline from the AST` |
| three-dot name list | no `cycle.mjs`, no `ci.yml`, no `package.json` |

## Path-match check (Acceptance 3)

From the repo root. Handshake must exit 0; cycle must exit 1.

```sh
node --input-type=module -e 'import { readFileSync } from "node:fs"; import { parseCsv, pathsOf, pathMatches } from "./orchestration/lib.mjs"; const file = process.env.FILE; const st = parseCsv(readFileSync("docs/plan/jira-issues.csv", "utf8")).find(r => r.Key === "MARXY-79"); process.exit(pathsOf(st).some(a => pathMatches(file, a)) ? 0 : 1);'
```

`FILE=orchestration/prompt-handshake.test.mjs` → exit 0.
`FILE=orchestration/cycle.mjs` → exit 1.

## Acceptance → check
CSV criteria 1–9. The path-match one-liner above is the check for criterion 3.

## Do not
Edit `orchestration/cycle.mjs`, `.github/workflows/ci.yml`, or `package.json`.
Re-plan, split, or rewrite 36 / 59 / 65 / 77 / 91 / 106 / 107. Reopen #28,
#21, #51, #52. Implement 79, 82, 109, or 110 in this PR.
