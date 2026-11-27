# Hunt 02: findings

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### NAV-01 · Moving through the left and right menus freezes the window, often (not only) with a big file open
- Severity: S1 freeze
- Domain: navigation and panes
- Where: apps/desktop/src/left/frame.ts, apps/desktop/src/left/panels/ (unconfirmed)
- Repro: owner's report, 2026-11-27: navigating through the left menus (rail panels, drawer) and the "right menus" (unclear which: the right-click verb or tab menu, Look/Settings at the rail's foot, or the Spine), more often with a big file open. No steps or file given.
- Expected: switching panels and opening menus keeps the window answering, at any file size
- Actual: the window freezes
- Evidence: owner's report only. Hunt-01 rows B1 (Export as web page), B2 (Search regex) and B3 (long unbroken run) are known freezes and have builders; this report is about something else
- Confidence: low
- Found by: owner, 2026-11-27
