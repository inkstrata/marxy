// layout.json: round trip, truncation, quarantine, newer version kept.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_RATIO } from './geometry.ts';
import { LAYOUT_FILE_VERSION, LAYOUT_TABS_MAX, emptyLayoutEnvelope, layoutTabs, parseLayoutFile, quarantinePathFor, serializeLayoutFile } from './storage.ts';

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
    tabs: ['/c.md', '/a.md', '/d.md', '/b.md'],
  };
  const loaded = parseLayoutFile(serializeLayoutFile(env));
  assert.equal(loaded.kind, 'ok');
  assert.deepEqual(loaded.envelope, env);
});

test('a layout written before the row was kept reads its columns as the row, in column order', () => {
  const old = parseLayoutFile(enc({ version: 1, columns: [{ path: '/a.md' }, { path: '/b.md', mode: 'source' }], ratio: 0.5, focused: 0 }));
  assert.equal(old.kind, 'ok');
  assert.deepEqual(old.envelope.tabs, ['/a.md', '/b.md']);
  const same = parseLayoutFile(enc({ version: 1, columns: [{ path: '/a.md' }, { path: '/a.md' }] }));
  assert.deepEqual(same.envelope.tabs, ['/a.md'], 'one file in both panes is one tab');
});

test('the row keeps each path once, drops what is not a path, and always holds what the panes show', () => {
  const loaded = parseLayoutFile(enc({ version: 1, columns: [{ path: '/b.md' }], tabs: ['/a.md', 3, '', null, '/a.md', '/c.md'] }));
  assert.deepEqual(loaded.envelope.tabs, ['/a.md', '/c.md', '/b.md']);
  assert.deepEqual(parseLayoutFile(enc({ version: 1, columns: [], tabs: 'x' })).envelope.tabs, []);
});

test('a row over the cap loses its earliest tabs no pane shows', () => {
  const many = Array.from({ length: LAYOUT_TABS_MAX + 3 }, (_, i) => `/f${i}.md`);
  const tabs = layoutTabs(many, [{ path: '/f0.md', mode: 'rendered' }]);
  assert.equal(tabs.length, LAYOUT_TABS_MAX);
  assert.equal(tabs[0], '/f0.md', 'a shown tab is kept');
  assert.equal(tabs[1], '/f4.md');
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
  assert.equal(parseLayoutFile(enc({ version: 1, columns: cols, focused: 0.9 })).envelope.focused, 0);
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

test('paths kept with backslashes by an earlier build read as slashed paths, each once', () => {
  const loaded = parseLayoutFile(
    enc({ version: 1, columns: [{ path: 'C:\\n\\a.md' }, { path: 'C:\\n\\b.md' }], focused: 1, tabs: ['C:\\n\\c.md', 'C:/n/a.md', 'C:\\n\\a.md', 'C:\\n\\b.md'] }),
  );
  assert.equal(loaded.kind, 'ok');
  assert.deepEqual(loaded.envelope.columns.map((c) => c.path), ['C:/n/a.md', 'C:/n/b.md']);
  assert.deepEqual(loaded.envelope.tabs, ['C:/n/c.md', 'C:/n/a.md', 'C:/n/b.md']);
});
