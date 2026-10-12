// H-05: the bundled themes are named in config.toml by a bare name, the palette's theme command writes only the
// `theme` line, and a folder of the same name beside config.toml still wins.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BUNDLED_THEME_NAMES, bundledThemeName } from '../src/theme/bundled-themes.ts';
import { writeReaderKey } from '../src/theme/reader-config.ts';
import { resolveThemeChoice } from '../src/theme/user-theme.ts';
import { isLightVariant } from '../src/source/page-scheme.ts';
import { appearanceCommands } from '../src/commands/appearance.ts';

const CONFIG = '/Users/ian/.config/marxy/config.toml';
const themesDir = fileURLToPath(new URL('../../../packages/theme/', import.meta.url));

test('a bare name that matches a bundled directory is the bundled theme; anything with a slash is not', () => {
  assert.deepEqual([...BUNDLED_THEME_NAMES], ['ink', 'warm', 'fjord', 'high-contrast']);
  for (const name of BUNDLED_THEME_NAMES) {
    assert.equal(bundledThemeName(name), name);
    assert.ok(existsSync(`${themesDir}${name}/theme.css`), name);
  }
  for (const raw of ['./warm', 'warm/', '~/warm', '/themes/warm', 'Warm', 'default', 'dusk', '', '  ', null, undefined]) {
    assert.equal(bundledThemeName(raw), null, String(raw));
  }
});

test('resolveThemeChoice: bundled, shadowed by a folder beside config.toml, a user folder, none', async () => {
  const folder = (present) => ({ readFile: async (p) => { if (!present.includes(p)) throw Object.assign(new Error('no'), { code: 'not-found' }); return new Uint8Array(); } });
  assert.deepEqual(await resolveThemeChoice(folder([]), 'warm', CONFIG), { kind: 'bundled', name: 'warm' });
  assert.deepEqual(await resolveThemeChoice(folder(['/Users/ian/.config/marxy/warm/theme.css']), 'warm', CONFIG), {
    kind: 'dir', dir: '/Users/ian/.config/marxy/warm', shadows: 'warm',
  });
  assert.deepEqual(await resolveThemeChoice(folder([]), './warm', CONFIG), { kind: 'dir', dir: '/Users/ian/.config/marxy/./warm', shadows: null });
  assert.deepEqual(await resolveThemeChoice(folder([]), '~/themes/mine', CONFIG), { kind: 'dir', dir: '/Users/ian/themes/mine', shadows: null });
  assert.equal(await resolveThemeChoice(folder([]), '', CONFIG), null);
  assert.equal(await resolveThemeChoice(folder([]), null, CONFIG), null);
});

test('writeReaderKey("theme") changes only the theme line of a commented config', async () => {
  const before = '# my marxy config\r\nvariant = "light" # easy\r\ntheme = "/old/dir" # was mine\r\nsize = 24\r\nunknown_thing = [1, 2]\r\n\r\n[linux]\r\nweight_offset = 75\r\n';
  const store = new Map([[CONFIG, new TextEncoder().encode(before)]]);
  const shell = {
    configPaths: async () => ({ config: CONFIG, data: '/d' }),
    readFile: async (p) => store.get(p),
    writeFileAtomic: async (p, b) => { store.set(p, b); },
  };
  await writeReaderKey(shell, 'theme', '"warm"');
  const after = new TextDecoder().decode(store.get(CONFIG));
  const lines = (t) => t.split('\r\n');
  const [b, a] = [lines(before), lines(after)];
  assert.equal(a.length, b.length);
  const changed = b.map((line, i) => [line, a[i]]).filter(([x, y]) => x !== y);
  assert.equal(changed.length, 1, JSON.stringify(changed));
  assert.match(changed[0][1], /^theme = "warm"/);
  // Night and Paper: the line is emptied, not removed.
  await writeReaderKey(shell, 'theme', '""');
  assert.match(new TextDecoder().decode(store.get(CONFIG)), /^theme = ""/m);
});

test('the palette offers a theme command for every bundled theme and Night and Paper; the one in force is not offered', () => {
  const themes = appearanceCommands().filter((c) => c.id.startsWith('view.theme-'));
  assert.deepEqual(themes.map((c) => c.title), [
    'Theme: Night and Paper', 'Theme: Ink', 'Theme: Dusk and Sepia', 'Theme: Fjord (dark only)', 'Theme: High contrast',
  ]);
  // Night and Paper is in force in a fresh page, so only it is hidden.
  assert.deepEqual(themes.filter((c) => c.when?.() === false).map((c) => c.id), ['view.theme-default']);
  assert.match(readFileSync(new URL('../src/commands/appearance.ts', import.meta.url), 'utf8'), /writeReaderKey/);
});

test('H-05: Source builds its dark base theme from the page color-scheme, so Fjord under the light variant is dark', () => {
  const saved = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  try {
    const root = { getAttribute: () => 'light' };
    globalThis.document = { documentElement: root };
    globalThis.getComputedStyle = () => ({ colorScheme: 'dark' });
    assert.equal(isLightVariant(), false, 'light variant, dark color-scheme (Fjord)');
    globalThis.getComputedStyle = () => ({ colorScheme: 'light' });
    assert.equal(isLightVariant(), true);
    globalThis.getComputedStyle = () => ({ colorScheme: '' });
    assert.equal(isLightVariant(), true, 'no color-scheme: the variant decides');
    root.getAttribute = () => null;
    assert.equal(isLightVariant(), false);
  } finally {
    globalThis.document = saved.document;
    globalThis.getComputedStyle = saved.getComputedStyle;
  }
});

test('H-05: fjord sets color-scheme: dark in the block that also answers the light variant', () => {
  const css = readFileSync(new URL('../../../packages/theme/fjord/theme.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /:root,\s*:root\[data-marxy-variant="light"\]\s*\{\s*color-scheme:\s*dark;/);
});
