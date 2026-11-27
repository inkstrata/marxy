# Hunt 01: Findings

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### EXP-01 · Using the Export tab freezes the app
- Severity: S1 freeze
- Domain: export
- Where: apps/desktop/src/left/panels/export.ts (not yet located)
- Repro: owner's report, macOS build: open the Export panel (the seventh) and use it; the app stops answering. Which choice or which file triggers it is not yet known
- Expected: the panel answers; an export saves through the save dialog and the window keeps working
- Actual: the app freezes
- Evidence: the owner's report, 2026-11-27; not yet reproduced
- Confidence: low
- Found by: owner, 2026-11-27
