// The Commonplace gate (MARXY-256) must refuse an unsourced, uncleared or colophon-less piece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCorpus, checkInfo, checkPiece, loadCorpus, parseFrontMatter, rightsProblems } from './check-commonplace.mjs';

const YEAR = 2026;

const meta = (over = {}) => ({
  title: 'A poem', author: 'A Poet', author_died: 1900, date: '1890', form: 'verse', languages: '[en]',
  first_published: 1890, source: 'Poems (London, 1890)', transcription: 'https://example.org/poems',
  rights: 'public-domain', ...over,
});

function piece(over = {}, body = '# A poem\n\nLine one,\\\nline two.\n\n---\n\nA Poet, *Poems* (London, 1890).\n') {
  const lines = Object.entries(meta(over)).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

test('a sourced, cleared piece with a colophon passes', () => {
  assert.deepEqual(checkPiece('ok.md', piece(), YEAR), []);
});

test('every required front-matter field is enforced', () => {
  for (const key of ['title', 'author', 'date', 'form', 'languages', 'source', 'transcription', 'rights']) {
    const problems = checkPiece('p.md', piece({ [key]: undefined }), YEAR);
    assert.ok(problems.some(p => p.includes(`front matter has no ${key}`)), key);
  }
});

test('life + 70 is computed from the death year, not trusted from the label', () => {
  assert.match(checkPiece('p.md', piece({ author_died: 1956 }), YEAR).join('\n'), /died in 1956; life \+ 70 is not met until 2027/);
  assert.deepEqual(checkPiece('p.md', piece({ author_died: 1955 }), YEAR), []);
  assert.deepEqual(checkPiece('p.md', piece({ author_died: -450 }), YEAR), []);
});

test('the US rule needs publication 95 years back, or a stated basis', () => {
  assert.match(checkPiece('p.md', piece({ first_published: 1931 }), YEAR).join('\n'), /add us_basis/);
  assert.deepEqual(checkPiece('p.md', piece({ first_published: 1930 }), YEAR), []);
  assert.deepEqual(checkPiece('p.md', piece({ first_published: 1932, us_basis: 'not restored' }), YEAR), []);
});

test('a borrowed translation is judged like an author; a Marxy translation must say so', () => {
  const d = { ...meta(), languages: ['en'], translator: 'A Translator', translator_died: 1980, translation_published: 1920 };
  assert.match(rightsProblems(d, YEAR).join('\n'), /translator died in 1980/);
  assert.match(rightsProblems({ ...d, translator_died: 1920, translation_published: 1950 }, YEAR).join('\n'), /translation first published 1950/);
  assert.match(rightsProblems({ ...meta(), rights: 'public-domain+marxy-translation' }, YEAR).join('\n'), /needs `translator: Marxy`/);
  assert.deepEqual(rightsProblems({ ...meta(), rights: 'public-domain+marxy-translation', translator: 'Marxy' }, YEAR), []);
});

test('an editor still in copyright blocks the piece', () => {
  assert.match(checkPiece('p.md', piece({ editor: 'An Editor', editor_died: 1990 }), YEAR).join('\n'), /editor died in 1990/);
});

test('an unknown or declared basis is handled explicitly', () => {
  assert.match(checkPiece('p.md', piece({ rights: 'fair-use' }), YEAR).join('\n'), /not one of/);
  assert.match(checkPiece('p.md', piece({ rights: 'public-domain-declared' }), YEAR).join('\n'), /needs a rights_note/);
  assert.deepEqual(checkPiece('p.md', piece({ rights: 'public-domain-declared', rights_note: 'marked PD at source' }), YEAR), []);
});

test('a piece without a colophon, or with a second thematic break, fails', () => {
  const noColophon = piece({}, '# A poem\n\nLine one.\n');
  assert.match(checkPiece('p.md', noColophon, YEAR).join('\n'), /0 thematic breaks/);
  const empty = piece({}, '# A poem\n\nLine one.\n\n---\n');
  assert.match(checkPiece('p.md', empty, YEAR).join('\n'), /nothing after its thematic break/);
  const two = piece({}, '# A poem\n\nOne.\n\n---\n\nTwo.\n\n---\n\nColophon.\n');
  assert.match(checkPiece('p.md', two, YEAR).join('\n'), /2 thematic breaks/);
});

test('a thematic-break look-alike inside a code fence is not a break', () => {
  const code = piece({ form: 'code' }, '# Code\n\n```sh\n---\n```\n\n---\n\nColophon.\n');
  assert.deepEqual(checkPiece('p.md', code, YEAR), []);
});

test('bilingual sections must match the declared languages', () => {
  const body = '# T\n\n## Deutsch\n\nEins.\n\n---\n\nC.\n';
  assert.match(checkPiece('p.md', piece({ languages: '[de, en]' }, body), YEAR).join('\n'), /declares 2 languages but has 1/);
  assert.match(checkPiece('p.md', piece({}, body), YEAR).join('\n'), /single-language piece has no/);
});

test('trailing-space hard breaks, images and raw HTML are refused', () => {
  assert.match(checkPiece('p.md', piece({}, '# T\n\nLine  \nnext.\n\n---\n\nC.\n'), YEAR).join('\n'), /trailing spaces/);
  assert.match(checkPiece('p.md', piece({}, '# T\n\n![x](https://x.example/a.png)\n\n---\n\nC.\n'), YEAR).join('\n'), /image or raw HTML/);
  assert.match(checkPiece('p.md', piece({}, '# T\n\n<img src=x>\n\n---\n\nC.\n'), YEAR).join('\n'), /image or raw HTML/);
});

test('front matter must be the simple shape the check can read', () => {
  assert.match(parseFrontMatter('# no front matter\n').error, /no YAML front matter/);
  assert.match(parseFrontMatter('---\nnested:\n  - a\n---\n').error, /not `key: value`/);
  assert.deepEqual(parseFrontMatter('---\nlanguages: [de, en]\nn: 3\n---\nbody').data, { languages: ['de', 'en'], n: 3 });
});

test('the README list and the directory must agree', () => {
  const files = [{ name: 'a.md', text: piece() }];
  assert.match(checkCorpus({ files, readme: 'nothing listed', year: YEAR }).join('\n'), /a\.md: not listed/);
  assert.match(checkCorpus({ files, readme: '[A](pieces/a.md) [B](pieces/b.md)', year: YEAR }).join('\n'), /lists pieces\/b\.md, which does not exist/);
  assert.deepEqual(checkCorpus({ files, readme: '[A](pieces/a.md)', year: YEAR }), []);
});

test('a translation notice in the text is refused; it belongs in INFO.md', () => {
  const body = '# A poem\n\nLine one.\n\n---\n\nA Poet, *Poems* (London, 1890).\n\nTranslated for Marxy and released with it under the MIT licence.\n';
  assert.match(checkPiece('p.md', piece({}, body), YEAR).join('\n'), /translation notice in the text/);
});

test('INFO.md states the licence and that front matter is not shown', () => {
  assert.match(checkInfo('nothing here').join('\n'), /MIT licence/);
  assert.match(checkInfo('released under the MIT licence').join('\n'), /front matter is not shown/);
  assert.deepEqual(checkInfo('released under the MIT licence. The page does not show it.'), []);
});

test('the shipped corpus passes as of this year', () => {
  const corpus = loadCorpus();
  assert.ok(corpus.files.length >= 30, `only ${corpus.files.length} pieces`);
  assert.deepEqual(checkInfo(corpus.info), []);
  assert.deepEqual(checkCorpus({ ...corpus, year: new Date().getUTCFullYear() }), []);
});
