// A word that names a kind narrows the Line's files; the other words rank as they did, and an ordinary word never narrows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { answersKinds, kindQuery, kindText } from './kind-words.ts';
import { acceptedHits, paletteResults, prepareIndex } from './search.ts';
import { emptySession } from './session.ts';

function file(path: string, size = 1000): IndexEntry {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { path, root: '/w', title: name.replace(/\.[^.]+$/, ''), headings: [], mtimeMs: 1, size, kind: 'text' };
}

const words = (text: string) => kindQuery(text)?.words.map((w) => w.text);

test('kindQuery: the curated words, a dotted extension, and the words left over', () => {
  assert.deepEqual(kindQuery('ragged pdf '), { words: [{ text: 'pdf', dotted: false, spec: { exts: ['pdf'] } }], rest: 'ragged', explicit: false });
  assert.deepEqual(words('ragged .pdf'), ['pdf']);
  assert.equal(kindQuery('ragged .pdf')!.explicit, true);
  assert.deepEqual(words('notes md '), ['md']);
  assert.equal(kindQuery('notes md ')!.rest, 'notes');
  assert.deepEqual(words('log errors'), ['log']);
  assert.deepEqual(words('images '), ['images']);
  assert.deepEqual(words('.rs'), ['rs'], 'any registered extension, with its dot');
  assert.equal(kindQuery('.nosuchext'), null);
  assert.equal(kindQuery('ragged lines '), null);
  assert.equal(kindQuery('pdf @intro '), null);
  assert.equal(kindQuery('@pdf '), null);
});

test('ordinary words never narrow', () => {
  for (const q of ['desktop ', 'data model ', 'docs install ', 'notes ', 'code ', 'text ', 'go ', 'make ', 'word ', 'report ']) {
    assert.equal(kindQuery(q), null, q);
  }
});

test('the last word narrows as soon as it is a whole word of the list, or a dotted extension', () => {
  assert.deepEqual(words('ragged pdf'), ['pdf']);
  assert.deepEqual(words('pdf'), ['pdf']);
  assert.deepEqual(words('ragged .pdf'), ['pdf']);
  for (const q of ['go', 'golden', 'lo', 'pd', '.']) assert.equal(kindQuery(q), null, q);
});

test('answersKinds: by extension, viewer or reader kind; a name keeps its files by whole words of the whole path', () => {
  const md = file('/w/ragged.md');
  assert.equal(answersKinds(file('/w/ragged.pdf'), kindQuery('pdf ')!), true);
  assert.equal(answersKinds(md, kindQuery('pdf ')!), false);
  assert.equal(answersKinds(md, kindQuery('md ')!), true);
  assert.equal(answersKinds(file('/w/a.png'), kindQuery('image ')!), true);
  assert.equal(answersKinds(file('/w/app.log'), kindQuery('log ')!), true);
  assert.equal(answersKinds(file('/w/a.rs'), kindQuery('.rs')!), true);
  // The name escape: whole words, folders included.
  assert.equal(answersKinds(file('/w/md-guide.txt'), kindQuery('md ')!), true);
  assert.equal(answersKinds(file('/w/log/readme.txt'), kindQuery('log ')!), true, 'a folder called log');
  assert.equal(answersKinds(file('/w/logs/readme.txt'), kindQuery('log ')!), true, 'logs/ is log');
  assert.equal(answersKinds(file('/w/log/readme.txt'), kindQuery('logs ')!), true, 'and the other way');
  assert.equal(answersKinds(file('/w/cmd.ts'), kindQuery('md ')!), false, 'md is not in cmd');
  assert.equal(answersKinds(file('/w/errors.log'), kindQuery('.rs')!), false);
  assert.equal(answersKinds(file('/w/tests.md'), kindQuery('json ')!), false);
  assert.equal(answersKinds(file('/w/notes-md.txt'), kindQuery('.md')!), false, 'a dotted word looks at the extension alone');
});

test('a kind word narrows the search and leaves the ranking of the other words alone', () => {
  const entries = [file('/w/ragged.md'), file('/w/ragged.pdf'), file('/w/ragged-edge.pdf'), file('/w/other.pdf'), file('/w/app.log')];
  const prepared = prepareIndex(entries);
  const session = emptySession('/w');
  const q = kindQuery('ragged pdf ')!;
  const accept = (e: IndexEntry): boolean => answersKinds(e, q);
  const narrowed = paletteResults(q.rest, entries, session, { prepared, accept }).map((h) => h.entry.path);
  assert.deepEqual([...narrowed].sort(), ['/w/ragged-edge.pdf', '/w/ragged.pdf']);
  const plain = paletteResults(q.rest, entries, session, { prepared }).map((h) => h.entry.path).filter((p) => narrowed.includes(p));
  assert.deepEqual(narrowed, plain, 'same order as the unnarrowed search');
});

test('only kind words: files matching the word as a name lead, then the rest of the kind, newest first', () => {
  const old = { ...file('/w/old.pdf'), mtimeMs: 1 };
  const fresh = { ...file('/w/new.pdf'), mtimeMs: 9 };
  const named = { ...file('/w/pdf-guide.md'), mtimeMs: 0 };
  const entries = [old, file('/w/a.md'), fresh, named];
  const prepared = prepareIndex(entries);
  const session = emptySession('/w');
  const q = kindQuery('pdf ')!;
  const accept = (e: IndexEntry): boolean => answersKinds(e, q);
  const first = paletteResults(kindText(q), entries, session, { prepared, accept }).map((h) => h.entry.path);
  assert.ok(first.includes('/w/pdf-guide.md'));
  const rest = acceptedHits(prepared, session, 50, undefined, undefined, accept, 'pdf').map((h) => h.entry.path);
  assert.deepEqual(rest, ['/w/new.pdf', '/w/old.pdf', '/w/pdf-guide.md']);
});

test('a kind scan is kept for the same words until the index changes', () => {
  const entries = [file('/w/a.pdf'), file('/w/b.pdf')];
  const prepared = prepareIndex(entries);
  const session = emptySession('/w');
  let calls = 0;
  const accept = (e: IndexEntry): boolean => (calls++, e.path.endsWith('.pdf'));
  acceptedHits(prepared, session, 50, undefined, undefined, accept, 'pdf');
  acceptedHits(prepared, session, 50, undefined, undefined, accept, 'pdf');
  assert.equal(calls, 2, 'the second call scanned nothing');
  acceptedHits(prepared, session, 50, undefined, undefined, accept, 'image');
  assert.equal(calls, 4, 'other words scan again');
});
