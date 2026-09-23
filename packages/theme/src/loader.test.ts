// loadTheme warnings and clamping (docs/design/05-theme.md §Tests). MARXY-47.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadTheme } from './loader.ts';

const dir = '/fixtures/quiet';

test('contract mismatch yields a warning and still loads css', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "c2"\ncontract = 2\nvariants = ["light"]\n')],
    ['theme.css', new TextEncoder().encode(':root { --marxy-measure: 68ch; }\n')],
  ]);
  const { manifest, css, warnings } = await loadTheme(
    dir,
    (rel) => {
      const b = files.get(rel);
      if (!b) throw new Error('missing');
      return Promise.resolve(b);
    },
    (p) => `asset://${p}`,
  );
  assert.equal(manifest.contract, 2);
  assert.match(css, /--marxy-measure/);
  assert.ok(warnings.some((w) => w.includes('contract 2')));
});

test('out-of-range measure is clamped with a warning', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "wide"\ncontract = 1\n')],
    ['theme.css', new TextEncoder().encode(':root { --marxy-measure: 120ch; }\n')],
  ]);
  const { css, warnings } = await loadTheme(
    dir,
    (rel) => Promise.resolve(files.get(rel)!),
    (p) => p,
  );
  assert.match(css, /--marxy-measure:\s*90ch/);
  assert.ok(warnings.some((w) => w.includes('clamped')));
});

test('remote url in theme css is stripped', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "net"\ncontract = 1\n')],
    ['theme.css', new TextEncoder().encode('x { background: url(https://evil.example/x); }\n')],
  ]);
  const { css, warnings } = await loadTheme(
    dir,
    (rel) => Promise.resolve(files.get(rel)!),
    (p) => p,
  );
  assert.doesNotMatch(css, /https:\/\/evil/);
  assert.ok(warnings.some((w) => w.includes('not loaded')));
});

test('an out-of-range measure in characters is clamped to 45–80 with a warning (ADR-0033)', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "wide"\ncontract = 1\n')],
    ['theme.css', new TextEncoder().encode(':root { --marxy-measure-chars: 120; }\n')],
  ]);
  const { css, warnings } = await loadTheme(
    dir,
    (rel) => Promise.resolve(files.get(rel)!),
    (p) => p,
  );
  assert.match(css, /--marxy-measure-chars:\s*80;/);
  assert.ok(warnings.some((w) => w.includes('--marxy-measure-chars')));
});
