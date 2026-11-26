// The stale-write guard must survive the app's own live-reload look at the disk.
import { strict as assert } from 'node:assert';
import { register } from 'node:module';
import { test } from 'node:test';

register('./support/tauri-stub-hooks.mjs', import.meta.url);
globalThis.navigator ??= { platform: 'MacIntel' };
const { fs } = await import('./support/tauri-core-stub.mjs');
const { shell } = await import('../src/shell/tauri.ts');
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

test('a watcher peek does not disarm the guard: the next write still refuses an external edit', async () => {
  const p = '/d/a.md';
  fs.set(p, enc('# A\n- [ ] one\n'));
  await shell.readFile(p); // the app opens the document
  fs.set(p, enc('# A\n- [ ] one\nEXTERNAL EDIT\n')); // another program edits it
  // handleDocumentWatch reads the file, finds local edits, and keeps them (no reload).
  await shell.peekFile(p);
  await assert.rejects(() => shell.writeFileAtomic(p, enc('# A\n- [x] one\n')), /changed|disk|stale|refus/i);
  assert.match(dec(fs.get(p)), /EXTERNAL EDIT/);
});

test('once the app adopts what it peeked (reload), writes are allowed against that state', async () => {
  const p = '/d/b.md';
  fs.set(p, enc('one\n'));
  await shell.readFile(p);
  fs.set(p, enc('two\n'));
  const seen = await shell.peekFile(p);
  shell.recordRead(p, seen);
  await shell.writeFileAtomic(p, enc('three\n'));
  assert.equal(dec(fs.get(p)), 'three\n');
});

test('two writes to one path at once (a state file on its timer and on an open) both land: the second never reads the first as another program', async () => {
  const { hooks } = await import('./support/tauri-core-stub.mjs');
  const p = '/data/positions.json';
  fs.set(p, enc('{"v":0}'));
  await shell.readFile(p);
  hooks.afterWrite = () => new Promise((r) => setTimeout(r, 20));
  try {
    const first = shell.writeFileAtomic(p, enc('{"v":1}'));
    // The second starts once the first is on disk and before its command has answered.
    await new Promise((r) => setTimeout(r, 5));
    await Promise.all([first, shell.writeFileAtomic(p, enc('{"v":2}'))]);
  } finally {
    hooks.afterWrite = null;
  }
  assert.equal(dec(fs.get(p)), '{"v":2}', 'the later write is the one kept');
  // An edit by another program is still refused after them.
  fs.set(p, enc('{"other":true}'));
  await assert.rejects(() => shell.writeFileAtomic(p, enc('{"v":3}')), /changed on disk/);
});

test('a Windows path from the launch is spelled with slashes, as the index and Search spell it: one file is one tab', async () => {
  const { hooks } = await import('./support/tauri-core-stub.mjs');
  hooks.args = ['C:\\Dev\\demo\\plans\\plan.md', '--quiet', '/Users/a/b.md'];
  try {
    assert.deepEqual(await shell.args(), ['C:/Dev/demo/plans/plan.md', '--quiet', '/Users/a/b.md']);
  } finally {
    hooks.args = [];
  }
});

test('the app watcher re-read goes through peekFile, and a reload goes through the store', async () => {
  const { readFileSync } = await import('node:fs');
  // Live reload is its own module.
  const watch = readFileSync(new URL('../src/document/live-reload.ts', import.meta.url), 'utf8');
  const retry = watch.slice(watch.indexOf('async function readOpenFileWithRetry'), watch.indexOf('async function reloadOpenFromDisk'));
  assert.match(retry, /peekFile/);
  const reload = watch.slice(watch.indexOf('async function reloadOpenFromDisk'), watch.indexOf('function refreshIndexForWatch'));
  assert.match(reload, /\.reload\(bytes[,)]/);
});

/** A document store on the Tauri shell, as app.ts opens one: the store records what it adopts. */
async function storeOn(path) {
  const { openDocumentStore } = await import('../src/document/store.ts');
  const bytes = await shell.readFile(path);
  return openDocumentStore(
    { writeFileAtomic: (p, b, expected) => shell.writeFileAtomic(p, b, expected), recordRead: (p, b) => shell.recordRead(p, b) },
    path,
    bytes,
  );
}

test('a reload the store adopts records the read: a save is then allowed against that state', async () => {
  const p = '/d/c.md';
  fs.set(p, enc('one\n'));
  const store = await storeOn(p);
  fs.set(p, enc('two\n'));
  assert.equal(await store.reload(await shell.peekFile(p)), 'reloaded');
  await store.apply({ range: { file: p, start: 0, end: 3 }, replacement: 'three', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  assert.equal(dec(fs.get(p)), 'three\n');
});

test('a reload the store keeps (unsaved edits) records nothing: the next save still refuses the external edit', async () => {
  const p = '/d/e.md';
  fs.set(p, enc('one\n'));
  const store = await storeOn(p);
  await store.apply({ range: { file: p, start: 0, end: 3 }, replacement: 'mine', label: 'edit' });
  fs.set(p, enc('EXTERNAL\n'));
  assert.equal(await store.reload(await shell.peekFile(p)), 'kept');
  assert.equal((await store.save()).result, 'failed');
  assert.equal(dec(fs.get(p)), 'EXTERNAL\n');
});

test('read_file rejecting with ShellError code not-found reads as not-found, and io as io', async () => {
  const { hooks } = await import('./support/tauri-core-stub.mjs');
  hooks.readError = { code: 'not-found', message: '/data/trust.json: No such file or directory (os error 2)' };
  try {
    await assert.rejects(() => shell.readFile('/data/trust.json'), (e) => e instanceof Error && e.code === 'not-found');
    await assert.rejects(() => shell.peekFile('/data/trust.json'), (e) => e.code === 'not-found');
    hooks.readError = { code: 'io', message: '/data/trust.json: Input/output error (os error 5)' };
    await assert.rejects(
      () => shell.readFile('/data/trust.json'),
      (e) => e.code === 'io' && /Input\/output error/.test(e.message),
    );
  } finally {
    hooks.readError = null;
  }
});

test('loadTrust on the real shell: a missing trust.json starts empty, an I/O error rejects', async () => {
  const { hooks } = await import('./support/tauri-core-stub.mjs');
  const { loadTrust } = await import('../src/trust/trust.ts');
  const writes = [];
  const io = {
    readFile: (p) => shell.readFile(p),
    writeFileAtomic: async (_p, b) => { writes.push(b); },
    dataDirectory: async () => '/data',
  };
  hooks.readError = { code: 'not-found', message: '/data/trust.json: No such file or directory (os error 2)' };
  try {
    const store = await loadTrust(io);
    assert.equal(await store.grant('/a.md', { html: true }), true);
    assert.equal(writes.length, 1);
    hooks.readError = { code: 'io', message: '/data/trust.json: Input/output error (os error 5)' };
    await assert.rejects(loadTrust(io), /Input\/output/);
    assert.equal(writes.length, 1);
  } finally {
    hooks.readError = null;
  }
});
