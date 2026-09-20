// positions.json persistence: reopen, debounce, corrupt quarantine (MARXY-38).

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scrollTopForPosition, sameFirstVisibleBlock, type LayoutBlock } from './blocks.ts';
import { PositionPersistence, POSITIONS_DEBOUNCE_MS } from './persistence.ts';
import { serializePositionsFile } from './storage.ts';

const desktopPositionDir = fileURLToPath(new URL('../../../../apps/desktop/src/position/', import.meta.url));

test('persisted JSON and ReadingPosition never store scrollTop (grep guard)', () => {
  for (const name of readdirSync(desktopPositionDir)) {
    if (!name.endsWith('.ts') || name === 'position.ts') continue;
    const source = readFileSync(`${desktopPositionDir}/${name}`, 'utf8');
    assert.doesNotMatch(source, /\bscrollTop\b/, `${name} must not mention scrollTop`);
  }
  for (const name of ['storage.ts', 'persistence.ts']) {
    const source = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bscrollTop\b/);
  }
});

function memoryIo(initial: Record<string, Uint8Array> = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, v.slice()]));
  return {
    store,
    io: {
      readFile: async (path: string) => {
        const bytes = store.get(path);
        if (!bytes) throw Object.assign(new Error('missing'), { code: 'not-found' });
        return bytes.slice();
      },
      writeFileAtomic: async (path: string, bytes: Uint8Array) => {
        store.set(path, bytes.slice());
      },
      dataDirectory: async () => '/data',
    },
  };
}

test('reopening a document restores the same first visible block within one line', async () => {
  const blocks: LayoutBlock[] = [
    { start: 0, top: 0, height: 100 },
    { start: 40, top: 100, height: 100 },
    { start: 90, top: 200, height: 100 },
  ];
  const viewport = 600;
  const path = '/docs/readme.md';
  const scrollBefore = scrollTopForPosition(blocks, 90, 0.4, viewport);

  const { io } = memoryIo();
  const persistence = await PositionPersistence.open(io);
  persistence.note(path, { path, byteOffset: 90, fraction: 0.4, mode: 'rendered' });
  await persistence.flush();

  const reopened = await PositionPersistence.open(io);
  const restored = reopened.positionForOpen(path, 500);
  assert.ok(restored);
  const scrollAfter = scrollTopForPosition(blocks, restored!.byteOffset, restored!.fraction, viewport);
  assert.ok(sameFirstVisibleBlock(blocks, scrollBefore, scrollAfter, viewport));
});

test('corrupt positions.json is renamed .bad-* and the app starts at the top', async () => {
  const path = '/data/positions.json';
  const corrupt = new TextEncoder().encode('{{');
  const { io, store } = memoryIo({ [path]: corrupt });
  const persistence = await PositionPersistence.open(io);
  assert.equal(persistence.positionForOpen('/any.md', 100), null);
  const names = [...store.keys()];
  assert.ok(names.some((n) => n.includes('.bad-')));
  const fresh = store.get(path);
  assert.ok(fresh);
  assert.doesNotMatch(new TextDecoder().decode(fresh!), /^\{\{/);
});

test('writes are debounced by 500 ms', async () => {
  const path = '/data/positions.json';
  const { io, store } = memoryIo();
  const persistence = await PositionPersistence.open(io);
  persistence.note('/a.md', { path: '/a.md', byteOffset: 1, fraction: 0, mode: 'rendered' });
  assert.equal(store.get(path), undefined);
  await new Promise((r) => setTimeout(r, POSITIONS_DEBOUNCE_MS - 50));
  assert.equal(store.get(path), undefined);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(store.get(path));
  await persistence.close();
});

test('a newer positions.json version is not overwritten on flush', async () => {
  const path = '/data/positions.json';
  const newer = serializePositionsFile({
    version: 99,
    positions: { '/keep.md': { byteOffset: 7, fraction: 0, mode: 'rendered', at: 1 } },
  });
  const { io, store } = memoryIo({ [path]: newer });
  const persistence = await PositionPersistence.open(io);
  persistence.note('/other.md', { path: '/other.md', byteOffset: 0, fraction: 0, mode: 'rendered' });
  await persistence.flush();
  assert.deepEqual(store.get(path), newer);
  assert.ok(persistence.positionForOpen('/keep.md', 100));
});
