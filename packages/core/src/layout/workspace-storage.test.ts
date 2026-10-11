// workspace.json: round trip, unknown names dropped, quarantine, newer version kept (W-02; 07 §4.6, §6.5).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  WORKSPACE_FILE_VERSION,
  WORKSPACE_REGIONS,
  WorkspacePersistence,
  emptyWorkspaceEnvelope,
  parseWorkspaceFile,
  quarantinePathFor,
  serializeWorkspaceFile,
} from './workspace-storage.ts';

const enc = (v: unknown) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** An in-memory io: a map of path to bytes; reads of a missing path throw as the shell does. */
function memoryIo(files: Record<string, Uint8Array> = {}) {
  const store = new Map(Object.entries(files));
  const writes: string[] = [];
  return {
    store,
    writes,
    io: {
      async readFile(path: string) {
        const bytes = store.get(path);
        if (!bytes) throw Object.assign(new Error(`not found: ${path}`), { code: 'not-found' });
        return bytes.slice();
      },
      async readHead(path: string, max: number) {
        const bytes = store.get(path);
        if (!bytes) throw Object.assign(new Error(`not found: ${path}`), { code: 'not-found' });
        return bytes.slice(0, max);
      },
      async writeFileAtomic(path: string, bytes: Uint8Array) {
        writes.push(path);
        store.set(path, bytes.slice());
      },
      async dataDirectory() {
        return '/data';
      },
    },
  };
}

test('the six regions are the ones ADR-0058 names, in drawing order', () => {
  assert.deepEqual([...WORKSPACE_REGIONS], ['sidebar', 'toolbar', 'tabs', 'strip', 'inspector', 'status-bar']);
});

test('round trip', () => {
  const env = {
    version: WORKSPACE_FILE_VERSION,
    panels: { sidebar: true, toolbar: true, tabs: false, strip: true, inspector: false, 'status-bar': true },
  };
  const loaded = parseWorkspaceFile(serializeWorkspaceFile(env));
  assert.equal(loaded.kind, 'ok');
  assert.deepEqual(loaded.envelope, env);
});

test('serialising writes the regions in drawing order, whatever order they were set in', () => {
  const text = dec(serializeWorkspaceFile({ version: 1, panels: { 'status-bar': true, sidebar: false } }));
  assert.ok(text.indexOf('"sidebar"') < text.indexOf('"status-bar"'));
});

test('unknown names and non-boolean values are dropped without an error', () => {
  const loaded = parseWorkspaceFile(enc({ version: 1, panels: { sidebar: true, banner: true, tabs: 'yes', inspector: 1, strip: false } }));
  assert.equal(loaded.kind, 'ok');
  assert.deepEqual(loaded.envelope.panels, { sidebar: true, strip: false });
});

test('panels of the wrong shape yield an empty arrangement without throwing', () => {
  for (const panels of ['x', 3, null, [true, false]]) {
    const loaded = parseWorkspaceFile(enc({ version: 1, panels }));
    assert.equal(loaded.kind, 'ok');
    assert.deepEqual(loaded.envelope, emptyWorkspaceEnvelope());
  }
});

test('corrupt bytes are quarantined and the envelope starts empty', () => {
  for (const bytes of [enc('{not json'), enc('[]'), enc('null'), enc({ panels: {} }), enc({ version: 'one' }), Uint8Array.of(0xff, 0xfe, 0x00)]) {
    const loaded = parseWorkspaceFile(bytes);
    assert.equal(loaded.kind, 'quarantined');
    assert.deepEqual(loaded.envelope, emptyWorkspaceEnvelope());
    assert.deepEqual([...(loaded as { quarantineBytes: Uint8Array }).quarantineBytes], [...bytes]);
  }
});

test('a newer version parses, keeps its version, and is never written over', async () => {
  const loaded = parseWorkspaceFile(enc({ version: 7, panels: { sidebar: false }, future: 1 }));
  assert.equal(loaded.kind, 'ok');
  assert.equal(loaded.envelope.version, 7);
  const bytes = enc({ version: 7, panels: { sidebar: false } });
  const { io, writes } = memoryIo({ '/data/workspace.json': bytes });
  const file = await WorkspacePersistence.open(io);
  assert.equal(file.readOnly, true);
  assert.deepEqual(file.saved(), { sidebar: false });
  await file.write({ sidebar: true });
  assert.deepEqual(writes, []);
});

test('a missing file is nothing remembered, and opening it writes nothing', async () => {
  const { io, writes } = memoryIo();
  const file = await WorkspacePersistence.open(io);
  assert.deepEqual(file.saved(), {});
  assert.equal(file.quarantined, false);
  assert.deepEqual(writes, []);
});

test('open, write, open again: the panels come back', async () => {
  const mem = memoryIo();
  const first = await WorkspacePersistence.open(mem.io);
  await first.write({ sidebar: true, inspector: false });
  assert.deepEqual(mem.writes, ['/data/workspace.json']);
  const second = await WorkspacePersistence.open(mem.io);
  assert.deepEqual(second.saved(), { sidebar: true, inspector: false });
});

test('a corrupt file is kept beside itself, the file starts empty, and the reader can be told', async () => {
  const bad = enc('{"version": 1, "panels": ');
  const mem = memoryIo({ '/data/workspace.json': bad });
  const file = await WorkspacePersistence.open(mem.io);
  assert.equal(file.quarantined, true);
  assert.deepEqual(file.saved(), {});
  const kept = [...mem.store.keys()].filter((p) => p.startsWith(quarantinePathFor('/data/workspace.json', 0).replace(/0$/, '')));
  assert.equal(kept.length, 1);
  assert.deepEqual([...mem.store.get(kept[0]!)!], [...bad]);
  assert.equal(dec(mem.store.get('/data/workspace.json')!).includes('"version": 1'), true);
});

test('a file far larger than a workspace is quarantined (bounded) and never read whole', async () => {
  const big = new Uint8Array(200 * 1024).fill(0x20);
  const mem = memoryIo({ '/data/workspace.json': big });
  const file = await WorkspacePersistence.open(mem.io);
  assert.equal(file.quarantined, true);
  assert.deepEqual(file.saved(), {});
});
