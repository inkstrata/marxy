// The stale-write guard must survive the app's own live-reload look at the disk (MARXY-337).
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

test('the app watcher re-read goes through peekFile, and a reload records what it adopted', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const retry = app.slice(app.indexOf('async function readOpenFileWithRetry'), app.indexOf('async function reloadOpenFromDisk'));
  assert.match(retry, /peekFile/);
  const reload = app.slice(app.indexOf('async function reloadOpenFromDisk'), app.indexOf('async function handleDocumentWatch'));
  assert.match(reload, /recordRead\?\.\(openPath, bytes\)/);
});
