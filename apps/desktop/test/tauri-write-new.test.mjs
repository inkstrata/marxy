// F-85 (ADR-0074): `writeFileNew` on the Tauri shell sends the bytes as a raw body and the path in `x-marxy-path`, through the one
// command `write_file_new`, and a name that is taken comes back as a `ShellError` with `code: 'exists'` and nothing written. It has no
// stale-write precondition (it never replaces), and it leaves the guard's picture of other files alone.
import { strict as assert } from 'node:assert';
import { register } from 'node:module';
import { test } from 'node:test';

register('./support/tauri-stub-hooks.mjs', import.meta.url);
globalThis.navigator ??= { platform: 'MacIntel' };
const { fs, hooks } = await import('./support/tauri-core-stub.mjs');
const { shell } = await import('../src/shell/tauri.ts');
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

test('a free name is written with exactly the bytes, through write_file_new', async () => {
  const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x23, 0x0d, 0x0a, 0x00, 0xff);
  await shell.writeFileNew('/d/a (fork).md', bytes);
  assert.deepEqual([...fs.get('/d/a (fork).md')], [...bytes]);
  assert.ok(hooks.invoked.some((c) => c.cmd === 'write_file_new' && c.args.path === '/d/a (fork).md'));
});

test('a name with unusual characters survives the header', async () => {
  const path = '/d/ünï cödé & 日本語 (fork).md';
  await shell.writeFileNew(path, enc('x'));
  assert.equal(dec(fs.get(path)), 'x');
});

test('a taken name rejects with code "exists", carries the path, and the file keeps its bytes', async () => {
  fs.set('/d/b (fork).md', enc('mine'));
  await assert.rejects(
    () => shell.writeFileNew('/d/b (fork).md', enc('theirs')),
    (err) => err instanceof Error && err.code === 'exists' && /will not replace/.test(err.message),
  );
  assert.equal(dec(fs.get('/d/b (fork).md')), 'mine');
});

test('it ignores the stale-write guard in both directions: a file the guard has seen is never replaced by it, and it arms nothing', async () => {
  fs.set('/d/c.md', enc('one'));
  await shell.readFile('/d/c.md');
  await assert.rejects(() => shell.writeFileNew('/d/c.md', enc('two')), (err) => err.code === 'exists');
  assert.equal(dec(fs.get('/d/c.md')), 'one');
  await shell.writeFileNew('/d/c (mine).md', enc('copy'));
  // A write to the new file is not refused by a baseline it never had: the guard has no entry for it.
  await shell.writeFileAtomic('/d/c (mine).md', enc('copy edited'));
  assert.equal(dec(fs.get('/d/c (mine).md')), 'copy edited');
});
