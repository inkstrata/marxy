# Plan delta — 2026-09-21: Mac-shell gaps, and unblocking MARXY-16

Trigger: an investigation session into what a proper macOS app for marxy still needs, and the author's
follow-up ruling: "we are no longer guaranteeing the 500 ms budget. Let's unblock as much as
possible."

## MARXY-16 no longer depends on MARXY-15

The dependency existed because `needs-human.md` asked whether the 500 ms cold-start figure was
still a commitment and whether MARXY-16 (the v0.0.1 release) should wait on it being enforced.
**That question is already answered, and has been since 2026-09-18:**

- **ADR-0029 — There is no product cold-start ceiling.** Accepted. "There is no product
  cold-start budget. `cold_start_first_text_ms` is a standing observation... A slower launch is
  a cost a story must own; CI never writes a higher number into the repo to make a red gate
  green."
- **ADR-0032 — Speed numbers are recorded; they are not CI failures.** Accepted 2026-09-20,
  extending the same ruling to every timing quantity, not only cold start.

Both amend ADR-0013 and are sourced to "the author's ruling." The `needs-human.md` checklist item asking
for this ruling was simply never marked discharged, and `orchestration/deps.json` was never
updated to match, so MARXY-16 kept waiting on MARXY-15 for three days after the question that
dependency existed for had an answer on record. This delta fixes the board; a parallel PR is
separately fixing `needs-human.md`'s own staleness, so that file is not touched here:

- `orchestration/deps.json`: `MARXY-16` deps become `[MARXY-13, MARXY-5]`, both done. MARXY-16 is
  now ready.
- `docs/plan/tasks/MARXY-16.md` frontmatter and body updated to match.

**MARXY-15 is untouched otherwise.** Its scope already shrank to reporting the recorded numbers
as a PR comment (`docs/plan/deltas/2026-09-18-cold-start-metric-falsified.md` decision 1; the
current CSV row's acceptance is entirely about `results/perf.json` and a PR-comment format, not
about enforcing a budget). It stays `blocked`/parked for the unrelated implementation-debt reason
already on record (leftover of MARXY-63/69/70/151) and is free to be picked up on its own
schedule — it just no longer gates a release.

## Three Mac-shell stories filed

An investigation session found the app has no code path for how a reader normally opens a file on
a Mac outside the command line, and no story owned any of it. Filed against the phase they belong
to (not the `ops` lane — this is reader-facing behaviour, not process/CI/release plumbing):

| Key | Summary | Phase | Depends on |
| --- | --- | --- | --- |
| MARXY-183 | Single instance, second launches, and macOS/Linux open events route to the running window | 2 | — |
| MARXY-184 | Native File and Edit menu: Open File, Close, Quit, and standard editing commands | 3 | MARXY-49 |
| MARXY-185 | Document how to put the `marxy` CLI on PATH after installing the app | 4 | MARXY-16 |

Full descriptions and acceptance criteria are in `docs/plan/jira-issues.csv`. Notes on scope:

- **MARXY-183** consolidates single-instance routing, Finder double-click/"Open With", and
  dragging a file onto the Dock icon into one story, because on macOS all three arrive at the
  same `RunEvent::Opened` handler and all three feed the same already-frozen `onOpenFiles` member
  of `shell-api`. `docs/design/06-shell.md` already specified this mechanism and credited it to
  MARXY-33 — but MARXY-33 shipped the cold-start waterfall instead (repurposed at some point
  without the design doc being corrected), and neither the single-instance plugin nor the
  `RunEvent` handler was ever built. `apps/desktop/src-tauri/Cargo.toml` carries no Tauri plugins
  at all today.
- **MARXY-184** is deliberately minimal: only the items the OS and every reader already expect
  (Open, Close, Quit, standard editing), nothing document-specific. That boundary is ADR-0011
  ("the palette is the tab manager; no tab bar") — this story does not reopen it. Without any
  native menu today, `Cmd+Q` and standard `Cmd+C/V/A` editing shortcuts inside CodeMirror or the
  palette's search input are not guaranteed to work, since AppKit wires those from menu-item
  validation, not from the keyboard alone.
- **MARXY-185** is a README-only story, included because it costs one section, not a code
  project — parity with the `marxy file.md` CLI invocation the whole reader is designed around
  (ADR-0001) not working from an installed app.

Not filed as stories, left as-is with an owner already: entitlements/hardened runtime, the Intel
DMG matrix row, notices/about, Flatpak (all MARXY-52); the open/save dialog commands (MARXY-49);
clipboard and opener (MARXY-42/45/47); the app icon (`.icns`/`.ico`, MARXY-16 itself). No updater,
crash reporter or telemetry is being proposed anywhere in this delta (ADR-0009 §4 stands).

## Still open, still the author's

`needs-human.md`'s 2026-09-18 question — whether a Linux desktop exists for MARXY-22 (the weight
harness) and whether an Apple Developer account exists for notarization (MARXY-52, MARXY-54) — is
unrelated to this delta and unanswered. Nothing here resolves it. The staleness of
`needs-human.md` itself (this item and the cold-start item both sitting unchecked past their
answer) is being fixed by a parallel PR, not this one.

## How we would know this was wrong

1. ADR-0029 or ADR-0032 gets superseded by a new ADR restoring a cold-start ceiling before MARXY-16
   ships — then the dependency this delta removed should come back, explicitly, with its own ADR
   citation.
2. MARXY-183's consolidation turns out wrong because Linux/Windows single-instance routing and
   macOS's `RunEvent::Opened` need materially different review or testing — then split it before
   implementation, not after.
3. MARXY-184's menu turns out to need more than Open/Close/Quit/Edit to make the app usable (e.g.
   Tauri's default menu already supplies some of this cross-platform) — the implementor's first
   move should be checking what Tauri 2 provides with no `.menu()` call at all before adding
   items, and narrowing the acceptance criteria if some are already met.

## Taste review

Nothing visual changed; no queue entry owed.
