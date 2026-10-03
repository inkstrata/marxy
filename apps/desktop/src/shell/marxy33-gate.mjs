// MARXY-33 build-time gates (Node only): loaded from the font manifest when Vite starts.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../../../../scripts/lib/repo.mjs';
import { forbiddenStaticImportsFromEntry } from '../startup/static-import-graph.test.mjs';

const desktopSrc = fileURLToPath(new URL('..', import.meta.url));

const hits = forbiddenStaticImportsFromEntry(desktopSrc);
if (hits.length) {
  throw new Error(`MARXY-33: forbidden static imports from main.ts: ${hits.map((h) => `${h.from} → ${h.spec}`).join('; ')}`);
}

// Marks are emitted from wherever the launch code lives: app.ts, the measurement in startup/, and
// the view/ and document/ directories as they grow. Each required mark must appear in one of them.
const launchFiles = ['app.ts', 'startup/measure.ts'];
for (const dir of ['view', 'document']) {
  if (!existsSync(join(desktopSrc, dir))) continue;
  for (const f of readdirSync(join(desktopSrc, dir), { recursive: true })) {
    if (/\.(ts|mjs)$/.test(String(f)) && !/\.test\./.test(String(f))) launchFiles.push(`${dir}/${f}`);
  }
}
// Marks with one known emitter are checked there only, so a dead helper elsewhere cannot satisfy them.
const emitters = {
  highlight_ms: ['startup/idle-work.ts'],
  index_loaded: ['index/service.ts'],
};
const emitsMark = (files, name) => files.some((f) =>
  existsSync(join(desktopSrc, f))
  && new RegExp(`mark\\('${name}'`).test(stripComments(readFileSync(join(desktopSrc, f), 'utf8'))));
for (const name of [
  'script_start', 'args', 'file_read', 'parsed', 'rendered', 'fonts_ready', 'first_text',
  'typeset_viewport', 'position_restored', ...Object.keys(emitters),
]) {
  const files = emitters[name] ?? launchFiles;
  if (!emitsMark(files, name)) {
    throw new Error(`MARXY-33: no mark('${name}') in ${files.map((f) => `apps/desktop/src/${f}`).join(', ')}`);
  }
}

const rust = readFileSync(join(desktopSrc, '../src-tauri/src/main.rs'), 'utf8');
if (!rust.includes('window_shown')) {
  throw new Error('MARXY-33: main.rs must emit window_shown');
}
