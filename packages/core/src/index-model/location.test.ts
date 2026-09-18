// The model lives at index-model, never src/index, so a path-boundary check cannot confuse it
// with the package entry point packages/core/src/index.ts.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

test('the index model is imported from packages/core/src/index-model', () => {
  assert.ok(
    import.meta.url.includes('/index-model/'),
    `expected this file to live under index-model, got ${import.meta.url}`,
  );
});

test('packages/core/src/index/ does not exist, so it cannot collide with src/index.ts', () => {
  const asDirectory = fileURLToPath(new URL('../index/', import.meta.url));
  assert.equal(existsSync(asDirectory), false, `found a directory at ${asDirectory}`);
});

test('production modules stay browser-safe: no node: imports', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const offenders: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const text = readFileSync(new URL(name, import.meta.url), 'utf8');
    if (/(?:^|\n)\s*(?:import|export)(?!\s+type\b)[^'"\n]*from\s*['"]node:/.test(text)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, []);
});
