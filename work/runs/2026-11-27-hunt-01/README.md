# Hunt 01

The first bug hunt (the bug cycle: `.claude/skills/bug-catch`, `bug-verify`, `bug-triage`), started
2026-11-27 on `agent/hunt-01`, cut from `agent/bug-cycle` (the skills, pull request #779) at `main`
`14aefa0a` plus that branch.

## Goal

Find the bugs a reader of the macOS build would meet first, ahead of the v0.2.0 pre-release, and turn the
verified ones into ready rows in `todo.md`.

## The owner's reports

- Using the Export tab freezes the app (`EXP-01`, a lead for the export catcher). Found as `EXP-02`; the owner
  confirmed on 2026-11-27 that the freeze was a long file exported as a web page.
- Go does not work on the search page (`NAV-01`, a lead for the navigation catcher, whose brief adds the Line and palette).
- The Find and Replace fields read "Find Find" and "Replace Replace" (`NAV-02`, sent to the navigation catcher after it started).
- The app freezes in search mode (`NAV-03`, sent to the navigation catcher; may be the cause of NAV-01).

## Domains

| Prefix | Domain | Port |
| --- | --- | --- |
| EXP | export, print, copy out, the tray | 1441 |
| EDT | editing and saving | 1442 |
| VWR | viewers and file kinds | 1443 |
| NAV | navigation and panes | 1444 |
| RDR | reading and rendering | 1445 |
| SHL | the Rust shell | 1446 |

Not in this hunt: CMD (commands, keys, the Line) and LOK (look, Studio, settings).

## Counts

Filled in as the steps finish.
