# Task cards

One card per story, keyed by Jira key. A card is what an implementor reads after `AGENTS.md`:
the outcome in plain words, the exact files and signatures, the order to build in, the tests
with their expected results, and what not to do. Cards point into `docs/design/` by section
and never restate a design; if a card and a design disagree, the design wins and the card is
fixed in the PR.

The planner writes a card for every new story before it is dispatched (`orchestration/prompts/planner.md`).
