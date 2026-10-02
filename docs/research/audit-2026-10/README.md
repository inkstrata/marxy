# Project audit, October 2026

A research, test and recommendation corpus over the whole of Marxy: the product code, the
agent-fleet orchestrator that built it, the decisions that bind it, its speed, and the three
feature directions the author has raised. Produced 2026-10-01 by a lead agent synthesising ten
specialist studies; every number in it comes from a command recorded beside it.

Read `00-executive-summary.md` first. It stands alone. The rest is evidence and depth.

| # | Document | What it answers |
| --- | --- | --- |
| 00 | [Executive summary](00-executive-summary.md) | Where the project is, what to do with the codebase and the orchestrator, in what order |
| 01 | [Codebase audit](01-codebase-audit.md) | What works end to end, architecture as built vs designed, module quality, dependencies |
| 02 | [Orchestrator audit](02-orchestrator-audit.md) | What the fleet is, its history of stalls and fixes, its cost on a person, options going forward |
| 03 | [Fleet metrics](03-fleet-metrics.md) | The numbers: runs, attempts, lead times, ops vs product share, CI minutes, human interventions |
| 04 | [Tests and gates](04-tests-and-gates.md) | Every automated check, what it protects, a local run of all of them, a pruned PR path |
| 05 | [Performance audit](05-performance-audit.md) | Measured cold start, parse, render, typeset, palette, scaling, and the honesty of the perf gate |
| 06 | [Feature: collections and quick search](06-feature-collection-and-search.md) | A tracked collection of files with a search bar to jump between them |
| 07 | [Feature: split view](07-feature-split-view.md) | Tiling-style splits to park documents side by side |
| 08 | [Feature: text operations](08-feature-text-operations.md) | Clipboard and text manipulation with simple click tools; the writing question |
| 09 | [Decision inventory](09-decision-inventory.md) | Every binding decision, its evidence, its enforcement, what it forecloses |
| 10 | [Over-fit decisions](10-overfit-decisions.md) | Which decisions the restated spirit keeps, loosens or drops; the proposed ADR amendments |
| 11 | [Corpus additions](11-corpus-additions.md) | The five new fixture texts and what each exercises |
| 12 | [Recommendation: the codebase](12-recommendation-codebase.md) | How to manage the product code from here |
| 13 | [Recommendation: the orchestrator](13-recommendation-orchestrator.md) | How to manage the fleet from here, and when to resume it |
| 14 | [Roadmap proposal](14-roadmap-proposal.md) | A re-sequenced plan toward the restated spirit |

## How it was made

Ten specialist agents worked in parallel in one worktree, each on one document, under a shared
briefing that required every number to come from a recorded command and forbade touching any
file but their own. Three ran on Claude Opus (codebase, orchestrator, performance) and seven on
Claude Sonnet (metrics, tests, the three feature studies, the decision inventory, the corpus).
The lead read the repository, the fleet store and the screenshot baselines directly, wrote
documents 00, 10, 12, 13 and 14, and edited the rest only where a claim did not survive a check.

Nothing here changes the product. The one code-adjacent change in the same pull request is the
five corpus texts and their provenance note.
