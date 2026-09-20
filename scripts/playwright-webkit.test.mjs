import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
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

// Only the files this story may edit. `apps/desktop/test/images.test.mjs` (MARXY-138)
// and `scripts/gate-no-network.mjs` still call webkit.launch() directly.
const LISTED_LAUNCH_PATHS = [
  'apps/desktop/test/typeset-defaults.test.mjs',
  'apps/desktop/test/layout-shift-window.test.mjs',
  'apps/desktop/test/app-harness.test.mjs',
  'apps/desktop/test/post-passes.test.mjs',
  'apps/desktop/test/fonts.test.mjs',
  'packages/typeset/test/harness.mjs',
  'packages/theme/test/grid.test.mjs',
  'packages/theme/test/taste.test.mjs',
  'packages/theme/test/pair-a-tune.test.mjs',
  'packages/theme/test/render-taste.mjs',
  'packages/theme/test/render-taste129.mjs',
  'scripts/gate-aesthetics.mjs',
];

test('browser tests and gates launch through the helper, not playwright directly', () => {
  const files = LISTED_LAUNCH_PATHS.map((rel) => join(root, rel));
  const direct = files.filter((f) => /\bwebkit\.launch\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(direct.map((f) => f.slice(root.length)), []);
  // The helper is where the one real launch lives, so the check above cannot pass by there being none.
  assert.match(readFileSync(join(root, 'scripts/playwright-webkit.mjs'), 'utf8'), /webkit\.launch\(/);
});
