import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DOCUMENTS, documentsFor, parseArgs } from './measure-interactions.mjs';
import { RECORD_VERSION, STEPS, buildRecord, compare, flatten, formatCompare, formatTable, median, medians, neutraliseDefinitions, warnings } from './lib/interactions-record.mjs';

const meta = { commit: 'abc12345', dirty: false, date: '2026-11-24T00:00:00.000Z', machine: 'win32-x64', edge: 'msedge 1', runs: 3 };
const doc = (task, replaced) => ({
  open: { firstContentMs: 100, taskMs: task, nodes: 5000 },
  key: { taskMs: 40, layouts: 4 },
  undo: { taskMs: task, removedTop: replaced },
});

test('median ignores what is not a number and is NaN for none', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([1, undefined, Number.NaN, 5, 'x']), 3);
  assert.ok(Number.isNaN(median([])));
});

test('medians takes each field over the repetitions that produced it', () => {
  assert.deepEqual(medians([{ a: 1, b: 10 }, { a: 3 }, { a: 2, b: 20 }]), { a: 2, b: 15 });
  assert.deepEqual(medians([]), {});
});

test('buildRecord keeps the shape and names every step that produced no number', () => {
  const r = buildRecord({ meta, documents: { long: doc(900, 2700), short: { open: { taskMs: 1 } } }, steps: ['open', 'key', 'undo'] });
  assert.equal(r.version, RECORD_VERSION);
  assert.deepEqual(r.meta, meta);
  assert.deepEqual(r.documents.long.undo, { taskMs: 900, removedTop: 2700 });
  assert.deepEqual(r.missing, ['short/key', 'short/undo']);
  assert.equal('key' in r.documents.short, false);
  assert.deepEqual(buildRecord({ meta, documents: { long: { open: {} } }, steps: ['open'] }).missing, ['long/open']);
});

test('flatten names every number by document, step and field', () => {
  const flat = flatten(buildRecord({ meta, documents: { long: doc(900, 2700) }, steps: ['open', 'key', 'undo'] }));
  assert.equal(flat.get('long/undo/removedTop'), 2700);
  assert.equal(flat.get('long/key/layouts'), 4);
  assert.equal(flat.size, 7);
});

test('compare gives the change and the percentage, in step order, and shows a number only one side has', () => {
  const base = buildRecord({ meta, documents: { long: doc(1000, 2700) }, steps: ['open', 'key', 'undo'] });
  const now = buildRecord({ meta, documents: { long: { ...doc(250, 3), click: { taskMs: 80 } } }, steps: ['open', 'key', 'undo', 'click'] });
  const rows = compare(base, now);
  const row = name => rows.find(r => r.name === name);
  assert.deepEqual(
    { before: row('long/undo/removedTop').before, after: row('long/undo/removedTop').after, change: row('long/undo/removedTop').change, percent: row('long/undo/removedTop').percent },
    { before: 2700, after: 3, change: -2697, percent: -100 },
  );
  assert.equal(row('long/open/taskMs').percent, -75);
  assert.equal(row('long/key/layouts').change, 0);
  assert.equal(row('long/click/taskMs').before, undefined);
  assert.equal(row('long/click/taskMs').change, undefined);
  const order = rows.map(r => r.step);
  assert.deepEqual(order, [...order].sort((a, b) => STEPS.findIndex(s => s.step === a) - STEPS.findIndex(s => s.step === b)));
});

test('the printed table and comparison carry the numbers and warn about a different machine', () => {
  const base = buildRecord({ meta, documents: { long: doc(1000, 2700) }, steps: ['open', 'key', 'undo'] });
  const now = buildRecord({ meta: { ...meta, machine: 'other' }, documents: { long: doc(250, 3) }, steps: ['open', 'key', 'undo'] });
  const table = formatTable(now);
  assert.match(table, /undo\s+removedTop 3\s.*taskMs 250/);
  assert.match(table, /idle for about a second/);
  const text = formatCompare(base, now);
  assert.match(text, /long\/undo\/removedTop\s+2700\s+3\s+-2697\s+-100%/);
  assert.match(text, /machines differ/);
  assert.doesNotMatch(formatCompare(base, base), /machines differ/);
});

test('parseArgs reads the options and refuses the rest', () => {
  assert.deepEqual(parseArgs([]).docs, Object.keys(DOCUMENTS));
  const o = parseArgs(['--runs', '5', '--keys=10', '--docs', 'long-reference', '--record', 'a.json', '--compare', 'b.json']);
  assert.deepEqual([o.runs, o.keys, o.docs, o.record, o.compare], [5, 10, ['long-reference'], 'a.json', 'b.json']);
  assert.throws(() => parseArgs(['--runs', '0']), /--runs/);
  assert.throws(() => parseArgs(['--docs', 'huge']), /--docs/);
  assert.throws(() => parseArgs(['--against', 'x.json']), /--compare/);
  assert.throws(() => parseArgs(['--record']), /needs a value/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

test('a file given with --doc stands alone, under its own name, and cannot take a built-in name', () => {
  assert.deepEqual(parseArgs(['--doc', 'x/notes.md']).docs, []);
  const docs = documentsFor(parseArgs(['--doc', 'x/notes.md']));
  assert.deepEqual(Object.keys(docs), ['notes.md']);
  assert.equal(docs['notes.md'].path, '/demo/reading/notes.md');
  assert.equal(docs['notes.md'].steps, undefined);
  assert.deepEqual(Object.keys(documentsFor(parseArgs(['--docs', 'short-document', '--doc', 'n.md']))), ['short-document', 'n.md']);
  assert.throws(() => documentsFor(parseArgs(['--doc', 'a/short-document'])), /already/);
  assert.throws(() => parseArgs(['--docs', 'long']), /--docs/);
});

test('the plain long document is the long one with every definition escaped, and is measured on the edit steps only', () => {
  const text = readFileSync(new URL('../fixtures/corpus/32-long-reference.md', import.meta.url), 'utf8');
  const definition = /^ {0,3}\[[^\]\n]+\]:/gm;
  assert.equal(text.match(definition).length, 30);
  const plain = DOCUMENTS['long-reference-plain'].transform(text);
  assert.equal(plain.match(definition), null);
  assert.equal(plain.length, text.length + 30);
  assert.equal(plain.replaceAll('\\[', '['), text);
  assert.deepEqual(DOCUMENTS['long-reference-plain'].steps, ['open', 'undo', 'reload']);
});

test('neutraliseDefinitions escapes footnote and link definitions and nothing else', () => {
  const text = ['[^1]: note', '   [ref]: https://x.invalid', 'text [^1] and [a]: inline', '    [indented]: code', '[plain] line', ''].join('\n');
  const want = ['\\[^1]: note', '   \\[ref]: https://x.invalid', 'text [^1] and [a]: inline', '    [indented]: code', '[plain] line', ''].join('\n');
  assert.equal(neutraliseDefinitions(text), want);
});

test('every step prints its counts before its durations, and an edit counts nodes put in as well as taken out', () => {
  for (const { step, fields } of STEPS) {
    const units = fields.map(f => f[1]).join('');
    assert.match(units, /^n*(ms)*$/, step);
  }
  for (const step of ['undo', 'reload']) assert.deepEqual(STEPS.find(s => s.step === step).fields.slice(0, 2).map(f => f[0]), ['removedTop', 'addedTop']);
});

test('the comparison warns when the two records did not measure the same thing, and says when the app is the same', () => {
  const code = { apps: 'a1', packages: 'p1', fixtures: 'f1', dirty: false };
  const steps = ['open', 'key', 'undo'];
  const base = buildRecord({ meta: { ...meta, keys: 20, code }, documents: { long: doc(1000, 2700) }, steps });
  assert.deepEqual(warnings(base, base), ['the app, packages and fixtures are the same in both: any change is the machine or the tool']);
  const other = buildRecord({ meta: { ...meta, keys: 5, dirty: true, code: { ...code, apps: 'a2' } }, documents: { long: doc(1000, 2700), short: doc(10, 1) }, steps });
  const w = warnings(base, other).join('\n');
  assert.match(w, /documents or steps differ/);
  assert.match(w, /runs or keys differ/);
  assert.match(w, /this record was taken on a tree with uncommitted changes/);
  assert.doesNotMatch(w, /are the same in both/);
  const dirtyCode = buildRecord({ meta: { ...meta, keys: 20, code: { ...code, dirty: true } }, documents: { long: doc(1000, 2700) }, steps });
  assert.doesNotMatch(warnings(base, dirtyCode).join('\n'), /are the same in both/);
  const fewer = buildRecord({ meta: { ...meta, keys: 20, code }, documents: { long: { open: doc(1, 1).open } }, steps: ['open'] });
  assert.match(warnings(base, fewer).join('\n'), /documents or steps differ/);
  assert.match(formatCompare(base, { ...other, version: 1 }), /warning: record versions differ/);
});

test('buildRecord takes the steps run on each document', () => {
  const r = buildRecord({ meta, documents: { a: { open: { taskMs: 1 } }, b: { open: { taskMs: 1 } } }, steps: { a: ['open'], b: ['open', 'undo'] } });
  assert.deepEqual(r.missing, ['b/undo']);
});
