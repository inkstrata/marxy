# Third-party notices

marxy is MIT (`LICENSE`). The fonts it ships are not: each is under the SIL Open Font License 1.1,
and its licence travels with it — in `fonts/<family>/LICENSE` in this repository and as
`fonts/<Family>-OFL.txt` beside the font in the built app (ADR-0006, ADR-0015). The font files are
shipped unmodified.

| Component | Version / source | Licence | Shipped as |
| --- | --- | --- | --- |
| Literata (roman and italic, variable `opsz`, `wght`) | github.com/googlefonts/literata | SIL OFL 1.1 | `fonts/Literata.ttf`, `fonts/Literata-Italic.ttf`, `fonts/Literata-OFL.txt` |
| JetBrains Mono (variable `wght`) | github.com/JetBrains/JetBrainsMono | SIL OFL 1.1 | `fonts/JetBrainsMono.ttf`, `fonts/JetBrainsMono-OFL.txt` |

npm and crate dependencies are checked by `pnpm gate:licences` against the allow-list in
`scripts/allowlists/`; their licences are all MIT, Apache-2.0, BSD, ISC, CC0 or MPL-2.0.
