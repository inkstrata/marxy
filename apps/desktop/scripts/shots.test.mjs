// The picture tool's command line. Taking pictures needs a browser; these need none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './shots.mjs';

test('a scenario alone takes the defaults: the source, Edge, 1440 by 900 at two device pixels', () => {
  const o = parseArgs(['scripts/shots/window.mjs']);
  assert.deepEqual([o.scenario, o.exe, o.browser, o.width, o.height, o.scale, o.only], ['scripts/shots/window.mjs', null, 'msedge', 1440, 900, 2, '']);
});

test('--exe takes a path when one follows, and the default binary otherwise', () => {
  assert.equal(parseArgs(['s.mjs', '--exe']).exe, '');
  assert.equal(parseArgs(['--exe', 's.mjs']).exe, '', 'a scenario after --exe is not taken as the binary');
  assert.equal(parseArgs(['--exe', 's.mjs']).scenario, 's.mjs');
  assert.equal(parseArgs(['s.mjs', '--exe', 'C:/build/marxy.exe']).exe, 'C:/build/marxy.exe');
  assert.equal(parseArgs(['s.mjs', '--exe=C:/build/marxy.exe', '--only', 'line']).only, 'line');
});

test('size, scale and browser are checked', () => {
  const o = parseArgs(['s.mjs', '--size', '900x700', '--scale=1', '--browser', 'chromium']);
  assert.deepEqual([o.width, o.height, o.scale, o.browser], [900, 700, 1, 'chromium']);
  assert.throws(() => parseArgs(['s.mjs', '--size', 'wide']), /WIDTHxHEIGHT/);
  assert.throws(() => parseArgs(['s.mjs', '--scale', '9']), /from 1 to 4/);
  assert.throws(() => parseArgs(['s.mjs', '--browser', 'webkit']), /msedge, chrome, chromium/);
  assert.throws(() => parseArgs([]), /name a scenario/);
  assert.throws(() => parseArgs(['a.mjs', 'b.mjs']), /one scenario at a time/);
});

test('the package runs it as shots, and the example scenario is there to copy', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  assert.equal(pkg.scripts.shots, 'node scripts/shots.mjs');
  assert.ok(existsSync(fileURLToPath(new URL('./shots/window.mjs', import.meta.url))));
});
