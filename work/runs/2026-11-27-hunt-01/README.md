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

25 findings from 6 catchers (4 of them the owner's reports, written before or during the catch), 26
verdicts from 8 verifiers (one finding was re-verified), 16 tracker rows. All agents were Sonnet at medium
effort; each area was verified as soon as its catcher reported.

| Domain | Findings | Confirmed | Plausible | Not reproduced, duplicate, by design | Rows | S1 rows |
| --- | --- | --- | --- | --- | --- | --- |
| EXP | 5 | 3 | 1 | 1 | 4 (B1, B7, B12, B15) | 1 |
| NAV | 6 | 2 | 0 | 4 | 3 (B2, B10, B11) | 1 |
| VWR | 4 | 4 | 0 | 0 | 3 (B3, B9, B14) | 1 |
| SHL | 4 | 2 | 2 | 0 | 2 (B4, B5) | 0 |
| RDR | 3 | 2 | 1 | 0 | 2 (B8, B16) | 0 |
| EDT | 3 | 1 | 1 | 1 | 2 (B6, B13) | 0 |

Most productive: viewers (every finding confirmed, two freezes) and export (the owner's freeze found and
explained). The shell catcher found real macOS-only faults but half its findings were code reading that the
verifier could not drive. Every outcome is in `triage.md`.

## For the next hunt

- Domains not yet hunted: CMD (commands, keys, the Line) and LOK (look, Studio, settings).
- Long unbroken input is the richest seam (B3, B9, B2): a hunt across every reading path with one long run,
  one long line and many short lines would likely find more.
- WebKit cannot be driven by `shots`; a probe through `scripts/browser-tests.mjs` would test the macOS
  engine.
