// The theme adoption writes config.toml through editConfig's queue: beside a Settings change started with
// it, both survive, and a file that cannot be read is not taken for an empty one. test/config-writers.test.mjs does the
// same for "Always open this folder as".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '@marxy/theme';
import { writeReaderKey } from './reader-config.ts';
import { writeThemeToConfig } from './theme-document.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A config.toml whose reads and writes each take a moment, so two uninterleaved read-modify-writes overlap. */
function slowShell(initial: string, opts: { failRead?: boolean } = {}) {
  let bytes = enc.encode(initial);
  const writes: string[] = [];
  const shell = {
    configPaths: async () => ({ config: '/c/config.toml', data: '/d' }),
    readFile: async (path: string) => {
      await later(15);
      if (opts.failRead) throw Object.assign(new Error('Access is denied'), { code: 'permission' });
      assert.equal(path, '/c/config.toml');
      return bytes.slice();
    },
    writeFileAtomic: async (path: string, next: Uint8Array) => {
      await later(15);
      assert.equal(path, '/c/config.toml');
      bytes = next.slice();
      writes.push(dec.decode(next));
    },
  };
  return { shell, text: () => dec.decode(bytes), writes };
}

test('adopting a theme folder and a Settings key, started together, both land in config.toml', async () => {
  const { shell, text } = slowShell('size = 18\n');
  await Promise.all([writeThemeToConfig(shell as never, '/Users/a/themes/mine'), writeReaderKey(shell as never, 'variant', '"light"')]);
  const parsed = parseConfig(enc.encode(text()));
  assert.equal(parsed.config.theme, '/Users/a/themes/mine', text());
  assert.equal(parsed.config.variant, 'light', text());
  assert.equal(parsed.config.size, 18);
});

test('a config.toml that cannot be read is not taken for an empty one by the theme adoption', async () => {
  const { shell, writes } = slowShell('size = 18\ntheme = "/old"\n', { failRead: true });
  await assert.rejects(writeThemeToConfig(shell as never, '/new'), /Access is denied/);
  assert.deepEqual(writes, [], 'nothing was written over the unreadable file');
});
