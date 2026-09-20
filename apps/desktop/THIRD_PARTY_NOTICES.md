# Third-party notices — desktop bundle

marxy is MIT (`LICENSE` at the repository root). Components shipped inside the desktop app:

| Component | Version / source | Licence | Shipped as |
| --- | --- | --- | --- |
| Literata (roman and italic) | github.com/googlefonts/literata | SIL OFL 1.1 | `fonts/Literata*.ttf`, `fonts/Literata-OFL.txt` |
| JetBrains Mono | github.com/JetBrains/JetBrainsMono | SIL OFL 1.1 | `fonts/JetBrainsMono.ttf`, `fonts/JetBrainsMono-OFL.txt` |
| KaTeX math fonts | github.com/KaTeX/KaTeX (`katex` npm package) | SIL OFL 1.1 | Vite-emitted hashed assets from `katex/dist/fonts/` (loaded when a document contains math) |

KaTeX library code is MIT (`node_modules/katex/LICENSE`). Its fonts are OFL and are bundled unmodified from `katex/dist/fonts/` via the desktop Vite build.

Other npm dependencies are audited by `pnpm gate:licences`.
