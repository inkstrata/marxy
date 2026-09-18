# Bundled typefaces

All SIL Open Font License 1.1, each with its licence verbatim in its directory. Never modify
a font file (Reserved Font Name clause). These files are not covered by the repository's MIT
licence (ADR-0006). Only the font binaries are marked `binary` in `.gitattributes`; this README and
the licences diff as text, and nothing here is ever line-ending converted (`pnpm gate:font-attrs`).

| Family | Use | Axes | Source |
| --- | --- | --- | --- |
| Literata | body and headings (default) | opsz 7–72, wght 200–900 | github.com/googlefonts/literata |
| JetBrains Mono | code (default) | wght 100–800 | github.com/JetBrains/JetBrainsMono |
| Source Serif 4 | taste review #0 alternative body face | wght 200–900, opsz 8–60 | github.com/adobe-fonts/source-serif |
| IBM Plex Mono | taste review #0 alternative code face | none — static 400 only | github.com/google/fonts/tree/main/ofl/ibmplexmono |

IBM Plex Mono ships no variable font: only the regular is vendored, and only the weight the
specimen sets. If taste review #0 chooses it (`docs/taste-review/queue.md`), the weights the theme
needs have to be vendored as separate files, and there is no axis to tune per platform.

iA Writer Quattro/Mono were evaluated and not bundled: their variable axes are 400–700, which
cannot be tuned below regular weight (see `docs/spike/outcome.md`, ADR-0015).
