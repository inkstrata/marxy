// The Tauri shell's content search (C-16): what crosses to Rust is narrowed by the index walk's own
// rules first, and an abort cancels the scan in Rust by its token.
import { strict as assert } from 'node:assert';
import { register } from 'node:module';
import { test } from 'node:test';

register('./support/tauri-stub-hooks.mjs', import.meta.url);
globalThis.navigator ??= { platform: 'MacIntel' };
const { hooks } = await import('./support/tauri-core-stub.mjs');
const { shell } = await import('../src/shell/tauri.ts');

test('only paths inside a root and outside the deny list and deny globs reach Rust, with the roots', async () => {
  hooks.invoked.length = 0;
  hooks.search = null;
  await shell.searchContent(
    ['/notes/a.md', '/notes/drafts/b.md', '/notes/node_modules/c.md', '/elsewhere/d.md', '/notes.d/e.md', '/notes/../x.md'],
    'needle',
    { roots: ['/notes'], denyGlobs: ['drafts/'], limit: 10 },
  );
  const [call] = hooks.invoked;
  assert.equal(call.cmd, 'search_content');
  assert.deepEqual(call.args.paths, ['/notes/a.md']);
  assert.deepEqual(call.args.roots, ['/notes']);
  assert.equal(call.args.query, 'needle');
  assert.equal(call.args.limit, 10);
  assert.equal(call.args.perFile, null);
  assert.equal(typeof call.args.token, 'number');
});

test('an abort cancels the running scan by its token and rejects with AbortError', async () => {
  hooks.invoked.length = 0;
  let finish;
  hooks.search = () => new Promise((resolve) => { finish = resolve; });
  const controller = new AbortController();
  const pending = shell.searchContent(['/r/a.md'], 'needle', { roots: ['/r'], signal: controller.signal });
  await new Promise((r) => setTimeout(r, 0));
  controller.abort();
  finish({ hits: [{ path: '/r/a.md' }], scannedFiles: 1, truncated: true });
  await assert.rejects(pending, (err) => err.name === 'AbortError');
  const search = hooks.invoked.find((c) => c.cmd === 'search_content');
  const cancel = hooks.invoked.find((c) => c.cmd === 'cancel_content_search');
  assert.ok(cancel, 'cancel_content_search was invoked');
  assert.equal(cancel.args.token, search.args.token);
});

test('each search has its own token', async () => {
  hooks.invoked.length = 0;
  hooks.search = null;
  await shell.searchContent(['/r/a.md'], 'a', { roots: ['/r'] });
  await shell.searchContent(['/r/a.md'], 'b', { roots: ['/r'] });
  const [first, second] = hooks.invoked;
  assert.notEqual(first.args.token, second.args.token);
});

test('a signal already aborted invokes nothing', async () => {
  hooks.invoked.length = 0;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(shell.searchContent(['/r/a.md'], 'a', { roots: ['/r'], signal: controller.signal }), (err) => err.name === 'AbortError');
  assert.equal(hooks.invoked.length, 0);
});
