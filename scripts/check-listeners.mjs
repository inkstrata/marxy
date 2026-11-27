// Listeners on the window and the document that nothing takes away, counted per folder of apps/desktop/src, may not
// grow. Such a listener, added with no `signal` and no matching `removeEventListener`, outlives whatever added it: a
// view, a pane or a viewer gone from the page stays reachable from the window through it, with its document. One on an
// element goes with the element, so only targets that live as long as the page are counted (an element that outlives
// its owner, a pane's host, is for the browser test `lifetimes.test.mjs` to find). The count is a ratchet: it fails
// when a folder has more than `scripts/allowlists/listeners.json` records, and `--write` records it as it is.
// usage: node scripts/check-listeners.mjs [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, fix, rel, stripComments, walk } from './lib/repo.mjs';

const SRC = 'apps/desktop/src';
const BASELINE = join(ROOT, 'scripts/allowlists/listeners.json');

/** What lives as long as the page: the window, the document, their faces, root, body and viewport, a media query. */
const LONG_LIVED = /(?:\b(?:window|document|globalThis|self)(?:\.(?:fonts|body|documentElement|visualViewport))?|matchMedia\([^;]*?\))\s*\??\.\s*$/;

/** The text of each `name(` call's arguments in `text`, to its balanced close, for calls on a long-lived target. */
function callArgs(text, name) {
  const out = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!LONG_LIVED.test(text.slice(Math.max(0, m.index - 120), m.index))) continue;
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    out.push(text.slice(start, i - 1));
  }
  return out;
}

/** Listeners on long-lived targets in one file's source that neither a signal nor a remove accounts for. */
export function unowned(text) {
  const source = stripComments(text);
  const adds = callArgs(source, 'addEventListener');
  const signalled = adds.filter((args) => /\bsignal\b/.test(args)).length;
  const removes = callArgs(source, 'removeEventListener').length;
  return Math.max(0, adds.length - signalled - removes);
}

/** The folder a source path counts under: its first folder below `src`, or `.` for files directly in it. */
export function folderOf(path) {
  const below = path.slice(SRC.length + 1).split('/');
  return below.length > 1 ? below[0] : '.';
}

export function countByFolder(files) {
  const counts = {};
  for (const { path, text } of files) {
    const n = unowned(text);
    if (n > 0) counts[folderOf(path)] = (counts[folderOf(path)] ?? 0) + n;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/** Folders over their recorded count, as lines; a folder with no record has a count of 0. */
export function grown(counts, baseline) {
  return Object.entries(counts)
    .filter(([folder, n]) => n > (baseline[folder] ?? 0))
    .map(([folder, n]) => `${folder}: ${n} (recorded ${baseline[folder] ?? 0})`);
}

if (import.meta.main) {
  const files = walk(join(ROOT, SRC), (p) => /\.tsx?$/.test(p) && !/\.test\.|\.d\.ts$/.test(p)).map((p) => ({
    path: rel(p),
    text: readFileSync(p, 'utf8'),
  }));
  const counts = countByFolder(files);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE, `${JSON.stringify({ about: 'Listeners on the window or the document added with no signal and no remove, per folder of apps/desktop/src: may shrink, never grow (scripts/check-listeners.mjs).', folders: counts }, null, 2)}\n`);
    console.log(`check-listeners: recorded ${total} in ${Object.keys(counts).length} folders`);
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).folders;
  const over = grown(counts, baseline);
  if (over.length) {
    fail([
      `check-listeners: window and document listeners with no signal and no remove grew in ${over.join(', ')}${fix('give each the signal of whatever owns it (an AbortController aborted where it ends), or remove it there')}`,
    ]);
    process.exit(1);
  }
  const recorded = Object.values(baseline).reduce((a, b) => a + b, 0);
  console.log(`check-listeners: ${total} window and document listeners with no signal and no remove${total < recorded ? ` (recorded ${recorded}: node scripts/check-listeners.mjs --write lowers it)` : ''}`);
}
