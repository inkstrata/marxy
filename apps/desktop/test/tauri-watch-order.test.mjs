// The Tauri shell's watch (C-11.1): the `fs-watch` listener is registered before `watch_root` is
// asked for, so a tree watch that refuses (or reports a change) the moment it is up is not lost.
import { strict as assert } from 'node:assert';
import { register } from 'node:module';
import { test } from 'node:test';

register('./support/tauri-stub-hooks.mjs', import.meta.url);
globalThis.navigator ??= { platform: 'MacIntel' };
const { hooks } = await import('./support/tauri-core-stub.mjs');
const { emit } = await import('./support/tauri-event-stub.mjs');
const { shell } = await import('../src/shell/tauri.ts');

const KEY = '/tree\u0000tree';

test('a refusal emitted before watch_root returns still reaches onRefused', async () => {
  hooks.invoked.length = 0;
  hooks.watchRoot = async () => {
    // The shell's thread refuses right after the scan, before the caller has its key.
    emit('fs-watch', { key: KEY, events: [], refused: 'too many files' });
    return KEY;
  };
  const refusals = [];
  const handle = await shell.watch('/tree', () => {}, { recursive: true, onRefused: (reason) => refusals.push(reason) });
  assert.deepEqual(refusals, ['too many files']);
  handle.close();
});

test('events emitted before watch_root returns are delivered, and another watch\'s are not', async () => {
  hooks.watchRoot = async () => {
    emit('fs-watch', { key: '/other', events: [{ kind: 'created', path: '/other/x.md' }] });
    emit('fs-watch', { key: KEY, events: [{ kind: 'created', path: '/tree/a.md' }] });
    return KEY;
  };
  const batches = [];
  const handle = await shell.watch('/tree', (events) => batches.push(events), { recursive: true });
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(batches, [[{ kind: 'created', path: '/tree/a.md' }]]);
  handle.close();
});

test('a watch_root that fails leaves no listener behind', async () => {
  hooks.watchRoot = async () => {
    throw 'too many files';
  };
  await assert.rejects(shell.watch('/tree', () => assert.fail('no events'), { recursive: true }));
  emit('fs-watch', { key: KEY, events: [{ kind: 'created', path: '/tree/a.md' }] });
  await new Promise((r) => setTimeout(r, 40));
});
