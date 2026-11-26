// The app has one scrollbar, drawn by frame.css. In Chromium (WebView2) a box that sets or inherits scrollbar-color,
// or a scrollbar-width other than none, loses ::-webkit-scrollbar and gets Windows' own bar back, arrows and all.

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'target', 'test', 'tests']);

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e)) && !/\.test\.[mc]?[jt]s$/.test(name)) out.push(p);
  }
  return out;
}

const roots = [join(repo, 'apps/desktop/src'), join(repo, 'packages')];
const css = roots.flatMap((r) => walk(r, ['.css']));
const ts = roots.flatMap((r) => walk(r, ['.ts', '.mjs', '.js']));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const rel = (p) => relative(repo, p).replaceAll('\\', '/');

test('the scan reaches the app and every package, theme sheets included', () => {
  const files = css.map(rel);
  for (const f of ['packages/theme/src/frame.css', 'packages/theme/src/left.css', 'packages/theme/ink/theme.css', 'apps/desktop/src/studio/studio.css', 'apps/desktop/src/viewers/tables.css']) {
    assert.ok(files.includes(f), `${f} is scanned`);
  }
});

test('no stylesheet sets scrollbar-color, or scrollbar-width other than none', () => {
  const bad = [];
  for (const f of css) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/scrollbar-(color|width)\s*:\s*([^;}]+)/g)) {
      if (m[1] === 'width' && m[2].trim() === 'none') continue;
      bad.push(`${rel(f)}: scrollbar-${m[1]}: ${m[2].trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no script sets a scrollbar style', () => {
  const bad = [];
  for (const f of ts) {
    const src = readFileSync(f, 'utf8');
    if (/scrollbar(Color|Width)\s*=|scrollbar-(color|width)\s*:/.test(src)) bad.push(rel(f));
  }
  assert.deepEqual(bad, []);
});

test('only frame.css draws the bar; elsewhere ::-webkit-scrollbar only hides one', () => {
  const bad = [];
  for (const f of css) {
    if (rel(f) === 'packages/theme/src/frame.css') continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/::-webkit-scrollbar[\w-]*[^{]*\{([^}]*)\}/g)) {
      if (!/^\s*display:\s*none;?\s*$/.test(m[1])) bad.push(`${rel(f)}: ${m[0].trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
  const frame = readFileSync(join(repo, 'packages/theme/src/frame.css'), 'utf8');
  assert.match(frame, /@media not \(forced-colors: active\) \{ @supports \(-webkit-app-region: drag\) \{\s*::-webkit-scrollbar \{/, 'the one bar, in Blink, outside forced colours');
  assert.match(frame, /::-webkit-scrollbar-button { display: none;/, 'no arrow buttons');
});
