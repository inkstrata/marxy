// A data tree too big to draw whole: the first TREE_MAX_VALUES values, stopping between entries with how
// many more there are and the line where Source has them; Draw from here at any path; the keys not reached; and a JSON
// file past what is parsed whole, read by a streaming parse with the count from a fast scan.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readingOf, TREE_MAX_VALUES, treeTierList } from './index.ts';
import { parseJson, treeFromCode, treeFromOf, type TreeNode } from './tree.ts';
import { lineOfByte, parseJsonFrom, scanJson } from './tree-stream.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const SOUNDINGS = new Uint8Array(readFileSync(new URL('../../../../fixtures/demo/data/soundings.json', import.meta.url)));
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const headOf = (html: string): string => text(/<span class="marxy-reading-head">(.*?)<\/span>/.exec(html)![1]!);
const stops = (html: string): { words: string; source: number; from: string }[] =>
  [...html.matchAll(/<div class="marxy-tree-stop"[^>]*>(.*?)<\/div><\/div>/g)].map((m) => ({
    words: text(m[1]!),
    source: Number(/data-marxy-tree-source="(\d+)"/.exec(m[1]!)![1]),
    from: /data-marxy-tree-from="([^"]+)"/.exec(m[1]!)![1]!,
  }));
const undrawn = (html: string): string[] => [...html.matchAll(/marxy-tree-undrawn"[^>]*><span class="marxy-tree-key">([^<]*)<\/span>.*?data-marxy-tree-from="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
/** What a parse built, without where it came from. */
const shape = (n: TreeNode): unknown => ({ kind: n.kind, key: n.key, type: n.type, value: n.value, children: n.children?.map(shape) });
const values = (n: TreeNode): number => 1 + (n.children ?? []).reduce((s, c) => s + values(c), 0);

/** soundings.json past 1.5 MB, so it is streamed: a long note before `notes`, the rest as it was. */
const PADDED = enc(new TextDecoder().decode(SOUNDINGS).replace('"notes"', `"pad": "${'x'.repeat(200_000)}",\n  "notes"`));

test('soundings.json draws its first 5,000 values and stops between items', () => {
  const read = readingOf('/d/soundings.json', SOUNDINGS)!;
  assert.equal(read.id, 'tree');
  assert.deepEqual(read.tree, { total: 73_519, capped: true, top: true });
  assert.equal(headOf(read.html), 'JSON · 4 keys at the top · the first 5,000 of 73,519 values drawn; Source has the rest');
  const [inner, list] = stops(read.html);
  assert.equal(inner!.words, '1 more key here, not drawn. The tree draws the first 5,000 values; Source has the rest, from line 5,692. Go on in Source, at line 5,692 Draw from here');
  assert.equal(list!.words, '8,415 more items here, not drawn. The tree draws the first 5,000 values; Source has the rest, from line 5,694. Go on in Source, at line 5,694 Draw from here');
  assert.equal(lineOfByte(SOUNDINGS, list!.source), 5694, 'Go on in Source names the byte on the line it says');
  assert.equal(new TextDecoder().decode(SOUNDINGS.subarray(list!.source, list!.source + 9)), '{\n      "', 'the byte is the next item’s first');
  assert.deepEqual([inner!.from, list!.from], ['2/584@6', '2@585']);
  assert.deepEqual(undrawn(read.html), ['notes 3@0'], 'the keys not reached are named, each with draw from here');
  assert.match(read.html, /<span class="marxy-tree-index">584<\/span>/);
  assert.doesNotMatch(read.html, /<span class="marxy-tree-index">585<\/span>/, 'the list stops before an item, never inside one');
  assert.match(read.html, /Find in the page searches what is drawn; find in Source searches everything\./);
});

test('the Keys card lists each top-level key with its size and line, each a way to draw from there', () => {
  const read = readingOf('/d/soundings.json', SOUNDINGS)!;
  assert.equal(read.contents!.detail, 'draw from any');
  assert.deepEqual(
    read.contents!.items.map((i) => [i.text, i.sub, i.from]),
    [
      ['survey', '6 keys · line 2', '0@0'],
      ['stations', '40 items · line 14', '1@0'],
      ['soundings', '9,000 items · line 296', '2@0'],
      ['notes', 'line 83,646', '3@0'],
    ],
  );
});

test('Draw from here draws the tree from an item on, again 5,000 values at most, with the crumb back to the top', () => {
  const read = readingOf('/d/soundings.json', SOUNDINGS, null, treeFromOf('2@4000'))!;
  assert.deepEqual(read.tree, { total: 73_519, capped: true, top: false });
  assert.equal(text(/<div class="marxy-tree-crumb">(.*?)<\/div>/.exec(read.html)![1]!), 'soundings.json › soundings › from item 4,000');
  assert.match(read.html, /<div class="marxy-tree-crumb"><button type="button" class="marxy-linkish" data-marxy-tree-from="@0">soundings\.json<\/button>/);
  assert.equal(headOf(read.html), 'JSON · 4 keys at the top · 5,000 of 73,519 values drawn from here; Source has the rest');
  assert.match(read.html, /<summary><span class="marxy-tree-key">soundings<\/span> <span class="marxy-tree-meta">\[ \] 9,000 items<\/span><\/summary>/);
  assert.match(read.html, /<span class="marxy-tree-index">4000<\/span>/);
  assert.doesNotMatch(read.html, /<span class="marxy-tree-index">3999<\/span>/);
  const last = stops(read.html).at(-1)!;
  assert.match(last.words, /^4,385 more items here, not drawn\./);
  assert.equal(last.from, '2@4615');
  assert.deepEqual(undrawn(read.html), [], 'a tree drawn from inside names no top-level keys');
  // From inside a record: the map from its key `flags` on.
  const inner = readingOf('/d/soundings.json', SOUNDINGS, null, treeFromOf('2/584@6'))!;
  assert.equal(text(/<div class="marxy-tree-crumb">(.*?)<\/div>/.exec(inner.html)![1]!), 'soundings.json › soundings › 584 › from flags');
  assert.match(inner.html, /<span class="marxy-tree-index">584<\/span> <span class="marxy-tree-meta">\{ \} 7 keys<\/span>/);
  assert.deepEqual(stops(inner.html), []);
  // A path that leads nowhere in this file draws from the top.
  assert.equal(readingOf('/d/soundings.json', SOUNDINGS, null, treeFromOf('9/1@0'))!.tree!.top, true);
});

test('a starting point is a code the page carries, and back', () => {
  for (const f of [{ path: [], from: 0 }, { path: [2], from: 4000 }, { path: [2, 584], from: 6 }]) assert.deepEqual(treeFromOf(treeFromCode(f)), f);
  assert.equal(treeFromOf('2/x@1'), null);
  assert.equal(treeFromOf('2'), null);
});

test('the streaming parse builds what parseJson builds, at the same bytes', () => {
  const samples = [
    new TextDecoder().decode(SOUNDINGS),
    '{"a\\n\\u00e9\\"": ["x\\\\", -1.5e10, true, false, null, {}, [], [[{}]]], "é": "naïve ☃ 𝄞"}',
    `[${'1'.repeat(80)}, -${'2'.repeat(40)}.5E-3, "tab\there"]`,
    '  "a string at the root"  ',
    '﻿{"bom": 1}',
  ];
  for (const s of samples) {
    const bytes = enc(s);
    const whole = parseJsonFrom(bytes, Number.POSITIVE_INFINITY)!;
    const reference = parseJson(s.replace(/^﻿/, ''));
    assert.deepEqual(shape(whole.base), shape(reference), s.slice(0, 40));
    assert.equal(whole.cut.size, 0);
    const scan = scanJson(bytes);
    assert.equal(scan.values, values(reference), `the fast count: ${s.slice(0, 40)}`);
    assert.equal(scan.broken, null);
  }
  // Byte offsets: the value `naïve ☃ 𝄞` starts where its bytes do.
  const s = '{"é": "naïve ☃ 𝄞", "n": [1]}';
  const node = parseJsonFrom(enc(s), Number.POSITIVE_INFINITY)!.base.children![1]!;
  assert.equal(node.start, enc(s.slice(0, s.indexOf('['))).length);
});

test('the streaming parse stops after its limit between entries, and counts what is left with or without the scan', () => {
  const scan = scanJson(SOUNDINGS);
  for (const withScan of [true, false]) {
    const stream = parseJsonFrom(SOUNDINGS, 600, undefined, withScan ? scan : undefined)!;
    const cuts = [...stream.cut].map(([n, c]) => [n.key, n.children!.length, c.more, lineOfByte(SOUNDINGS, c.at)]);
    assert.deepEqual(cuts, [
      [null, 6, 1, 690],
      ['soundings', 43, 8957, 692],
      [null, 3, 1, 83_646],
    ]);
  }
  const from = parseJsonFrom(SOUNDINGS, 10, { path: [2], from: 4000 }, scan)!;
  assert.deepEqual(from.trail, [{ key: 'soundings', index: 2 }]);
  assert.equal(from.first, 4000);
  assert.equal(from.base.children![0]!.children![0]!.value, '4001');
  assert.equal(parseJsonFrom(SOUNDINGS, 10, { path: [7], from: 0 }, scan), null, 'a path past the entries leads nowhere');
});

test('the fast scan finds where the brackets or strings do not close, and such a file is set as written', () => {
  for (const [s, why] of [
    ['{"a": [1, 2}', 'a closing bracket'],
    ['{"a": "open', 'a closing quote'],
    ['[1, 2] 3', 'the end of the file'],
    ['{"a": [1', 'a closing bracket'],
    ['', 'a value'],
  ] as const) {
    assert.equal(scanJson(enc(s)).broken?.why, why, s);
  }
  const broken = enc(`${new TextDecoder().decode(PADDED).trimEnd().slice(0, -1)}\n`);
  assert.equal(readingOf('/d/broken.json', broken), null, 'past 1.5 MB, a JSON whose brackets do not close is shown as written');
});

test('a JSON file past 1.5 MB opens as the first 5,000 values from a streaming parse, with the same stops as a whole parse', () => {
  assert.ok(PADDED.length > 1.5 * 1024 * 1024);
  const read = readingOf('/d/padded.json', PADDED)!;
  assert.equal(read.id, 'tree');
  assert.deepEqual(read.tree, { total: 73_520, capped: true, top: true });
  assert.deepEqual(stops(read.html).map((s) => s.words.split('.')[0]), ['1 more key here, not drawn', '8,415 more items here, not drawn']);
  assert.deepEqual(undrawn(read.html), ['pad 3@0', 'notes 4@0']);
  assert.deepEqual(read.contents!.items.map((i) => i.sub), ['6 keys · line 2', '40 items · line 14', '9,000 items · line 296', 'line 83,646', 'line 83,647']);
  const from = readingOf('/d/padded.json', PADDED, null, treeFromOf('2@4000'))!;
  assert.equal(text(/<div class="marxy-tree-crumb">(.*?)<\/div>/.exec(from.html)![1]!), 'padded.json › soundings › from item 4,000');
  assert.match(from.html, /<span class="marxy-tree-index">4000<\/span>/);
  assert.match(stops(from.html).at(-1)!.words, /^4,385 more items here/);
});

test('a 20 MB JSON is counted and its first values drawn in a bounded time, past the first screen of its root list', () => {
  const rows = Array.from({ length: 320_000 }, (_, i) => `{"id":${i},"name":"row ${i} é","tags":["a","b"],"v":${i / 3}}`);
  const bytes = enc(`[${rows.join(',\n')}]`);
  assert.ok(bytes.length > 18 * 1024 * 1024);
  const t = cpuNow();
  const read = readingOf('/d/rows.json', bytes)!;
  const took = cpuNow() - t;
  assert.ok(took < 5000, `${Math.round(took)} ms`);
  assert.equal(read.tree!.total, 1 + 320_000 * 7);
  assert.match(stops(read.html).at(-1)!.words, /^[\d,]+ more items here, not drawn\./);
});

test('YAML, TOML and XML share the cap: a tree past it stops between items with Draw from here', () => {
  const yaml = `items:\n${Array.from({ length: 3000 }, (_, i) => `  - id: ${i}\n    tags: [a, b]`).join('\n')}\n`;
  const read = readingOf('/d/big.yaml', enc(yaml))!;
  assert.ok(read.tree!.capped);
  const [stop] = stops(read.html);
  assert.match(stop!.words, /^[\d,]+ more items here, not drawn\. The tree draws the first 5,000 values; Source has the rest, from line [\d,]+\./);
  const from = readingOf('/d/big.yaml', enc(yaml), null, treeFromOf(stop!.from))!;
  assert.match(text(/<div class="marxy-tree-crumb">(.*?)<\/div>/.exec(from.html)![1]!), /^big\.yaml › items › from item [\d,]+$/);
});

test('the Reading card lists four tiers for a tree, the second the one drawn in part', () => {
  assert.deepEqual(treeTierList('JSON').map((t) => t.name), ['The whole tree', `The first ${TREE_MAX_VALUES.toLocaleString('en-GB')} values`, 'As written', 'The bytes']);
  assert.match(treeTierList('YAML')[2]!.words, /past 1\.5 MB, or when it does not read as YAML/);
});
