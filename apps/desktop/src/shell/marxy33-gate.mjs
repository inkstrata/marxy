// MARXY-33 build-time gates (Node only): loaded from the font manifest when Vite starts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../../../../scripts/lib/repo.mjs';
import { forbiddenStaticImportsFromEntry } from '../startup/static-import-graph.test.mjs';

const desktopSrc = fileURLToPath(new URL('..', import.meta.url));

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

const idle = stripComments(readFileSync(join(desktopSrc, 'startup', 'idle-work.ts'), 'utf8'));
if (!/mark\('highlight_ms'/.test(idle) || !/mark\('index_loaded'/.test(idle)) {
  throw new Error('MARXY-33: idle-work.ts must emit highlight_ms and index_loaded');
}

const rust = readFileSync(join(desktopSrc, '../src-tauri/src/main.rs'), 'utf8');
if (!rust.includes('window_shown')) {
  throw new Error('MARXY-33: main.rs must emit window_shown');
}
