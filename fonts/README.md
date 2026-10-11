# Bundled typefaces

All SIL Open Font License 1.1, each with its licence verbatim in its directory. Never modify
a font file (Reserved Font Name clause). These files are not covered by the repository's MIT
licence (ADR-0006). Only the font binaries are marked `binary` in `.gitattributes`; this README and
the licences diff as text, and nothing here is ever line-ending converted (`pnpm check`).

| Family | Use | Axes | Source |
| --- | --- | --- | --- |
| Literata | body and headings (default) | opsz 7–72, wght 200–900 | github.com/googlefonts/literata |
| JetBrains Mono | code (default) | wght 100–800 | github.com/JetBrains/JetBrainsMono |
| Source Serif 4 | the default theme's article face (`--marxy-face-article`, H-04); also the taste review #0 alternative | wght 200–900, opsz 8–60 | github.com/adobe-fonts/source-serif |
| IBM Plex Mono | taste review #0 alternative code face | none — static 400 only | github.com/google/fonts/tree/main/ofl/ibmplexmono |

IBM Plex Mono ships no variable font: only the regular is vendored, and only the weight the
specimen sets. If taste review #0 chooses it (`docs/taste-review/queue.md`), the weights the theme
needs have to be vendored as separate files, and there is no axis to tune per platform.

iA Writer Quattro/Mono were evaluated and not bundled: their variable axes are 400–700, which
cannot be tuned below regular weight (see `docs/spike/outcome.md`, ADR-0015).

## Licence audit (H-04)

Every bundled face is SIL OFL 1.1 with the upstream licence text verbatim beside it, and none is modified.
The app bundles Literata (roman and italic), Source Serif 4 (roman) and JetBrains Mono, each with its
`LICENSE` copied to `fonts/<Face>-OFL.txt` in the build (`apps/desktop/src/fonts/files.mjs`).
IBM Plex Mono is vendored here but not bundled.

| Face | Licence | Source | In the app |
| --- | --- | --- | --- |
| Literata | OFL 1.1 | github.com/googlefonts/literata | yes: `--marxy-face-book` |
| Source Serif 4 | OFL 1.1 | github.com/adobe-fonts/source-serif | yes: `--marxy-face-article` |
| JetBrains Mono | OFL 1.1 | github.com/JetBrains/JetBrainsMono | yes: `--marxy-face-mono` |
| IBM Plex Mono | OFL 1.1 | github.com/google/fonts/tree/main/ofl/ibmplexmono | no |

The Classic set's sans faces, Atkinson Hyperlegible Next and Inter, are not bundled yet (H-04.1: they
need the upstream releases and their `LICENSE` files, which an author approves downloading). Until then
`--marxy-face-sans` and `--marxy-face-readme` are the platform face.
