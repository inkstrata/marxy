# Rulings on the open questions

**Date:** 2026-10-02. The author's answers to the 21 questions gathered in `06-story-index.md`.
The author accepted every stated default, and the plan's assumptions stand. Where a ruling
changes a story's text, that story says so. A story the author rules out is `parked` in
`progress.md` with the ruling.

## The three that gate early work (questions 1, 2 and 9)

1. **The ADR amendments are accepted.** ADR-0044 to ADR-0051 are `accepted`, and the ADR-0037
   amendment stands. Phase A's second wave may start.
2. **A searchable list of folders is not "library browsing".** The brief's exclusion
   (`docs/brief.md:72`) means a managed library: a catalogue, a tree, a shelf you wander. A
   declared list of folders, searched from the palette and never browsed, is consistent with it.
   `docs/brief.md` stays as written. C-01 records this reading in the collection ADR as the
   author's, not as an open question.
3. **Remote images (B-20): ADR-0044's mechanism, key `remote_images`.** The CSP stays closed. The
   shell reloads the webview with `img-src https:` added when the setting is `always` or the
   reader says yes in the notice, and the reload reopens at the reading position. The permanent
   `img-src https:` is rejected, and so is parking. The key is `remote_images` (snake case, like
   `line_numbers`); ADR-0044 and its index row now say so. B-20 is unconditional, and it opens
   with a spike for the reload, as its mechanism (b) already says.

## The rest: defaults accepted

| # | Ruling |
| --- | --- |
| 4 | The light/dark toggle is saved to `config.toml`. |
| 5 | Config is read before first text, a few milliseconds, to avoid a dark-to-light flash. |
| 6 | v0.1.0 is macOS only (ADR-0046); the Linux AppImage and deb stay in `release.yml` as best effort, unverified. |
| 7 | WebKit tests that fail on Linux in A-10 are fixed if under an hour each, otherwise deleted with a note. |
| 8 | A-07 only adds `orchestration/PAUSED.md`; `loop.sh` does not refuse to start. |
| 10 | The Linux weight table: delete the version rows, keep a documented +100 constant. |
| 11 | `setWindowControls` is deleted until built. |
| 12 | `justif`'s hyphenation patterns are vendored if B-17 finds their licences MIT-compatible. |
| 3 | Rendered find stays in Phase D (D-03 pure, D-13 bound to the focused pane). |
| 13 | A plain click replaces in place; Cmd/Ctrl-click opens in the neighbour pane. |
| 14 | A file launched while a layout is saved: restore the layout, put the file in the focused pane. |
| 15 | A link opens a non-Markdown source file in Source beside only on Cmd-click. |
| 16 | The three taste calls ship as planned, each behind one constant; revisit on the built app. |
| 17 | `Mod+Enter` edits, `Enter` keeps the verb menu, `Alt+Shift+Down` extends a multi-block selection. |
| 18 | The E-12 spike is approved; the Rust capability is decided on its result. |
| 19 | A scratch document the reader only reads closes without a prompt. |
| 20 | JSON alone, unless the YAML structure check is tight. |
| 21 | "Show what changed" compares against the version before the last reload. |
