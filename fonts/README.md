# Bundled typefaces

All SIL Open Font License 1.1, each with its licence verbatim in its directory. Never modify
a font file (Reserved Font Name clause). These files are not covered by the repository's MIT
licence (ADR-0006).

| Family | Use | Axes | Source |
| --- | --- | --- | --- |
| Literata | body and headings (default) | opsz 7–72, wght 200–900 | github.com/googlefonts/literata |
| JetBrains Mono | code (default) | wght 100–800 | github.com/JetBrains/JetBrainsMono |
| Source Serif 4 | taste review #0 alternative body face | wght 200–900 | github.com/adobe-fonts/source-serif |

iA Writer Quattro/Mono were evaluated and not bundled: their variable axes are 400–700, which
cannot be tuned below regular weight (see `docs/spike/outcome.md`, ADR-0015).
