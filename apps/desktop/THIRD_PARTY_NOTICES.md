# Third-party notices — desktop bundle

marxy is MIT (`LICENSE` at the repository root). Components shipped inside the desktop app:

| Component | Version / source | Licence | Shipped as |
| --- | --- | --- | --- |
| Literata (roman and italic) | github.com/googlefonts/literata | SIL OFL 1.1 | `fonts/Literata*.ttf`, `fonts/Literata-OFL.txt` |
| JetBrains Mono | github.com/JetBrains/JetBrainsMono | SIL OFL 1.1 | `fonts/JetBrainsMono.ttf`, `fonts/JetBrainsMono-OFL.txt` |
| KaTeX math fonts | github.com/KaTeX/KaTeX (`katex` npm package) | SIL OFL 1.1 | Vite-emitted hashed assets from `katex/dist/fonts/` (loaded when a document contains math) |
| pdf.js | github.com/mozilla/pdf.js (`pdfjs-dist` npm package, legacy build) | Apache 2.0 | Vite-emitted hashed assets (the library and its worker, loaded when a PDF opens) |
| pdf.js's JBIG2 and OpenJPEG decoders, as JavaScript | `pdfjs-dist/wasm/*_nowasm_fallback.js` (from PDFium and OpenJPEG) | BSD-3-Clause, BSD-2-Clause | `pdfjs/jbig2_nowasm_fallback.js`, `pdfjs/openjpeg_nowasm_fallback.js` (loaded when a page holds such an image) |
| Adobe CMaps | `pdfjs-dist/cmaps/` | BSD-3-Clause | Vite-emitted hashed chunks, one per CMap (loaded when a PDF names one) |

KaTeX library code is MIT (`node_modules/katex/LICENSE`). Its fonts are OFL and are bundled unmodified from `katex/dist/fonts/` via the desktop Vite build.

Other npm dependencies are audited by `pnpm gate:licences`.
