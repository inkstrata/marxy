// What the Settings page stands on that needs no DOM (W-12, ADR-0075): the keys it may write, the themes it offers, and the writes
// themselves (one line, over the bytes the page showed, refused when the file is something else now).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SETTINGS, THEME_OPTIONS } from '@marxy/theme';
import { BUNDLED_THEME_NAMES } from '../theme/bundled-themes.ts';
import { ConfigChangedError, READER_KEYS, isReaderKey, resetReaderKey, restoreReaderConfig, writeReaderKey } from '../theme/reader-config.ts';

const enc = (t: string): Uint8Array => new TextEncoder().encode(t);
const dec = (b: Uint8Array | null): string => new TextDecoder().decode(b ?? new Uint8Array());

function fakeShell(initial: string | null) {
  let file: Uint8Array | null = initial === null ? null : enc(initial);
  const writes: string[] = [];
  return {
    shell: {
      configPaths: async () => ({ config: '/cfg/config.toml', data: '/data' }),
      readFile: async (): Promise<Uint8Array> => {
        if (file === null) throw Object.assign(new Error('no file'), { code: 'not-found' });
        return file.slice();
      },
      writeFileAtomic: async (_path: string, bytes: Uint8Array): Promise<void> => {
        file = bytes.slice();
        writes.push(dec(bytes));
      },
    },
    text: () => (file === null ? null : dec(file)),
    edit: (t: string) => {
      file = enc(t);
    },
    writes,
  };
}

test('every key the page writes is one writeReaderKey takes, and every table is left to the file', () => {
  for (const row of SETTINGS) {
    if (row.control.kind === 'table') assert.ok(!isReaderKey(row.key), `${row.key} is a table`);
    else assert.ok(isReaderKey(row.key), `${row.key} is a key the page writes, so writeReaderKey must take it`);
  }
  assert.equal(new Set(READER_KEYS).size, READER_KEYS.length);
});

test('the page offers the bundled themes the app has, and Night and Paper first', () => {
  assert.deepEqual(THEME_OPTIONS.map((o) => o.value), ['', ...BUNDLED_THEME_NAMES]);
});

test('a write over the bytes the page showed changes one line and leaves comments and order alone', async () => {
  const text = '# my config\nsize = 22 # bigger\n\ntheme = "ink"\n\n[linux]\nweight_offset = 75\n';
  const f = fakeShell(text);
  const next = await writeReaderKey(f.shell, 'show_whitespace', 'true', { expected: enc(text) });
  assert.equal(dec(next), '# my config\nsize = 22 # bigger\n\ntheme = "ink"\n\nshow_whitespace = true\n[linux]\nweight_offset = 75\n');
  assert.equal(f.writes.length, 1);
  // The reset takes its line out: the file is the one that was.
  const back = await resetReaderKey(f.shell, 'show_whitespace', { expected: next! });
  assert.equal(dec(back), text);
});

test('a config.toml that is not the bytes the page showed is never overwritten: the write is refused and says what is there', async () => {
  const shown = 'size = 22\n';
  const f = fakeShell('size = 22\n# added by hand\n');
  await assert.rejects(
    writeReaderKey(f.shell, 'show_whitespace', 'true', { expected: enc(shown) }),
    (e: unknown) => e instanceof ConfigChangedError && dec(e.current) === 'size = 22\n# added by hand\n',
  );
  await assert.rejects(resetReaderKey(f.shell, 'size', { expected: enc(shown) }), ConfigChangedError);
  await assert.rejects(restoreReaderConfig(f.shell, enc('x = 1\n'), { expected: enc(shown) }), ConfigChangedError);
  assert.deepEqual(f.writes, [], 'nothing was written');
  assert.equal(f.text(), 'size = 22\n# added by hand\n');
});

test('a missing config.toml is created by the first change, and resetting a key the file does not have writes nothing', async () => {
  const f = fakeShell(null);
  const made = await writeReaderKey(f.shell, 'size', '24', { expected: new Uint8Array() });
  assert.equal(dec(made), 'size = 24\n');
  assert.equal(f.text(), 'size = 24\n');
  const none = await resetReaderKey(f.shell, 'measure', { expected: enc('size = 24\n') });
  assert.equal(dec(none), 'size = 24\n');
  assert.equal(f.writes.length, 1, 'the reset of an absent key is no write');
});

test('Undo puts the file back to what the reset took the line from, over the bytes the reset left', async () => {
  const before = '# keep me\nsize = 22 # my size\n';
  const f = fakeShell(before);
  const after = await resetReaderKey(f.shell, 'size', { expected: enc(before) });
  assert.equal(dec(after), '# keep me\n');
  const restored = await restoreReaderConfig(f.shell, enc(before), { expected: after! });
  assert.equal(dec(restored), before);
  assert.equal(f.text(), before);
});

test('a change queued right behind another is over what the first left, not over what was shown before it', async () => {
  const f = fakeShell('size = 22\n');
  let shown: Uint8Array = enc('size = 22\n');
  const first = writeReaderKey(f.shell, 'show_whitespace', 'true', { expected: () => shown }).then((b) => (shown = b!));
  const second = writeReaderKey(f.shell, 'resident', 'true', { expected: () => shown });
  await Promise.all([first, second]);
  assert.equal(f.text(), 'size = 22\nshow_whitespace = true\nresident = true\n');
  assert.equal(f.writes.length, 2);
});
