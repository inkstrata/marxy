// layout.json persistence: debounce, quarantine, a newer version left byte for byte (D-12).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { LAYOUT_DEBOUNCE_MS, LayoutPersistence } from './persistence.ts';
import { emptyLayoutEnvelope } from './storage.ts';

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const enc = (s: string) => new TextEncoder().encode(s);

function memoryIo(initial: Record<string, Uint8Array> = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, v.slice()]));
  const writes: string[] = [];
  return {
    store,
    writes,
    io: {
      readFile: async (path: string) => {
        const bytes = store.get(path);
        if (!bytes) throw Object.assign(new Error('missing'), { code: 'not-found' });
        return bytes.slice();
      },
      writeFileAtomic: async (path: string, bytes: Uint8Array) => {
        writes.push(path);
        store.set(path, bytes.slice());
      },
      dataDirectory: async () => '/data',
    },
  };
}

const two = {
  version: 1,
  columns: [
    { path: '/a.md', mode: 'rendered' as const },
    { path: '/b.md', mode: 'source' as const },
  ],
  ratio: 0.4,
  focused: 1,
};

test('a burst of notes is one write after the debounce, of the last one', async () => {
  const { io, store, writes } = memoryIo();
  const layout = await LayoutPersistence.open(io);
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    timers.push({ fn, ms, live: true });
    return timers.length as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    if (typeof id === 'number' && timers[id - 1]) timers[id - 1]!.live = false;
  }) as unknown as typeof clearTimeout;
  let live: typeof timers;
  try {
    for (let i = 1; i <= 5; i++) layout.note({ ...two, ratio: 0.2 + i / 20 });
    assert.deepEqual(writes, [], 'nothing is written inside the debounce');
    live = timers.filter((t) => t.live);
    assert.equal(live.length, 1, 'one timer survives the burst');
    assert.equal(live[0]!.ms, LAYOUT_DEBOUNCE_MS);
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
  live[0]!.fn();
  await layout.flush();
  assert.deepEqual(writes, ['/data/layout.json']);
  assert.equal(JSON.parse(dec(store.get('/data/layout.json')!)).ratio, 0.45);
});

test('a flush with nothing noted writes nothing (the file the reader has stays as it is)', async () => {
  const { io, writes } = memoryIo({ '/data/layout.json': enc(JSON.stringify(two)) });
  const layout = await LayoutPersistence.open(io);
  await layout.flush();
  assert.deepEqual(writes, []);
  assert.equal(layout.saved().columns.length, 2);
  assert.equal(layout.saved().focused, 1);
});

test('a corrupt layout.json is quarantined, not deleted, and replaced by an empty layout', async () => {
  const bad = enc('{{ not json');
  const { io, store } = memoryIo({ '/data/layout.json': bad });
  const layout = await LayoutPersistence.open(io);
  assert.deepEqual(layout.saved(), emptyLayoutEnvelope());
  const kept = [...store.keys()].filter((k) => k !== '/data/layout.json');
  assert.equal(kept.length, 1);
  assert.match(kept[0]!, /^\/data\/layout\.json\.bad/);
  assert.equal(dec(store.get(kept[0]!)!), '{{ not json');
  assert.deepEqual(JSON.parse(dec(store.get('/data/layout.json')!)).columns, []);
});

test('a file with version 2 is left on disk byte for byte, and never written', async () => {
  const future = enc(JSON.stringify({ version: 2, columns: [{ path: '/a.md', mode: 'rendered' }], ratio: 0.5, focused: 0, extra: { x: 1 } }));
  const { io, store, writes } = memoryIo({ '/data/layout.json': future });
  const layout = await LayoutPersistence.open(io);
  assert.equal(layout.readOnly, true);
  assert.equal(layout.saved().columns.length, 1, 'it can still be read');
  layout.note(two);
  await layout.flush();
  await layout.close();
  assert.deepEqual(writes, []);
  assert.deepEqual(store.get('/data/layout.json'), future);
});

test('no file is an empty layout and nothing is written until something is noted', async () => {
  const { io, writes } = memoryIo();
  const layout = await LayoutPersistence.open(io);
  assert.deepEqual(layout.saved(), emptyLayoutEnvelope());
  await layout.flush();
  assert.deepEqual(writes, []);
  layout.note(two);
  await layout.flush();
  assert.deepEqual(writes, ['/data/layout.json']);
});
