# What the page does not show

The empty window shows a piece's text, and the colophon under it. Three things that live with
the piece are not part of that page.

## Front matter

Each file in `pieces/` opens with YAML front matter: title, author, dates, the edition followed,
where the words were checked, and the rights basis. `scripts/check-commonplace.mjs` reads it,
and the layout reads `form` and `languages` from it. It is a record, not the text, so the page
does not show it.

## Language headings

A piece in more than one language has one `## ` section per language, headed by that language's
own name, in the order `languages` lists them. The page does not print those headings. The texts
are set raw, apart from each other: side by side when the window holds both, one under the other
when it does not.

## Translations

Where the front matter says `translator: Marxy` and `rights: public-domain+marxy-translation`,
the English was made for this repository. Verse is translated line for line. The translation is
released with Marxy under the MIT licence. The original is public domain on the terms in
[README.md](README.md).
