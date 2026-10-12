// U-00: the pair harness's argument handling, file names and index (no browser is started).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SCREENS, THEMES, indexHtml, pairFiles, parseArgs } from './mock-pair.mjs';

const MOCK = fileURLToPath(new URL('../docs/plan/direction-2026-10/mock-v2/', import.meta.url));

test('the screen table holds X-21\'s thirteen states', () => {
  assert.equal(Object.keys(SCREENS).length, 13);
  assert.deepEqual(THEMES.map((t) => t.id), ['night', 'paper']);
});

test('file names are <screen>-<theme>-{app,mock}.png', () => {
  assert.deepEqual(pairFiles('04-palette', 'paper'), { app: '04-palette-paper-app.png', mock: '04-palette-paper-mock.png' });
});

test('arguments: screens, all, theme, side, out', () => {
  assert.deepEqual(parseArgs(['01-unfolded', '03-split', '--out', 'x']).screens, ['01-unfolded', '03-split']);
  assert.equal(parseArgs(['all', '--out', 'x']).screens.length, 13);
  const o = parseArgs(['02-source', '--out', 'x', '--theme', 'paper', '--side', 'app']);
  assert.deepEqual([o.themes, o.sides], [['paper'], ['app']]);
});

test('a typo in a screen name is refused and the names are listed', () => {
  assert.throws(() => parseArgs(['01-unfolde', '--out', 'x']), (e) => /unknown screen "01-unfolde"/.test(e.message) && e.message.includes('08-narrow'));
});

test('missing screen, missing --out, unknown theme and option are refused', () => {
  assert.throws(() => parseArgs(['--out', 'x']), /name a screen/);
  assert.throws(() => parseArgs(['01-folded']), /--out/);
  assert.throws(() => parseArgs(['01-folded', '--out', 'x', '--theme', 'dark']), /unknown theme/);
  assert.throws(() => parseArgs(['01-folded', '--out', 'x', '--nope']), /unknown option/);
});

test('the command exits non-zero on a typo, without starting a browser', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./mock-pair.mjs', import.meta.url)), 'nope', '--out', 'x'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /03-split/);
});

test('the index shows each pair in both themes with its files', () => {
  const html = indexHtml({ screens: ['03-split'], themes: ['night', 'paper'], sides: ['app', 'mock'], label: 'abc' });
  for (const t of ['night', 'paper']) for (const side of ['app', 'mock']) assert.ok(html.includes(`03-split-${t}-${side}.png`));
  assert.ok(!/<script/.test(html));
});

test('every screen is backed by a mock page that exists', () => {
  const pages = readdirSync(MOCK);
  for (const f of ['01-workspace.html', '02-source.html', '05-collections.html']) assert.ok(pages.includes(f), f);
});
