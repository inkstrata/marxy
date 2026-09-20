import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { launchOptions } from './playwright-webkit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Runs `fn` with MARXY_BROWSER_HEADED set to `value` (undefined unsets it), then restores it. */
function withHeaded(value, fn) {
  const prev = process.env.MARXY_BROWSER_HEADED;
  if (value === undefined) delete process.env.MARXY_BROWSER_HEADED;
  else process.env.MARXY_BROWSER_HEADED = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.MARXY_BROWSER_HEADED;
    else process.env.MARXY_BROWSER_HEADED = prev;
  }
}

test('launchOptions is headless unless MARXY_BROWSER_HEADED=1', () => {
  withHeaded(undefined, () => assert.equal(launchOptions().headless, true));
  withHeaded('0', () => assert.equal(launchOptions().headless, true));
  withHeaded('1', () => assert.equal(launchOptions().headless, false));
});

test('launchOptions merges caller overrides after the headless default', () => {
  withHeaded(undefined, () => {
    assert.deepEqual(launchOptions({ slowMo: 50 }), { headless: true, slowMo: 50 });
    assert.equal(launchOptions({ headless: false }).headless, false);
  });
});

test('@marxy/desktop test script does not reference smoke-cli-open', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
  assert.doesNotMatch(pkg.scripts.test, /smoke-cli-open/);
  // verify:cli is the hand-reachable required smoke and must stay.
  assert.match(pkg.scripts['verify:cli'], /smoke-cli-open/);
});

/** Every .mjs/.ts file under `dir`, recursively. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(mjs|ts)$/.test(entry)) out.push(path);
  }
  return out;
}

test('browser tests and gates launch through the helper, not playwright directly', () => {
  const files = [
    ...sources(join(root, 'apps/desktop/test')),
    ...sources(join(root, 'packages/typeset/test')),
    ...sources(join(root, 'packages/theme/test')),
    join(root, 'scripts/gate-aesthetics.mjs'),
    join(root, 'scripts/gate-no-network.mjs'),
  ];
  const direct = files.filter((f) => /\b(webkit|chromium|engine)\.launch\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(direct.map((f) => f.slice(root.length)), []);
  // The helper is where the one real launch lives, so the check above cannot pass by there being none.
  assert.match(readFileSync(join(root, 'scripts/playwright-webkit.mjs'), 'utf8'), /engine\.launch\(/);
});
