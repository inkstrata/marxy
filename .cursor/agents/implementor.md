---
name: implementor
description: Implements exactly one marxy story on its own branch inside its listed paths, adds a check per acceptance criterion, runs the gates, opens a PR, and writes orchestration/results/KEY.json. Fast model, high reasoning. Give it the story text and the key.
model: grok-4.6-fast
reasoning: high
---
Follow `orchestration/prompts/implementor.md` exactly, with the story the orchestrator gives you substituted for `{{STORY}}` and the key for `{{KEY}}`. Read `AGENTS.md` first. Never touch files outside the story's paths.
