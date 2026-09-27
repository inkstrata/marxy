// The frontispiece's pure half (MARXY-257): which Commonplace piece a launch with no document shows,
// that only that one is read, and the front-matter fields the layout reads. Sources are injected;
// nothing here depends on the real corpus (MARXY-256), which may hold any number of pieces or none.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  choosePiece,
  directionOf,
  loadRandomPiece,
  piecesFromGlob,
  readFrontMatter,
} from '../src/frontispiece/pieces.ts';

/** Sources that count their reads. */
function counted(names) {
  const reads = [];
  const sources = names.map((name) => ({ name, load: async () => (reads.push(name), `# ${name}\n`) }));
  return { sources, reads };
}

test('no pieces: nothing is chosen and nothing is read', async () => {
  assert.equal(choosePiece([]), null);
  assert.equal(await loadRandomPiece([]), null);
});

test('the choice is uniform over the sources and always in range', () => {
  const { sources } = counted(['a', 'b', 'c', 'd']);
  assert.equal(choosePiece(sources, () => 0).name, 'a');
  assert.equal(choosePiece(sources, () => 0.2499).name, 'a');
  assert.equal(choosePiece(sources, () => 0.25).name, 'b');
  assert.equal(choosePiece(sources, () => 0.9999999).name, 'd');
  // A generator that misbehaves still lands on a piece rather than off the end.
  assert.equal(choosePiece(sources, () => 1).name, 'd');
  assert.equal(choosePiece(sources, () => -0.5).name, 'a');
});

test('every piece can be chosen, and the default generator varies between launches', () => {
  const { sources } = counted(['a', 'b', 'c']);
  const seen = new Set();
  for (let i = 0; i < 3; i++) seen.add(choosePiece(sources, () => i / 3).name);
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
  const many = new Set();
  for (let i = 0; i < 200; i++) many.add(choosePiece(sources).name);
  assert.equal(many.size, 3, 'Math.random over 200 launches never reached every piece');
});

test('only the chosen piece is read', async () => {
  const { sources, reads } = counted(['a', 'b', 'c']);
  const piece = await loadRandomPiece(sources, () => 0.5);
  assert.deepEqual(piece, { name: 'b', text: '# b\n' });
  assert.deepEqual(reads, ['b']);
});

test('a piece that cannot be read is no piece, not an error', async () => {
  const sources = [{ name: 'broken', load: async () => { throw new Error('chunk missing'); } }];
  assert.equal(await loadRandomPiece(sources), null);
});

test('a glob record becomes sources named by slug, in path order, loaded lazily', async () => {
  const loads = [];
  const record = {
    '../commonplace/pieces/zeta.md': async () => (loads.push('zeta'), 'Z'),
    '../commonplace/pieces/alpha.md': async () => (loads.push('alpha'), 'A'),
  };
  const sources = piecesFromGlob(record);
  assert.deepEqual(sources.map((s) => s.name), ['alpha', 'zeta']);
  assert.deepEqual(loads, [], 'building the sources read a piece');
  assert.equal(await sources[1].load(), 'Z');
  assert.deepEqual(loads, ['zeta']);
  assert.deepEqual(piecesFromGlob({}), []);
});

test('front matter as FORMAT.md writes it: quoted and plain scalars, comments, a flow list', () => {
  const yaml = [
    'title: I died for Beauty            # as the piece is known',
    'author: Emily Dickinson',
    'date: "c. 1862; printed 1890"      # a string',
    'form: verse                         # verse | prose | code',
    'languages: [en]                     # BCP 47',
    'source: "Poems (Boston: Roberts Brothers, 1890)"',
    'transcription: https://www.gutenberg.org/ebooks/12242   # the digital text',
    'rights: public-domain',
  ].join('\n');
  assert.deepEqual(readFrontMatter(yaml), {
    title: 'I died for Beauty',
    author: 'Emily Dickinson',
    form: 'verse',
    languages: ['en'],
  });
});

test('two languages in order, as a flow list or a block list', () => {
  assert.deepEqual(readFrontMatter('form: prose\nlanguages: [de, en]').languages, ['de', 'en']);
  assert.deepEqual(readFrontMatter("languages: ['zh-Hant', \"en\"]").languages, ['zh-Hant', 'en']);
  assert.deepEqual(readFrontMatter('languages:\n  - fa\n  - en\ntitle: x').languages, ['fa', 'en']);
  assert.deepEqual(readFrontMatter('languages: la').languages, ['la']);
});

test('front matter the layout cannot use falls back to prose with no languages', () => {
  assert.deepEqual(readFrontMatter(''), { title: null, author: null, form: 'prose', languages: [] });
  assert.equal(readFrontMatter('form: sonnet').form, 'prose');
  assert.equal(readFrontMatter('form: code').form, 'code');
  assert.equal(readFrontMatter('title: "Colon: inside quotes" # c').title, 'Colon: inside quotes');
  assert.equal(readFrontMatter('title: C# in a plain scalar').title, 'C# in a plain scalar');
});

test('a section is set right to left for a right-to-left language or script', () => {
  assert.equal(directionOf('fa'), 'rtl');
  assert.equal(directionOf('he'), 'rtl');
  assert.equal(directionOf('ar-EG'), 'rtl');
  assert.equal(directionOf('en'), 'ltr');
  assert.equal(directionOf('zh-Hant'), 'ltr');
  assert.equal(directionOf('pa-Arab'), 'rtl');
  assert.equal(directionOf('ku-Latn'), 'ltr');
});
