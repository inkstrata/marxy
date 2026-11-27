# Bundled typefaces

All SIL Open Font License 1.1, each with its licence verbatim in its directory. Never modify a font
file (Reserved Font Name clause). These files are not covered by the repository's MIT licence. Only
the font binaries are marked `binary` in `.gitattributes`; this README and the licences diff as text,
and nothing here is ever line-ending converted (`scripts/gate-font-attrs.mjs`, run by `pnpm check`).

| Family | Used as | Axes | Source | In the app |
| --- | --- | --- | --- | --- |
| Literata | body and headings (`--marxy-face-book`) | opsz 7–72, wght 200–900 | github.com/googlefonts/literata | yes, roman and italic |
| Source Serif 4 | article face (`--marxy-face-article`) | wght 200–900, opsz 8–60 | github.com/adobe-fonts/source-serif | yes, roman |
| Atkinson Hyperlegible Next | sans face (`--marxy-face-sans`) | wght 200–800 | github.com/googlefonts/atkinson-hyperlegible-next, `fonts/webfonts/*[wght].woff2` | yes, roman and italic |
| Inter | README face (`--marxy-face-readme`) | wght 100–900, opsz 14–32 | github.com/rsms/inter, release v4.1, `web/InterVariable.woff2` | yes, roman |
| JetBrains Mono | code (`--marxy-face-mono`) | wght 100–800 | github.com/JetBrains/JetBrainsMono | yes |
| IBM Plex Mono | not used | none, static 400 only | github.com/google/fonts/tree/main/ofl/ibmplexmono | no, kept here only |

The build copies each bundled face and its `LICENSE` (as `fonts/<Face>-OFL.txt`) into the app; the
list is `apps/desktop/src/fonts/files.mjs`. Inter's and Atkinson's licences are upstream's
`LICENSE.txt` and `OFL.txt`, stored here as `LICENSE`. Inter's italic is not bundled; the engine
slants the roman where a README sets emphasis.
