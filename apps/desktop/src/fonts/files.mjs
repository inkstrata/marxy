// Which vendored font file ships under which name, and the licence that travels with it. The files
// stay in `fonts/` untouched (the OFL's Reserved Font Name clause); the build copies them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../../../../scripts/lib/repo.mjs';
import { forbiddenStaticImportsFromEntry } from '../startup/static-import-graph.mjs';

const desktopSrc = fileURLToPath(new URL('..', import.meta.url));

/** MARXY-33 gates: runs when Vite loads this manifest (every desktop build and dev server). */
function assertMarxy33StartupGates() {
  const hits = forbiddenStaticImportsFromEntry(desktopSrc);
  if (hits.length) {
    throw new Error(`MARXY-33: forbidden static imports from main.ts: ${hits.map((h) => `${h.from} → ${h.spec}`).join('; ')}`);
  }
  const app = stripComments(readFileSync(join(desktopSrc, 'app.ts'), 'utf8'));
  for (const name of [
    'script_start', 'args', 'file_read', 'parsed', 'rendered', 'fonts_ready', 'first_text',
    'typeset_viewport', 'position_restored',
  ]) {
    if (!new RegExp(`mark\\('${name}'`).test(app)) {
      throw new Error(`MARXY-33: apps/desktop/src/app.ts is missing mark('${name}')`);
    }
  }
  if (!/runDeferredStartup|whenIdle/.test(app)) {
    throw new Error('MARXY-33: deferred startup work is not scheduled after position_restored');
  }
  const idle = stripComments(readFileSync(join(desktopSrc, 'startup', 'idle-work.ts'), 'utf8'));
  if (!/mark\('highlight_ms'/.test(idle) || !/mark\('index_loaded'/.test(idle)) {
    throw new Error('MARXY-33: idle-work.ts must emit highlight_ms and index_loaded');
  }
  const rust = readFileSync(join(desktopSrc, '../src-tauri/src/main.rs'), 'utf8');
  if (!rust.includes('window_shown')) {
    throw new Error('MARXY-33: main.rs must emit window_shown');
  }
}

assertMarxy33StartupGates();

export const FONT_FILES = [
  { from: 'fonts/literata/Literata[opsz,wght].ttf', to: 'fonts/Literata.ttf', preload: true },
  { from: 'fonts/literata/Literata-Italic[opsz,wght].ttf', to: 'fonts/Literata-Italic.ttf', preload: false },
  { from: 'fonts/jetbrains-mono/JetBrainsMono[wght].ttf', to: 'fonts/JetBrainsMono.ttf', preload: true },
  { from: 'fonts/literata/LICENSE', to: 'fonts/Literata-OFL.txt', preload: false },
  { from: 'fonts/jetbrains-mono/LICENSE', to: 'fonts/JetBrainsMono-OFL.txt', preload: false },
];
