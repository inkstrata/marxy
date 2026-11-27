// A data file too big or too deep to draw whole. A tree draws its
// first TREE_MAX_VALUES values (every value, a map or a list as much as a number, a table's row and each of its cells),
// stops between entries and says how many more there are and where Source has them; a file nested past TREE_MAX_DEPTH is
// set as written, never a stack overflow; a table or records page draws its first READING_MAX_COLUMNS columns; and the
// parsers read what they read before, a number of any length and a character reference past U+10FFFF included.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { describeColumn, READING_MAX_COLUMNS, READING_MAX_ROWS, readingOf, TREE_MAX_VALUES, WRITTEN_LINES_FROM } from './index.ts';
import { indexSome, parseSome, READING_MAX_KEYS, recordRows } from './rows.ts';
import { parseJson, parseToml, parseXml, parseYaml, TOML_MAX_KEY_STEPS, TREE_MAX_DEPTH, TreeError } from './tree.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const count = (html: string, re: RegExp): number => html.match(re)?.length ?? 0;
const N = TREE_MAX_VALUES.toLocaleString('en-GB');
const headOf = (html: string): string => /<span class="marxy-reading-head">(.*?)<\/span>/.exec(html)![1]!;
const stopsOf = (html: string): string[] => [...html.matchAll(/<div class="marxy-tree-stop"[^>]*><p><b>(.*?)<\/b>/g)].map((m) => m[1]!);

function within<T>(ms: number, what: string, fn: () => T): T {
  const t = cpuNow();
  const out = fn();
  const took = cpuNow() - t;
  assert.ok(took < ms, `${what}: ${Math.round(took)} ms, the bound is ${ms}`);
  return out;
}

test('a tree past its budget draws the first values in file order, stops between items and says how many more', () => {
  const read = readingOf('n.json', enc(JSON.stringify(Array.from({ length: 200_000 }, (_, i) => i))))!;
  assert.equal(read.id, 'tree');
  assert.equal(count(read.html, /class="marxy-tree-leaf"/g), TREE_MAX_VALUES);
  assert.match(read.html, /<span class="marxy-tree-index">0<\/span>/);
  assert.match(read.html, new RegExp(`<span class="marxy-tree-index">${TREE_MAX_VALUES - 1}</span>`));
  assert.doesNotMatch(read.html, new RegExp(`<span class="marxy-tree-index">${TREE_MAX_VALUES}</span>`));
  assert.equal(headOf(read.html), `JSON · 200,000 items at the top · the first ${N} of 200,001 values drawn; Source has the rest`, 'the head counts the whole file, the root a value too');
  assert.deepEqual(stopsOf(read.html), [`${(200_000 - TREE_MAX_VALUES).toLocaleString('en-GB')} more items here, not drawn.`]);
  assert.deepEqual(read.tree, { total: 200_001, capped: true, top: true });
  assert.equal(read.contents!.items.length, 200, 'the Keys card lists the first entries, each a way to draw from there');
  assert.equal(read.contents!.detail, 'the first 200 of 200,000 · draw from any');
});

test('a tree under the budget is drawn whole and says nothing of a budget', () => {
  const read = readingOf('s.json', enc('{"a": [1, 2, {"b": "c"}], "d": null}'))!;
  assert.doesNotMatch(read.html, /The first|marxy-tree-stop/);
  assert.equal(read.contents!.detail, undefined);
  assert.deepEqual(read.contents!.items.map((i) => [i.text, i.sub]), [['a', '3 items'], ['d', 'null']]);
  assert.deepEqual(read.tree, { total: 7, capped: false, top: true });
});

test('the budget counts every value: nested maps, a table\'s rows and cells, XML elements and their text', () => {
  const nested = JSON.stringify(Array.from({ length: 5000 }, (_, i) => (i % 2 ? { id: i, tags: ['a', 'b'] } : { n: i, v: { w: i } })));
  const read = readingOf('m.json', enc(nested))!;
  assert.match(headOf(read.html), /the first [\d,]+ of 22,501 values drawn; Source has the rest/);
  const table = readingOf('t.json', enc(JSON.stringify({ rows: Array.from({ length: 10_000 }, (_, i) => ({ id: i, name: `n${i}`, v: i / 7 })) })))!;
  const rows = count(table.html, /<tr data-marxy-s/g);
  assert.equal(rows, Math.ceil((TREE_MAX_VALUES - 1) / 4), 'a row is its map and three cells, after the list itself');
  assert.match(headOf(table.html), /of 40,002 values drawn/);
  assert.deepEqual(stopsOf(table.html), [`${(10_000 - rows).toLocaleString('en-GB')} more items here, not drawn.`], 'a table stops between its rows');
  const xml = readingOf('f.xml', enc(`<feed>${Array.from({ length: 6000 }, (_, i) => `<entry a="${i}"><t>x${i}</t></entry>`).join('')}</feed>`))!;
  assert.match(headOf(xml.html), /of 18,001 values drawn/);
  assert.match(stopsOf(xml.html)[0]!, /^[\d,]+ more children here, not drawn\.$/);
  assert.equal(xml.contents!.items.length, 1);
});

test('a big tree reads in a bounded time and a bounded page (1.4 MB JSON, TOML and a 200,000-item list)', () => {
  const json = JSON.stringify(Array.from({ length: 17_500 }, (_, i) => (i % 2 ? { id: i, name: `item ${i}`, ok: true, tags: ['a', 'b'] } : { id: i, title: `t${i}`, size: i * 3, when: '2026-01-01' })), null, 1);
  assert.ok(json.length > 1.3 * 1024 * 1024);
  const toml = Array.from({ length: 23_000 }, (_, i) => `[[item]]\nid = ${i}\nname = "item ${i}"\nok = true\nsize = ${i * 3}\n`).join('\n');
  assert.ok(toml.length > 1.3 * 1024 * 1024);
  for (const [path, text] of [['big.json', json], ['big.toml', toml], ['array.json', JSON.stringify(Array.from({ length: 200_000 }, (_, i) => i))]] as const) {
    const read = within(3000, path, () => readingOf(path, enc(text)))!;
    assert.equal(read.id, 'tree', path);
    assert.ok(read.html.length < 2_000_000, `${path}: ${read.html.length} characters of HTML`);
    assert.match(read.html, /Source has the rest/, path);
  }
});

test('a file nested deeper than the tree reads is set as written, at 100,000 levels too', () => {
  const cases: [string, string][] = [
    ['d.json', `${'['.repeat(100_000)}${']'.repeat(100_000)}`],
    ['o.json', `${'{"a":'.repeat(100_000)}1${'}'.repeat(100_000)}`],
    ['d.xml', `${'<a>'.repeat(100_000)}${'</a>'.repeat(100_000)}`],
    ['d.toml', `a = ${'['.repeat(100_000)}${']'.repeat(100_000)}\n`],
    ['k.toml', `${Array.from({ length: 2000 }, () => 'a').join('.')} = 1\n`],
    ['h.toml', `[${Array.from({ length: 2000 }, () => 'a').join('.')}]\nb = 1\n`],
    ['d.yaml', Array.from({ length: 1500 }, (_, i) => `${' '.repeat(i)}k:`).join('\n')],
  ];
  for (const [path, text] of cases) {
    const read = readingOf(path, enc(text))!;
    // From WRITTEN_LINES_FROM the lines are windowed (the Lines page) rather than all drawn: the reason is kept either way.
    assert.equal(read.id, enc(text).length >= WRITTEN_LINES_FROM ? 'lines' : 'written', path);
    assert.match(read.failed!.why, new RegExp(`nesting more than ${TREE_MAX_DEPTH} levels deep`), path);
  }
  const deepest = `${'['.repeat(TREE_MAX_DEPTH)}${']'.repeat(TREE_MAX_DEPTH)}`;
  assert.equal(readingOf('ok.json', enc(deepest))!.id, 'tree', 'the deepest a tree reads is drawn');
  assert.throws(() => parseJson(`[${deepest}]`), TreeError);
});

test('XML with a character reference past U+10FFFF does not read, and says where', () => {
  for (const text of ['<a>&#x110000;</a>', '<a b="&#99999999;"/>']) {
    const read = readingOf('c.xml', enc(text))!;
    assert.equal(read.id, 'written', text);
    assert.match(read.failed!.why, /character reference/);
  }
  assert.equal(parseXml('<a>&#x10FFFF;&#65;</a>').children![0]!.value, '\u{10FFFF}A');
});

test('a number of any length is a number', () => {
  const long = '1'.repeat(80);
  assert.equal(parseJson(`{"a": ${long}}`).children![0]!.value, long);
  assert.equal(parseJson(`-${long}.5e10`).value, `-${long}.5e10`);
  assert.equal(parseToml(`a = ${long}\n`).children![0]!.value, long);
});

test('a numeric column of 300,000 rows is described, not a RangeError', () => {
  const rows = ['x'];
  for (let i = 0; i < 300_000; i++) rows.push(String(i));
  assert.equal(describeColumn(rows.slice(1)), '0 to 299999');
  const read = readingOf('big.csv', enc(rows.join('\n')))!;
  assert.equal(read.contents!.items[0]!.sub, '0 to 299999');
  assert.match(read.html, /The first 200 rows of 300,000; the file open in Read has them all\./);
});

test('a table or records page draws its first columns and says how many there are', () => {
  const header = Array.from({ length: 1000 }, (_, i) => `c${i}`).join(',');
  const line = Array.from({ length: 1000 }, (_, i) => String(i)).join(',');
  const csv = readingOf('w.csv', enc(`${header}\n${Array.from({ length: 2000 }, () => line).join('\n')}\n`))!;
  assert.equal(count(csv.html, /<th /g), READING_MAX_COLUMNS);
  assert.equal(count(csv.html, /<td /g), READING_MAX_COLUMNS * READING_MAX_ROWS);
  assert.match(csv.html, new RegExp(`The first ${READING_MAX_COLUMNS} columns of 1,000; Table view has them all\\.`));
  assert.equal(csv.contents!.items.length, READING_MAX_COLUMNS);
  const record = JSON.stringify(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i])));
  const jsonl = within(3000, 'records 2,000 by 1,000', () => readingOf('w.jsonl', enc(Array.from({ length: 2000 }, () => record).join('\n')))!);
  assert.equal(jsonl.id, 'records');
  assert.equal(count(jsonl.html, /<th /g), READING_MAX_COLUMNS);
  assert.match(jsonl.html, new RegExp(`The first ${READING_MAX_COLUMNS} columns of 1,000; Source has them all\\.`));
  assert.match(jsonl.html, /JSON Lines · 2,000 records · 1,000 keys/);
});

test('JSON Lines naming a new key in every record keeps the first keys as columns, and the page says there are more', () => {
  const records = Array.from({ length: 1000 }, (_, r) => JSON.stringify(Object.fromEntries(Array.from({ length: 50 }, (_, k) => [`r${r}k${k}`, k]))));
  const bytes = enc(records.join('\n'));
  const rows = recordRows(bytes);
  indexSome(rows);
  parseSome(rows);
  // Fifty thousand keys named, ten thousand taken: the rest are counted, never kept.
  assert.equal(rows.columns.length, READING_MAX_KEYS);
  assert.equal(rows.keyAt.size, READING_MAX_KEYS);
  assert.equal(rows.keys.refused, 50_000 - READING_MAX_KEYS);
  const jsonl = readingOf('keys.jsonl', bytes)!;
  assert.equal(jsonl.id, 'records');
  assert.equal(count(jsonl.html, /<th /g), READING_MAX_COLUMNS);
  assert.match(jsonl.html, /JSON Lines · 1,000 records · more than 10,000 keys/);
  assert.match(jsonl.html, new RegExp(`The first ${READING_MAX_COLUMNS} columns of more than 10,000; Source has them all\\.`));
  assert.equal(jsonl.contents!.detail, `the first ${READING_MAX_COLUMNS} of more than 10,000`);
});

test('like XML elements still run together as a table from the first of the run that shares its keys', () => {
  const xml = '<r><e><a>1</a></e><e><b>2</b></e><e><b>3</b></e><e><b>4</b></e><f/></r>';
  const read = readingOf('r.xml', enc(xml))!;
  assert.equal(count(read.html, /class="marxy-tree-run"/g), 1);
  assert.match(read.html, /3 of them · as a table/);
  assert.equal(count(read.html, /<tr data-marxy-s/g), 3);
  const many = `<r>${'<e><a>1</a></e>'.repeat(50_000)}<e><b>2</b></e></r>`;
  within(2000, 'a run of 50,000 that is not a table', () => readingOf('m.xml', enc(many)));
});

test('TOML of 150,000 table headers reads in a bounded time, each header found by its name', () => {
  const toml = Array.from({ length: 150_000 }, (_, i) => `[t${i}]`).join('\n');
  assert.ok(toml.length > 1.1 * 1024 * 1024);
  const read = within(3000, '150,000 headers', () => readingOf('h.toml', enc(toml)))!;
  assert.equal(read.id, 'tree');
  assert.match(headOf(read.html), /^TOML · 150,000 keys at the top/);
  const root = parseToml('[a]\nx = 1\n[b]\n[a.c]\ny = 2\n[[l]]\nz = 3\n[[l]]\nz = 4\n');
  assert.deepEqual(root.children!.map((c) => c.key), ['a', 'b', 'l'], 'a table named again is the one first written');
  assert.deepEqual(root.children![0]!.children!.map((c) => c.key), ['x', 'c']);
  assert.equal(root.children![2]!.children!.length, 2);
  assert.throws(() => parseToml('a = 1\n[a]\n'), TreeError, 'a value is not a table');
});

test('TOML that names more tables than the parse looks up is set as written, and says so', () => {
  const toml = Array.from({ length: TOML_MAX_KEY_STEPS / 2 + 1 }, (_, i) => `[a.t${i}]`).join('\n');
  const read = within(3000, 'past the key steps', () => readingOf('s.toml', enc(toml)))!;
  assert.equal(read.id, enc(toml).length >= WRITTEN_LINES_FROM ? 'lines' : 'written');
  assert.match(read.failed!.why, /more than 250,000 table names to look up/);
});

test('YAML and TOML within the depth read as before', () => {
  assert.equal(parseYaml('a:\n  b:\n    - 1\n    - c: 2\n').children![0]!.children![0]!.kind, 'list');
  assert.equal(parseToml('[a.b]\nc = [1, [2, 3]]\n').children![0]!.children![0]!.children![0]!.kind, 'list');
});
