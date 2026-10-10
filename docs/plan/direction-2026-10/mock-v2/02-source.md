# 02 Source

The Source view: a framed text editor around the raw bytes. Open [02-source.html](02-source.html); append `#doc=<id>` for another file (`odd-bytes` has invisible characters, mixed line endings, tabs and no final newline). The same frame is the source pane in [01-workspace.html](01-workspace.html) (Split and Source, folded or not); it is built once, in the shared engine (`G.Editor`).

## Principle

**Marxy never decorates the reader's text to correct or judge it.** No squiggles, no lint highlights, no coloured problem lines, no inline hints. Notes (a heading that jumps a level, an unclosed fence) appear only as a quiet mark on the right strip, with the detail in its tooltip, and as an optional "2 notes" count in the bottom bar that steps through them. Invisible and bidi characters are shown because they are bytes that are there, not a judgement; whitespace marks are opt-in.

Minimal information, layered in thin bars on the edges, centred on the bytes. Every piece of information shown is **derived from, and points at, exact bytes**: line numbers, columns, byte offsets, encoding, line endings, indentation, code points. Nothing is interpreted: no outline, no summary, no formatting toolbar. The editor still edits; formatting commands, line operations, inserts, transforms and find live in the palette and on keys.

## Anatomy

```
+----------------------------------------------------------------------------+
| ~ › Work › plans › handoffs › auth-refactor-handoff.md   UTF-8 · LF · 2 spaces · 1,021 bytes · 38 lines  [copy] |
|   ·····|····5····|···10···|···15···|··  column ruler (caret column, selection span)   |
| 12 |  ## State                                                              ▮ |  right strip: marks at exact bytes
| 13 |  The refactor is ...                                                   ▮ |
+----------------------------------------------------------------------------+
| Ln 13, Col 14 · byte 1,284 · 144 words · 1,021 chars · ≈269 tokens · U+0069 i          ● Markdown |
+----------------------------------------------------------------------------+
```

| Part | Contents |
|---|---|
| Frame | 1px `--line` border, `--r-lg`, text on `--doc`, bars on `--inset`. Inset 12 to 14px from the pane unfolded; centred (960px) when folded |
| Top bar (24px) | Path as quiet segments; encoding (UTF-8, or with BOM), line endings (LF, CRLF, CR, Mixed), indentation as detected (`2 spaces`, `tabs`, `mixed indentation`), size in bytes, line count; The line-ending and indentation items open a menu: Show whitespace (⌥⌘W), Column guide at 80, Soft wrap, Line numbers |
| Column ruler (16px) | Directly under the top bar, its left edge the text's first column (the gutter side blank, on the gutter's ground), scrolling exactly with the text: ticks only along the bottom edge (2px every 5 columns, 4px every 10, centred on the character), the numbers every 10 in the upper part set just right of their tick like a typographer's rule (9.5px tabular mono, 3px clear of the tallest tick; none before column 10 and none within 3ch of the frame edge); the caret's column as a small accent notch on the bottom edge; a selection as a 2px bar along it. Hidden when the frame is narrower than 520px, and with soft wrap on |
| Gutter | Line numbers in mono, never selectable; the current line in `--fg`, the rest `--fg-faint`; fold arrows only on hover; no icons. Right-click: Copy line, Copy lines with path:line, Copy path:line |
| Text | Exactly as in the file. Invisible and bidi characters as a boxed hex marker that takes no room (`200B`, `202E`); with Show whitespace on, tabs as faint arrows and trailing whitespace as faint dots; a faint ␍ at the end of the minority line ending (␊ when CRLF is the majority); a faint "no newline at end of file" after the last line; a 1px `--line` hairline guide at column 80 (code, logs and terminal captures; off for Markdown unless chosen) |
| Right strip (8px) | Marks at the vertical position of things at exact bytes: accent for invisible and bidi characters, the find colour for matches, green and red for lines changed since you read (against the earlier version), a faint amber 3px mark for notes. Hover names it ("U+200B ZERO WIDTH SPACE at 23:14"); click jumps and selects. There is no minimap |
| Bottom bar (24px) | `Ln 23, Col 14 · byte 1,284`; the document's measures (or the selection's, with bytes always shown); the character under the caret (`U+00E9 é`, or the name: `U+200B ZERO WIDTH SPACE`); the language on the right with its colour dot |

Measures follow Settings › Measures (see 01-workspace.md): contextual by kind, all, or a custom ordered list.

## What is not here

The formatting toolbar, the structure panel, the bottom panel tabs (problems, unsaved changes, edit history, selection) and the minimap are gone. Notes are never drawn on the text: strip marks with their text on hover, a count in the bottom bar, and the palette's "Go to next note". Unsaved changes show on the strip; the inspector's Versions tab (01) holds history.

## Window (02-source.html)

A toolbar with the title, the layout switch (Source, or Source beside the reading view), New and Fork (+), Find (⌘F or ⌥⌘F) and Save (⌘S); ⌘E toggles Source and Source beside the reading view; ⌘K or ⌘P opens the palette, ⌘/ its transforms. Find and replace is a small panel in the frame; matches paint under the text and on the strip. Everything else is the palette (⌘K, `>`, "Source"): Bold, Italic, Inline code, Link, Heading 1 to 4, Insert block (also `/` on an empty line), Move, Duplicate, Delete, Sort and Join lines, Toggle task, quote and comment, Select line, block and next occurrence. Keys: ⌘B, ⌘I, ⌃`, ⌥⌘L, ⌥⌘1–4, ⌥↑ ⌥↓, ⇧⌥↓, ⇧⌘K, ⌃J, ⌘↵, ⌘L, ⌘D, ⌘S. "Simulate an outside change" shows the changed-on-disk bar (keep mine as a copy, or take theirs).

## Copying

⌘C, ⇧⌘C (Copy as at the pointer, for the selection, else the file) and the gutter menu; there is no copy button in the frame. A quiet toast names the format and the measures.

## Settings this view reads

`edFontSize`, `edLineHeight`, `edWrap`, `edLineNumbers`, `edLint`, `edShowWs` (⌥⌘W), `edGuide` (`auto`, `on`, `off`), `measuresMode`, `measures`, `kindMeasures`, `tokenizer`, `showMetadata`.

## Alignment check

Opening a file from the sidebar, Recent, the palette or a link loads it into this editor in place (⌘[ and ⌘] step through the files opened). The ruler tick for column N is within 0.04px of character N's centre at 13px and 17px editor text (measured in the prototype with a Range over a 400-character line, columns 1 to 200).
