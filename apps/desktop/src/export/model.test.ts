// Export's model: the forms each "what" offers, the names things are saved under, the lines of a selection byte for byte,
// a table as JSON Lines, the bundle's entries and its manifest (with true SHA-256s and what is left out).
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { bundleBase, bundleEntries, chosenAs, copyZipPath, defaultWhat, exportName, formsFor, isTextual, jsonLines, leftOut, linesBytes, MANIFEST, manifestOf, notesMarkdown, pointedPaths, relativeTo, type BundleFile, type BundleOptions } from './model.ts';

const md = { text: true, markdown: true, table: false };
const csv = { text: true, markdown: false, table: true };
const bytes = { text: false, markdown: false, table: false };
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('the forms of each what, in order; a table adds JSON Lines to the file only; bytes are only as written', () => {
  assert.deepEqual(formsFor('file', md).map((f) => f.id), ['html', 'pdf', 'raw', 'text']);
  assert.equal(formsFor('file', md)[2]!.label, 'Markdown, as written');
  assert.deepEqual(formsFor('file', csv).map((f) => f.id), ['html', 'pdf', 'raw', 'text', 'jsonl']);
  assert.deepEqual(formsFor('selection', csv).map((f) => f.id), ['html', 'pdf', 'raw', 'text']);
  assert.deepEqual(formsFor('file', bytes).map((f) => [f.id, f.label]), [['raw', 'The file, as written']]);
  assert.deepEqual(formsFor('ticked', null).map((f) => f.id), ['html1', 'md1', 'zip']);
  assert.deepEqual(formsFor('tray', null).map((f) => f.id), ['trmd', 'brief']);
  assert.equal(chosenAs('ticked', formsFor('ticked', null), undefined), 'zip');
  assert.equal(chosenAs('selection', formsFor('selection', md), undefined), 'raw');
  assert.equal(chosenAs('file', formsFor('file', md), 'text'), 'text');
  assert.equal(chosenAs('file', formsFor('file', bytes), 'html'), 'raw', 'a choice not offered falls back');
  assert.equal(isTextual('raw', md), true);
  assert.equal(isTextual('raw', bytes), false);
  assert.equal(isTextual('html', md), false);
});

test('the default what: the tray on its page, two ticked, the file, then whatever there is', () => {
  const can = (o: Partial<Record<'file' | 'selection' | 'ticked' | 'tray', boolean>>) => ({ file: false, selection: false, ticked: false, tray: false, ...o });
  assert.equal(defaultWhat(can({ file: true, tray: true }), true, 0), 'tray');
  assert.equal(defaultWhat(can({ file: true, ticked: true }), false, 2), 'ticked');
  assert.equal(defaultWhat(can({ file: true, ticked: true }), false, 1), 'file');
  assert.equal(defaultWhat(can({ ticked: true }), false, 1), 'ticked');
  assert.equal(defaultWhat(can({}), false, 0), null);
});

test('names: the file\'s stem and the form\'s extension; as written keeps the name; a bundle is named for its set or folder', () => {
  assert.equal(exportName('html', 'file', 'plan', 'plan.md'), 'plan.html');
  assert.equal(exportName('raw', 'file', 'plan', 'plan.md'), 'plan.md');
  assert.equal(exportName('raw', 'selection', 'plan-lines-3-9', 'plan.md'), 'plan-lines-3-9.md');
  assert.equal(exportName('zip', 'ticked', 'plans', ''), 'plans.zip');
  assert.equal(exportName('brief', 'tray', 'tray', ''), 'tray-brief.md');
  assert.equal(bundleBase(['/r/plans/a.md', '/r/plans/b.md'], []), 'plans');
  assert.equal(bundleBase(['/r/plans/a.md', '/r/b.md'], [{ name: 'The Postgres Upgrade', tabs: ['/r/plans/a.md', '/r/b.md', '/r/c.md'] }]), 'postgres-upgrade');
  assert.equal(bundleBase(['/r/a/x.md', '/r/b/y.md'], []), 'export');
  assert.equal(relativeTo('/r', '/r/plans/a.md'), 'plans/a.md');
  assert.equal(relativeTo(null, '/r/plans/a.md'), 'a.md');
  assert.equal(relativeTo('', 'C:/Users/i/a.md'), 'Users/i/a.md', 'folders on one drive: no drive letter');
  assert.equal(relativeTo('', 'C:/a.md'), 'a.md', 'a file at a drive root');
  assert.equal(relativeTo('', '//server/share/a.md'), 'server/share/a.md', 'no UNC root');
  assert.equal(relativeTo('/r', '/r/../x/./a.md'), 'x/a.md', 'no .. or .');
  assert.equal(copyZipPath('/r/plans/a.md', Date.UTC(2026, 9, 8, 9, 14, 3)), 'r/plans/a.md/2026-10-08T09-14-03.md');
});

test('linesBytes: exactly the lines asked for, each with its own ending, the last without one if the file has none', () => {
  const b = enc('one\r\ntwo\nthree\r\nfour');
  const s = (x: Uint8Array) => new TextDecoder().decode(x);
  assert.equal(s(linesBytes(b, 1, 1)), 'one\r\n');
  assert.equal(s(linesBytes(b, 2, 3)), 'two\nthree\r\n');
  assert.equal(s(linesBytes(b, 3, 4)), 'three\r\nfour');
  assert.equal(s(linesBytes(b, 4, 9)), 'four');
});

test('linesBytes: bare CR, LF and CRLF endings count as the cursor counts them, so a part is the part saved', () => {
  const s = (x: Uint8Array) => new TextDecoder().decode(x);
  const cr = enc('one\rtwo\rthree\r');
  assert.equal(s(linesBytes(cr, 1, 1)), 'one\r');
  assert.equal(s(linesBytes(cr, 2, 3)), 'two\rthree\r');
  const mixed = enc('a\rb\nc\r\nd');
  assert.equal(s(linesBytes(mixed, 2, 2)), 'b\n');
  assert.equal(s(linesBytes(mixed, 3, 4)), 'c\r\nd');
  assert.equal(s(linesBytes(mixed, 9, 9)), '', 'past the end is empty');
});

test('JSON Lines: one record a row, the header\'s keys, a short row filled with empty strings', () => {
  assert.equal(jsonLines([['service', 'p95'], ['indexer', '120'], ['watcher']]), '{"service":"indexer","p95":"120"}\n{"service":"watcher","p95":""}\n');
  assert.equal(jsonLines([['a']]), '');
});

test('pointedPaths: relative links and bare paths, never a URL', () => {
  assert.deepEqual(pointedPaths('See [the plan](plans/a.md#scope), [site](https://x.y/z.md) and `src/main.rs:12`.').sort(), ['plans/a.md', 'src/main.rs']);
});

test('the bundle: files as on disk, notes and patches when asked; the manifest gives sizes, true SHA-256s and what is left out', async () => {
  const disk = enc('# A\n');
  const files: BundleFile[] = [
    { zip: 'plans/a.md', name: 'a.md', disk, dirty: true, patch: '--- a\n+++ a\n', notes: notesMarkdown('/r/plans/a.md', ['# A'], [{ l0: 0, text: 'Check.' }]), noteCount: 1 },
    { zip: 'plans/b.md', name: 'b.md', disk: enc('# B\n'), dirty: false, patch: null, notes: null, noteCount: 0 },
  ];
  const o: BundleOptions = { manifest: true, notes: true, patches: false, pointed: false, pages: false };
  const ents = bundleEntries(files, o, { pointed: [], pages: [] });
  assert.deepEqual(ents.map((e) => e.path), ['plans/a.md', 'plans/b.md', 'notes/a.md.notes.md']);
  assert.deepEqual(bundleEntries(files, { ...o, patches: true, notes: false }, { pointed: [], pages: [] }).map((e) => e.path), ['plans/a.md', 'plans/b.md', 'patches/a.md.patch']);
  const words = leftOut(files, o, 3);
  assert.deepEqual(words, ['1 file has unsaved changes; the bundle holds it as it is on disk.', '3 files these two point to are not included.']);
  const man = await manifestOf('plans.zip', ents, words, true, false);
  assert.ok(man.includes(`| plans/a.md | 4 | ${createHash('sha256').update(disk).digest('hex')} |`), man);
  assert.ok(man.includes('| manifest.md | | this file |'));
  assert.ok(/## Left out\n\n1 file has unsaved changes/.test(man));
  const peek = await manifestOf('plans.zip', ents, [], false, true);
  assert.ok(peek.startsWith('# plans.zip\n\nA peek: nothing is built'));
  assert.ok(peek.includes('This manifest itself: it is not ticked'));
});

test('a note by address is under its address in the notes file, not under line 1', () => {
  const md = notesMarkdown('/r/a.xlsx', ['PK'], [{ l0: 0, text: 'Odd total', address: '#Summary!F5' }]);
  assert.equal(md, '# Notes on /r/a.xlsx\n\n## `/r/a.xlsx#Summary!F5`\n\nOdd total\n');
});

test('a ticked file named manifest.md gives way to the manifest packed after it; without the manifest it keeps its name', () => {
  const f: BundleFile = { zip: MANIFEST, name: MANIFEST, disk: enc('mine\n'), dirty: false, patch: null, notes: null, noteCount: 0 };
  const o: BundleOptions = { manifest: true, notes: false, patches: false, pointed: false, pages: false };
  assert.deepEqual(bundleEntries([f], o, { pointed: [], pages: [] }).map((e) => e.path), ['manifest (2).md']);
  assert.deepEqual(bundleEntries([f], { ...o, manifest: false }, { pointed: [], pages: [] }).map((e) => e.path), ['manifest.md']);
});
