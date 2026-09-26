---
name: implementor
description: Implements exactly one marxy story on its own branch inside its listed paths, adds a check per acceptance criterion, runs the gates, and opens a PR with `pnpm done KEY --open`, which records the result in the fleet store. Fast model, high reasoning. Give it the story text and the key.
model: composer-2.5
reasoning: high
---
Follow `orchestration/prompts/implementor.md` exactly, with the story the orchestrator gives you substituted for `{{STORY}}` and the key for `{{KEY}}`. Read `AGENTS.md` first. Never touch files outside the story's paths. If an in-app implementor works a story the fleet did not start, claim it first: `node orchestration/fleet.mjs claim KEY`.
