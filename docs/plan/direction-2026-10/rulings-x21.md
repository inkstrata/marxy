# Rulings on the X-21 questions

**Date:** 2026-10-12. The author's answers to the 22 questions in
[`17-design-pass-chrome.md`](17-design-pass-chrome.md) (section "Questions for the author").
The author approved the review and accepted every recommended default. The cards keep their
text, and each card's own done-check still applies.

| # | Question | Ruling |
| --- | --- | --- |
| 1 | One notice region or one per pane; where it floats | Per pane; app news in the focused pane; floats at the pane's bottom centre, F-46's top edge as the stopgap |
| 2 | Transient or persistent | Outcomes fade at 4 s (paused under the pointer or focus); refusals and errors stay until dismissed; decisions stay until answered |
| 3 | Where a decision lives | A floating notice with its actions, focus moved to it, answerable from the keyboard; the native dialog stays for window close |
| 4 | Clipboard surface | Not in this pass; copy and paste use the common pill |
| 5 | Refusals and errors vs outcomes | Different by glyph and word as well as `--marxy-color-status-*`, never colour alone |
| 6 | Sound or OS notification | Never by default; any opt-in is a later question |
| 7 | History of notices | Bounded in-memory list behind "Recent notices"; nothing on disk |
| 8 | Progress for slow work | In the status bar when W-11 exists; otherwise a quiet pill that becomes the outcome |
| 9 | Keys | One key focuses the newest notice; Esc dismisses a focused notice; Esc's existing order is unchanged |
| 10 | Wording | One template: "what happened · what is unchanged · what to do" |
| 11 | What may proceed during the pass | Wrong-text fixes and F-46 proceed; new notice kinds and popups wait for U-02 |
| 12 | The dead column | Bands run to the window edge; the reading column stays window-centred (U-01) |
| 13 | Source frame | Build V-05 as the mock draws it, folded too; the column sits inside the frame at ADR-0067's measure. **Departed from, 2026-10-14 (F-100):** the author's note, "gutters in collapsed view are also wrong for source; in general we want to fill the window with our editor"; the frame keeps its hairline, radius and 14 px inset but is no longer capped at 960 px, and the editor fills it (no centred column). |
| 14 | Line numbers for Markdown in Source | Off, as today, with `Ln, Col` in the bottom bar |
| 15 | Transform sheet's primary action | Copy, one rule with the palette (U-05) |
| 16 | Palette rows | Two-line, 46 px in the palette (U-04) |
| 17 | Toolbar | Icons with tooltips; words only on the Read / Split / Source control (U-03) |
| 18 | Narrow window | Undock the sidebar below 900 px (U-08) |
| 19 | Unfolded default view | Read, as today; per-kind default in Settings (W-12) |
| 20 | Sidebar style | Inset card once the title bar is an overlay (ADR-0038); flush panel until then |
| 21 | Front matter in Read | Settle with W-17; until then, the head stays as `10-spec.md` has it today |
| 22 | Adopt ADR-0070 | Yes. [ADR-0070](../../adr/0070-every-ui-story-ships-a-pair.md) is accepted |

**Effect on the ledger.** The U-cards (U-00 to U-10) and V-05 move from "waiting on X-21" to
"ready" in [`progress.md`](../roadmap-2026-10/progress.md).
