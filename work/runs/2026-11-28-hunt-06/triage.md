# Hunt 06: triage

Every finding has one verdict. Rows are in `work/todo.md` (B43 to B55, and W11). Severity is the verifier's. Ids B36 to B42 belong to hunt 05's pull request, so this hunt starts at B43.

| Id | Title | Catcher | Verdict | Outcome |
| --- | --- | --- | --- | --- |
| EDT-01 | In Source a CRLF line's CR is a caret position, so End then typing or Backspace changes the line ending | S1 | CONFIRMED S1 | B43 |
| EDT-02 | The block editor does the same | S2 | CONFIRMED S2 | merged into B43 |
| EDT-03 | Enter before the CR turns CRLF into LF | S2 | CONFIRMED S2 | merged into B43 |
| NAV-05 | Alt+Left and Alt+Right do not follow the head's Back and Forward | S2 | CONFIRMED S2 | B44 |
| CMD-04 | Forward does nothing after a Back over a followed link | S2 | DUPLICATE of NAV-05 | merged into B44 |
| NAV-01 | A link to a non-ASCII, digit-first or long heading does nothing | S2 | CONFIRMED S2 | B45 |
| NAV-02 | A percent-encoded anchor never lands | S3 | CONFIRMED S3 | merged into B45 |
| NAV-04 | A first-time open appears at the previous document's scroll offset | S2 | CONFIRMED S2 (browser build) | B46 |
| CMD-01 | In Source the Line leaves the caret at line 1 | S2 | CONFIRMED S2 | B47 |
| CMD-02 | Holding a page key repeats the change | S2 | CONFIRMED S2 | B48 |
| VWR-05 | Trailing commas in a spreadsheet number format are ignored | S2 | CONFIRMED S2 | B49 |
| VWR-06 | Optional `#` decimals are zero-padded | S3 | CONFIRMED S3 | merged into B49 |
| VWR-08 | A list in an ODT table cell runs together | S2 | CONFIRMED S2 | B50 |
| VWR-03 | A numbered list in a Word cell loses its numbers | S3 | CONFIRMED S3 | merged into B50 |
| VWR-09 | An ODT comment in a cell is never shown | S3 | CONFIRMED S3 | merged into B50 |
| VWR-10 | A continued ODT list restarts at 1 | S3 | CONFIRMED S3 | merged into B50 |
| NAV-03 | Relative links fail in a folder named with `#`, `%` or `?` | S2 | CONFIRMED S3 (was S2) | B51 |
| NAV-06 | The Links panel marks `b%231.md` dead though it opens | S3 | CONFIRMED S3 | merged into B51 |
| LOK-01 | With a look on, Settings' Text size and Variant change nothing | S3 | CONFIRMED S3 | B52 |
| LOK-05 | The Studio turns looks on at its first dial move | S3 | DUPLICATE of LOK-01 | merged into B52 |
| LOK-03 | Mod+= and Mod+- freeze `variant = "auto"` | S3 | CONFIRMED S3 | merged into B52 |
| LOK-04 | Out-of-range `size`, `measure` and a wrong-typed `theme` are silent | S3 | CONFIRMED S3 | merged into B52 |
| CMD-03 | Mod+Shift+= and the numpad plus do not enlarge the text | S3 | CONFIRMED S3 | B53 |
| CMD-06 | Next and Previous tab listed twice; `g Shift+T` labelled "T" | S3 | CONFIRMED S3 | merged into B53 |
| CMD-07 | The Line reads `file:12:5` and `:9-5` wrongly | S3 | CONFIRMED S3 | merged into B53 |
| VWR-01 | An address followed by a `(comment)` is misread | S3 | CONFIRMED S3 | B54 |
| VWR-02 | 8-bit Latin-1 mail with no charset shows replacement characters | S3 | CONFIRMED S3 | merged into B54 |
| VWR-07 | An `.eml` with no header reads as empty | S3 | CONFIRMED S3 | merged into B54 |
| VWR-04 | An RTF named `.doc` or `.docx` opens as raw source | S3 | CONFIRMED S3 (browser build) | B55 |
| LOK-02 | A config.toml hand edit applies only while Settings is open | S3 | PLAUSIBLE | W11 |
| CMD-08 | Palette command and Line-row failures are silent | S3 | PLAUSIBLE | merged into W11 |
| CMD-05 | The `>` scope runs a different command than the best match | S3 | BY-DESIGN (`docs/using-marxy.md:113`) | dropped |

Placement: B43 to B48 are in Next. B49 and B50 are S2 but sit in Later, since Next already holds fifteen rows and neither touches a promised behaviour.

## Not reached

- The Rust paths of VWR (zip, tar, 7z, sheets, font and media facts), a zero-byte `.sqlite` that opens as text, `.docm`, `.xlsb`, `.mbox`, `.vcf`, 1900-serial dates before March, mail with a `message/rfc822` top level.
- The Studio's Compare, Fit and Galley, `[syntax]` colours, theme-folder live reload; a look name with U+007F or a lone surrogate makes its look file unparseable.
- Tab drag, place after an external change on disk, `search-model.ts` and `places-model.ts` of the left panels.
- The Line's `!`, `%`, `~`, `&` and `=` scopes, `palette/search.ts` ranking, `look/commands.ts`, `block-edit.ts` chords.
- The real WebView2 window, the Rust atomic write, the tab cap closing a tab with staged changes, `source/stray-bytes.ts`, Replace all in a mixed-ending file.
- The Line's first `d` after `j` removed a different paragraph than the held ones (verifier C); planted files did not show in the Line or palette rows (verifiers B and C, probably the memory shell's index).
