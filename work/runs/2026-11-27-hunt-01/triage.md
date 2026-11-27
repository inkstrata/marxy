# Hunt 01: triage

Every finding's outcome, in id order. Rows are in `work/todo.md`. Where a finding has two verdicts, the
later one counts (SHL-04: PLAUSIBLE on a re-read, then CONFIRMED on the verifier's own run). Severity is the
verifier's.

| Id | What the reader meets | Catcher | Verdict | Outcome |
| --- | --- | --- | --- | --- |
| EDT-01 | "Save and close" on a staged file no pane shows fails without a word | S2 | CONFIRMED, S2 | B6 (Next) |
| EDT-02 | after a save throws during "Save and close", close and Quit never ask or close again | S2 | PLAUSIBLE, S3 | dropped: the stuck state is real, but no ordinary path throws (`store.save` catches write errors); the possible throws (a scratch document's save dialog, `foldSource`, `flushVersions`) were not driven |
| EDT-03 | HTML pasted into Source of a code file goes in as Markdown | S2 | BY-DESIGN, S3 | B13 (Waiting on Ian): the doc promises it, but it puts fences in `.py` and makes JSON invalid; a decision, not a repair |
| EXP-01 | using the Export tab freezes the app (owner) | S1 | DUPLICATE of EXP-02 | B1; the owner confirmed the trigger: a long file, as a web page |
| EXP-02 | exporting a long open file as a web page freezes the window | S1 | CONFIRMED, S1 | B1 (Next) |
| EXP-03 | macOS print may lose its print rules before the sheet draws | S2 | PLAUSIBLE, S2 | B12 (To try in a real window) |
| EXP-04 | a selection exported as written from a bare-CR file is empty | S2 | CONFIRMED, S2 | B7 (Next) |
| EXP-05 | a double click on Save opens two save dialogs | S3 | CONFIRMED, S3 | B15 (Later) |
| NAV-01 | Go does not work on the search page (owner) | S2 | DUPLICATE of NAV-06 | B11 (To try in a real window) |
| NAV-02 | Find and Replace fields read "Find Find", "Replace Replace" (owner) | S3 | DUPLICATE of NAV-05 | B10 |
| NAV-03 | the app freezes in search mode (owner) | S1 | DUPLICATE of NAV-04 | B2 |
| NAV-04 | a backtracking regex in the Search panel freezes the window | S1 | CONFIRMED, S1 | B2 (Next) |
| NAV-05 | the Search panel's fields show label and placeholder as one word twice | S3 | CONFIRMED, S3 | B10 (Next, as the owner's report) |
| NAV-06 | Go on the search page could not be made to fail | S3 | NOT-REPRODUCED | B11: kept as a real-window row because the owner saw it |
| RDR-01 | X-ray "As written" drops a leading BOM | S3 | CONFIRMED, S3 | B16 (Later) |
| RDR-02 | a pane's resize observer is unobserved on the wrong element | S3 | PLAUSIBLE, S3 | dropped: S3 and not driven |
| RDR-03 | a wide right-to-left table cannot be scrolled | S2 | CONFIRMED, S2 | B8 (Next) |
| SHL-01 | from Finder or the Dock, Homebrew and mise programs are not on the PATH | S2 | CONFIRMED, S2 | B4 (Next) |
| SHL-02 | a link whose case differs from the disk is refused on a Mac | S2 | PLAUSIBLE, S3 | dropped: narrower than found (only the opened root's own case), S3 |
| SHL-03 | a document opened under another spelling of its path never live-reloads | S3 | PLAUSIBLE, S3 | dropped: S3, code reading |
| SHL-04 | saving a Finder-locked file fails and leaves an undeletable hidden file | S2 | CONFIRMED, S2 | B5 (Next) |
| VWR-01 | a SQLite view stopped at the cap exports to CSV without a note | S2 | CONFIRMED, S2 (code reading) | B14 (Later, to keep Next near fifteen rows) |
| VWR-02 | a mail with one unbroken line freezes on open | S1 | CONFIRMED, S1 | B3 (Next) |
| VWR-03 | a Word document of about 62,000 paragraphs does not open | S2 | CONFIRMED, S2 | B9 (Next) |
| VWR-04 | RTF with one long run freezes on open | S1 | CONFIRMED, S1 | B3, one cause with VWR-02 |

## Noticed, not filed

- `docs/keys.md` says Enter on a panel row opens the verb menu; the code runs the row's own verb (verifier
  NAV). A doc-or-code mismatch to settle when B11 is looked at.
- The Search panel's Replace all with a backtracking pattern was not tried (catcher EDT); B2's fix should
  cover it.
- `shots` cannot drive WebKit, the macOS engine (verifiers RDR and VWR); every probe here ran in Chromium.
- A relative `Location` without a leading slash is refused as cross-host by the remote image fetch (catcher
  SHL), S3.

## Not reached

Commands, keys and the Line, and the look, Studio and settings (not in this hunt). Within the domains: Save
As flows; tabs, split, place keeping and the Outline, Links and Versions panels; font and media parsing in
Rust, OLE `.msg`, EPUB with many blocks; `scope.rs`, archive and decode commands, `cargo test`; ZIP64 and
very large bundles. Nothing was driven in the real macOS window.
