// positions.json: LRU cap, newer version is read-only, corrupt bytes are quarantined (design §11).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  POSITIONS_FILE_VERSION,
  POSITIONS_LRU_CAP,
  emptyPositionsEnvelope,
  parsePositionsFile,
  quarantinePathFor,
  serializePositionsFile,
  upsertStoredPosition,
} from './storage.ts';

test('defaults and clamps drop invalid entries', () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      positions: {
        '/a.md': { byteOffset: 12, fraction: 2, mode: 'rendered', at: 1 },
        '/bad.md': { byteOffset: 'nope' },
      },
    }),
  );
  const loaded = parsePositionsFile(bytes);
  assert.equal(loaded.kind, 'ok');
  if (loaded.kind !== 'ok') return;
  assert.equal(loaded.envelope.positions['/a.md'].fraction, 1);
  assert.equal(loaded.envelope.positions['/bad.md'], undefined);
});

test('a newer version is parsed but must not be overwritten by the app', () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: POSITIONS_FILE_VERSION + 1,
      positions: { '/x.md': { byteOffset: 0, fraction: 0, mode: 'rendered', at: 9 } },
    }),
  );
  const loaded = parsePositionsFile(bytes);
  assert.equal(loaded.kind, 'ok');
  if (loaded.kind !== 'ok') return;
  assert.ok(loaded.envelope.version > POSITIONS_FILE_VERSION);
  assert.equal(loaded.envelope.positions['/x.md'].byteOffset, 0);
});

test('corrupt JSON is quarantined and starts fresh', () => {
  const corrupt = new TextEncoder().encode('{not json');
  const loaded = parsePositionsFile(corrupt);
  assert.equal(loaded.kind, 'quarantined');
  if (loaded.kind !== 'quarantined') return;
  assert.deepEqual(loaded.envelope.positions, {});
  assert.ok(loaded.quarantineBytes.length > 0);
});

test('LRU cap evicts the oldest path', () => {
  let envelope = emptyPositionsEnvelope();
  for (let i = 0; i < POSITIONS_LRU_CAP + 3; i++) {
    envelope = upsertStoredPosition(envelope, `/f${i}.md`, {
      byteOffset: i,
      fraction: 0,
      mode: 'rendered',
      at: i,
    });
  }
  assert.equal(Object.keys(envelope.positions).length, POSITIONS_LRU_CAP);
  assert.equal(envelope.positions['/f0.md'], undefined);
  assert.equal(envelope.positions['/f1.md'], undefined);
  assert.equal(envelope.positions['/f2.md'], undefined);
  assert.ok(envelope.positions[`/f${POSITIONS_LRU_CAP + 2}.md`]);
});

test('serialize never mentions scrollTop', () => {
  const text = new TextDecoder().decode(
    serializePositionsFile({
      version: 1,
      positions: { '/doc.md': { byteOffset: 4, fraction: 0.5, mode: 'rendered', at: 1 } },
    }),
  );
  assert.doesNotMatch(text, /scrollTop/i);
});

test('quarantine path uses the .bad- prefix', () => {
  assert.match(quarantinePathFor('/data/positions.json', 123), /\.bad-123$/);
});
