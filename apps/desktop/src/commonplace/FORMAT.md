# The Commonplace piece format

Every piece is one markdown file in `pieces/`, named `<slug>.md`: UTF-8, LF line endings, one
trailing newline. It must read well opened on its own in Marxy, on GitHub, or in any CommonMark
viewer, so everything below is plain CommonMark plus YAML front matter.

## Front matter

```yaml
---
title: I died for Beauty            # as the piece is known; for an untitled poem, its first line
author: Emily Dickinson
date: "c. 1862; printed 1890"      # a string: composition and first publication where they differ
form: verse                         # verse | prose | code
languages: [en]                     # BCP 47, in the order the body's sections appear
translator: Marxy                   # optional: "Marxy" for a translation made for this repository
source: "Poems by Emily Dickinson, ed. M. L. Todd and T. W. Higginson (Boston: Roberts Brothers, 1890)"
transcription: https://www.gutenberg.org/ebooks/12242   # the digital text this file was checked against
rights: public-domain               # public-domain | public-domain-original+marxy-translation
---
```

## Body

1. `# Title`, the one h1.
2. The text. A bilingual piece has one `## ` section per entry in `languages`, in that order,
   headed by the language's own name (`## Deutsch`, `## English`, `## 中文`, `## فارسی`).
   A single-language piece has no h2. Those headings are how the file is split. The page does
   not print them: the texts are set raw, with a gap between them ([`INFO.md`](INFO.md)).
3. A thematic break `---` on its own line. **Everything after the last thematic break is the
   colophon**: one or more paragraphs naming the author, work, date and the edition followed,
   and anything the reader should know about the text (what was omitted, what was normalised).
   The translation licence is not written here; it is in [`INFO.md`](INFO.md). No piece uses
   `---` anywhere else.

## Verse

- One source line per verse line. Every line but a stanza's last ends in a backslash hard break
  (`\`); a blank line separates stanzas, so each stanza is one paragraph.
- Indentation is part of the poem (reader-typography chapter 7). A verse line's indent is written as
  leading U+2003 EM SPACE characters, one per level. CommonMark keeps them (it strips only spaces and
  tabs), so other viewers show an indent; a Marxy renderer should turn the run into an indent level
  and never render the characters themselves.
- Omitted lines are a paragraph holding only `⋮`.

## Prose and code

- Prose is ordinary paragraphs, not hard-wrapped (one paragraph, one line). An omission inside a
  paragraph is `…`; an omitted paragraph is a paragraph holding only `⋮`.
- Code is a fenced block with the language in the info string, tabs and spacing exactly as in the
  source.
