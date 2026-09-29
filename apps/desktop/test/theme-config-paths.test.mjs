// Theme directory paths in config.toml: `~` expansion per config location, and TOML escaping (MARXY-337).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseConfig } from '../../../packages/theme/src/index.ts';
import { writeThemeToConfig } from '../src/theme/theme-document.ts';
import { resolveThemeDir } from '../src/theme/user-theme.ts';

test('~ expands to the real home for every config location', () => {
  const themes = '~/themes/mine';
  const want = '/Users/ian/themes/mine';
  assert.equal(resolveThemeDir(themes, '/Users/ian/Library/Application Support/dev.marxy.app/config.toml'), want);
  assert.equal(resolveThemeDir(themes, '/Users/ian/.config/marxy/config.toml'), want);
  assert.equal(resolveThemeDir(themes, '/Users/ian/.config/config.toml'), want);
  assert.equal(resolveThemeDir('~', '/home/ian/.config/marxy/config.toml'), '/home/ian');
  assert.equal(resolveThemeDir('rel/dir', '/Users/ian/.config/marxy/config.toml'), '/Users/ian/.config/marxy/rel/dir');
});

function fakeShell() {
  const store = new Map([['/c/config.toml', new TextEncoder().encode('size = 18\ntheme = "/old"\n')]]);
  return {
    store,
    shell: {
      configPaths: async () => ({ config: '/c/config.toml', data: '/d' }),
      readFile: async (p) => store.get(p),
      writeFileAtomic: async (p, b) => { store.set(p, b); },
    },
  };
}

test('a theme path with a quote, backslash or newline round-trips through config.toml', async () => {
  for (const dir of ['/Users/a/my "themes"/q', '/Users/a/back\\slash/q', '/Users/a/new\nline/q', '/Users/a/ok/q', '/Users/a/tab\t/q']) {
    const { store, shell } = fakeShell();
    await writeThemeToConfig(shell, dir);
    const parsed = parseConfig(store.get('/c/config.toml'));
    assert.deepEqual(parsed.warnings, [], JSON.stringify(dir));
    assert.equal(parsed.config.size, 18, 'the rest of the file survives');
    assert.equal(parsed.config.theme, dir, JSON.stringify(dir));
  }
});
