// The gate against module-level document state (ADR-0037, Consequences; B-15). The store owns the
// bytes and the history, the view owns the page, and `app.ts` only builds and connects them: none of
// these modules may keep a `let` at module scope, nothing but the store may make a History, and the
// composition root stays small enough to read.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const read = (rel) => readFileSync(join(src, rel), 'utf8');
const why = 'ADR-0037: the document store owns the document, the view owns the page, and app.ts holds no state of its own';

/** Every `.ts` file under `dir`, test files left out. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(join(src, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(rel));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(rel);
  }
  return out;
}

const listed = [
  'app.ts',
  ...sources('document'),
  ...sources('view'),
  'selection/view.ts',
  'commands/edits.ts',
  'save.ts',
];

test('the modules that hold the document keep no module-level let', () => {
  assert.ok(listed.includes('document/open.ts') && listed.includes('view/rendered-view.ts'), listed.join(', '));
  for (const rel of listed) {
    const lets = [...read(rel).matchAll(/^(?:export\s+)?let\s+(\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(lets, [], `${rel} keeps module state (${lets.join(', ')}); ${why}`);
  }
});

test('nothing but document/store.ts makes a History', () => {
  const makers = sources('.')
    .map((rel) => relative('.', rel))
    .filter((rel) => rel !== 'document/store.ts' && /\bnew History\(/.test(read(rel)));
  assert.deepEqual(makers, [], `a History outside the store; ${why}`);
});

test('app.ts is the composition root: under 300 lines', () => {
  const lines = read('app.ts').split('\n').length;
  assert.ok(lines < 300, `app.ts has ${lines} lines; ${why}`);
});

/** Product sources: every `.ts` under src outside tests and the harness entries (src/harness, source/harness-entry.ts). */
const product = () => sources('.').filter((rel) => !rel.startsWith('harness/') && rel !== 'source/harness-entry.ts');

test('no product module reads process.env: switches for tests live in the tests (B-16)', () => {
  const readers = product().filter((rel) => /\bprocess\.env\b/.test(read(rel)));
  assert.deepEqual(readers, [], `process.env read in product code: ${readers.join(', ')}`);
});

test('no product module installs a test hook on window or defines a MARXY_*_MUTATION switch (B-16)', () => {
  // main.ts's __marxyPalette is the built-app smoke test's (scripts/smoke-built-app.mjs), not a harness hook.
  const hook = /\b(?:window|w)\.(?:marxy[A-Z]\w*|__marxy\w+)|__marxy(?!Palette\b)\w+|MARXY_\d+_MUTATION/;
  const hits = product().filter((rel) => hook.test(read(rel)));
  assert.deepEqual(hits, [], `test plumbing in product code: ${hits.join(', ')}; move it to src/harness/test-hooks.ts`);
});
