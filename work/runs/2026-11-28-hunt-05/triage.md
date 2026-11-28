# Hunt 05: triage

Every finding of round 1 has one verdict. Rows are in `work/todo.md` (B36 to B42). Severity is the verifier's.

| Id | Title | Catcher | Verdict | Outcome |
| --- | --- | --- | --- | --- |
| PRS-01 | Typing in the palette over a big changelog freezes the window for seconds | S1 | CONFIRMED S1 | merged into B36 |
| PRS-02 | Moving one section in a big document parses the whole file again first | S1 | CONFIRMED S1 | merged into B36 |
| PRS-04 | Opening Transforms on a big Markdown file with a BOM freezes the window | S1 | CONFIRMED S1 | merged into B36 |
| PRS-03 | Links or Metadata on a big file scans the whole text once per distinct path | S2 | CONFIRMED S2 | B41 |
| TWO-01 | A second file opened in a pane waits for the first file's whole parse | S2 | CONFIRMED S2 | B37 |
| SCH-01 | A small file opened after a big Markdown one waits for the big one's open | S2 | DUPLICATE of TWO-01 | merged into B37 |
| TWO-02 | The same large file opened in both panes takes 18 to 30 s | S2 | NOT-REPRODUCED (the 1 s baseline was wrong: a lone 3 MB open takes 18.9 s; no double parse) | dropped |
| TWO-03 | Opening several files from the system opens only the first | S2 | CONFIRMED S2 (real function; not driven in the window) | B40 |
| TWO-04 | A file edited while a large open is still parsing shows the old version for good | S2 | CONFIRMED S2 | B39 |
| TWO-05 | Asking for the file already open reads and parses it all again | S2 | CONFIRMED S2 | B38 |
| SCH-02 | Colouring the code in view crawls while a background parse is slicing | S3 | NOT-REPRODUCED (highlighting runs in a worker, 95 ms with and without a busy input lane) | dropped |
| SCH-03 | Code blocks in the first screens stay uncoloured until the page has mounted | S3 | CONFIRMED S3 | B42 |

B36 is a cause row: three symptoms, one missing owner of "the parse of this version".

## Not reached

- Real window and the Rust watcher gap (TWO-03 and TWO-04 are driven in the browser build only).
- Tab switch, Back and Forward with a warm store while a parse is in flight.
- Highlight jobs of a closed document run until the next `tokenize`; a rows view destroyed before it settles leaves `settled()` pending; `rendered-view.ts:2908-2916` does not recheck `store !== next`; `render/progressive.ts` and `startup/idle-work.ts` are off the scheduler (SCH catcher, unverified).
- `commands/transform.ts:110,148` and `commands/copy-as.ts:72,111` probably share B36's cause with a BOM or CRLF file; Ctrl+K itself costs about 3.6 s on any 2 MB file (verifier A); `source/notes.ts` parses a second time on every Source edit up to 4 MB.
- WKT (WebKit on macOS), left out of this hunt.
- Nothing in `src` outside the highlight worker uses the `viewport` or `background` scheduler lanes (verifier D).
