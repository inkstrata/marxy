// layout.json: round trip, truncation, quarantine, newer version kept (07 §4.6, §6.5).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_RATIO } from './geometry.ts';
import { LAYOUT_FILE_VERSION, emptyLayoutEnvelope, parseLayoutFile, quarantinePathFor, serializeLayoutFile } from './storage.ts';

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

test('round trip', () => {
  const env = {
    version: LAYOUT_FILE_VERSION,
    columns: [
      { path: '/a.md', mode: 'rendered' as const },
      { path: '/b.md', mode: 'source' as const },
    ],
    ratio: 0.4,
    focused: 1,
  };
  const loaded = parseLayoutFile(serializeLayoutFile(env));
  assert.equal(loaded.kind, 'ok');
  assert.deepEqual(loaded.envelope, env);
});

test('a three-column file parses to two columns', () => {
  const loaded = parseLayoutFile(
    enc({ version: 1, columns: [{ path: '/a' }, { path: '/b' }, { path: '/c' }], ratio: 0.5, focused: 2 }),
  );
  assert.equal(loaded.kind, 'ok');
  assert.equal(loaded.envelope.columns.length, 2);
  assert.equal(loaded.envelope.focused, 1);
});

test('columns of the wrong shape yield an empty layout without throwing', () => {
  const loaded = parseLayoutFile(enc({ version: 1, columns: 'x' }));
  assert.equal(loaded.kind, 'ok');
  assert.deepEqual(loaded.envelope, emptyLayoutEnvelope());
});

test('entries without a string path are dropped and a bad mode becomes rendered', () => {
  const loaded = parseLayoutFile(enc({ version: 1, columns: [{ path: 3 }, null, { path: '/a', mode: 'edit' }] }));
  assert.deepEqual(loaded.envelope.columns, [{ path: '/a', mode: 'rendered' }]);
});

test('ratio outside [0.2, 0.8] or non-numeric becomes the default', () => {
  for (const ratio of [0.1, 0.9, 'x', null]) {
    assert.equal(parseLayoutFile(enc({ version: 1, ratio })).envelope.ratio, DEFAULT_RATIO);
  }
  assert.equal(parseLayoutFile(enc({ version: 1, ratio: 0.2 })).envelope.ratio, 0.2);
  assert.equal(parseLayoutFile(enc({ version: 1, ratio: 0.8 })).envelope.ratio, 0.8);
});

test('focused clamps into the columns', () => {
  const cols = [{ path: '/a' }, { path: '/b' }];
  assert.equal(parseLayoutFile(enc({ version: 1, columns: cols, focused: -3 })).envelope.focused, 0);
  assert.equal(parseLayoutFile(enc({ version: 1, columns: cols, focused: 9 })).envelope.focused, 1);
  assert.equal(parseLayoutFile(enc({ version: 1, columns: [], focused: 4 })).envelope.focused, 0);
});

test('garbage quarantines and returns the original bytes', () => {
  const cases: Uint8Array[] = [
    new TextEncoder().encode('not json {'),
    new Uint8Array([0xff, 0xfe, 0x00]),
    enc([1, 2]),
    enc('str'),
    enc(null),
    enc({ columns: [] }),
    enc({ version: '1' }),
  ];
  for (const bytes of cases) {
    const loaded = parseLayoutFile(bytes);
    assert.equal(loaded.kind, 'quarantined');
    assert.deepEqual(loaded.quarantineBytes, bytes);
    assert.deepEqual(loaded.envelope, emptyLayoutEnvelope());
  }
});

test('a newer version is returned unchanged so the writer can refuse to overwrite it', () => {
  const loaded = parseLayoutFile(enc({ version: 7, columns: [{ path: '/a' }] }));
  assert.equal(loaded.kind, 'ok');
  assert.equal(loaded.envelope.version, 7);
});

test('the quarantine path is the positions one', () => {
  assert.equal(quarantinePathFor('/x/layout.json', 5), '/x/layout.json.bad-5');
});
