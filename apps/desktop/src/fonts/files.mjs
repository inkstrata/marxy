// Which vendored font file ships under which name, and the licence that travels with it. The files
// stay in `fonts/` untouched (the OFL's Reserved Font Name clause); the build copies them.
import '../shell/marxy33-gate.mjs';

export const FONT_FILES = [
  { from: 'fonts/literata/Literata[opsz,wght].ttf', to: 'fonts/Literata.ttf', preload: true },
  { from: 'fonts/literata/Literata-Italic[opsz,wght].ttf', to: 'fonts/Literata-Italic.ttf', preload: false },
  { from: 'fonts/source-serif-4/SourceSerif4Variable-Roman.ttf', to: 'fonts/SourceSerif4.ttf', preload: false },
  { from: 'fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext[wght].woff2', to: 'fonts/AtkinsonHyperlegibleNext.woff2', preload: false },
  { from: 'fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext-Italic[wght].woff2', to: 'fonts/AtkinsonHyperlegibleNext-Italic.woff2', preload: false },
  { from: 'fonts/inter/InterVariable.woff2', to: 'fonts/InterVariable.woff2', preload: false },
  { from: 'fonts/jetbrains-mono/JetBrainsMono[wght].ttf', to: 'fonts/JetBrainsMono.ttf', preload: true },
  { from: 'fonts/literata/LICENSE', to: 'fonts/Literata-OFL.txt', preload: false },
  { from: 'fonts/source-serif-4/LICENSE', to: 'fonts/SourceSerif4-OFL.txt', preload: false },
  { from: 'fonts/atkinson-hyperlegible-next/LICENSE', to: 'fonts/AtkinsonHyperlegibleNext-OFL.txt', preload: false },
  { from: 'fonts/inter/LICENSE', to: 'fonts/Inter-OFL.txt', preload: false },
  { from: 'fonts/jetbrains-mono/LICENSE', to: 'fonts/JetBrainsMono-OFL.txt', preload: false },
];
