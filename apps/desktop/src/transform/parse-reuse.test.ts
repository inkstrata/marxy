// F-60.1: the Transform sheet and Copy as run on the open document's own parse, so there is one parse per buffer
// version (`parseCount()`), and never on a parse of other bytes (commitment 3). Node, no DOM: the sheet and the copy
// commands do exactly what is done here, which is to take `store.textParse()` and hand it to `output`/`runStep` and
// to `copyAsFromText`; test/transform-sheet.test.mjs and test/copy-as.test.mjs run the same through the real app.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY_TARGETS, copyAsFromText, parseCount, parseMarkdown, runTransform, type ParsedText } from '@marxy/core';
import { resetProseCaches } from '@marxy/core/src/transforms/prose.ts';
import { openDocumentStore } from '../document/store.ts';
import { addStep, createChain, output, runStep } from './chain.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const PATH = '/t/doc.md';
const store = (bytes: string | Uint8Array, opts?: { lazy?: boolean }) =>
  openDocumentStore({ writeFileAtomic: async () => {} }, PATH, typeof bytes === 'string' ? enc.encode(bytes) : bytes, undefined, opts);
const textOf = (s: ReturnType<typeof store>): string => dec.decode(s.snapshot().buffer.bytes);

const BLOCK = '## Café 日本語 🙂\n\nA *word*, a [link](/x) and `code` with ünïcödé.\n\n---\n\n* one\n* two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n';
/** About `size` bytes of LF markdown with multi-byte characters, thematic breaks and a list in every block. */
const bigDocument = (size = 1_000_000): string => '# Title 日本\n\n' + BLOCK.repeat(Math.ceil(size / enc.encode(BLOCK).length));

/** The sheet's two steps (the first reads the parse, the second is a line transform that parses nothing). */
const FIRST = 'strip-hr';
const SECOND = 'sort';

/** What the sheet does on the whole document: the first step, then a second one on the first's result. Returns both texts. */
function sheetOn(text: string, parsed: ParsedText | null): { first: string; second: string } {
  const chain = addStep(createChain(text, [], null), FIRST);
  const first = output(chain, parsed);
  const second = runStep(SECOND, first, null, parsed);
  return { first, second };
}

/** What Copy as does from Source with nothing selected: every target the text allows, on the store's parse. */
function copyAs(text: string, parsed: ParsedText | null): string[] {
  return COPY_TARGETS.filter((t) => t.id === 'jira' || t.id === 'plain' || t.id === 'json-string').map((t) => {
    const out = t.build(copyAsFromText(text, { path: PATH, ...(parsed ? { parsed } : {}) }));
    return JSON.stringify([t.id, out.text, out.html ?? null]);
  });
}

/** The outputs of `sheetOn` and `copyAs` made from scratch: no parse handed in, no cached parse to find. */
function fromScratch(text: string): { first: string; second: string; copies: string[] } {
  resetProseCaches();
  const sheet = sheetOn(text, null);
  resetProseCaches();
  return { ...sheet, copies: copyAs(text, null) };
}

test('one parse per buffer version: the sheet on the whole document, a second step, then Copy as Jira and Plain text cost no parse beyond the store\'s own', () => {
  const text = bigDocument();
  assert.ok(enc.encode(text).length >= 1_000_000);
  const c0 = parseCount();
  const s = store(text);
  assert.equal(parseCount() - c0, 1, 'opening the document makes the store\'s one parse');

  resetProseCaches();
  const parsed = s.textParse();
  assert.ok(parsed, 'the LF UTF-8 document has a parse to hand over');
  assert.equal(parsed.text, text);
  assert.equal(parsed.doc, s.snapshot().ast, 'it is the store\'s own parse, not another');
  assert.equal(s.textParse(), parsed, 'one pair per buffer version: asking again returns it');

  const c1 = parseCount();
  const sheet = sheetOn(text, parsed);
  const copies = copyAs(text, s.textParse());
  assert.equal(parseCount(), c1, 'the sheet, the second step and both copies parsed nothing more');

  const scratch = fromScratch(text);
  assert.ok(parseCount() > c1, 'the same work without the store\'s parse does parse (so the count above shows something)');
  assert.deepEqual({ ...sheet, copies }, scratch, 'and the bytes out are the bytes a from-scratch parse gives');
  assert.notEqual(sheet.first, text, 'the sample has rules to strip');
});

test('after an edit the next operation reads a fresh parse of the new bytes, and its output is byte for byte a from-scratch parse\'s', async () => {
  const text = bigDocument(200_000);
  const s = store(text);
  const before = s.textParse()!;
  assert.ok(before);

  // An edit with multi-byte text, at the top: every offset after it moves by a count of bytes that is not a count of characters.
  const edit = 'Añadido 日本語 🙂, an edit.\n\n---\n\n';
  assert.equal(await s.apply({ range: { file: PATH, start: 0, end: 0 }, replacement: edit, label: 'edit' }), true);
  const c0 = parseCount();
  const now = s.textParse()!;
  assert.ok(now);
  assert.notEqual(now, before, 'the pair of the old version is not handed out again');
  assert.equal(now.text, textOf(s));
  assert.equal(now.text, edit + text);
  assert.equal(now.doc, s.snapshot().ast, 'the parse is the store\'s current one');
  assert.notEqual(now.doc, before.doc);

  const sheet = sheetOn(now.text, now);
  const copies = copyAs(now.text, s.textParse());
  assert.equal(parseCount(), c0, 'after the edit\'s own reparse the sheet and the copies parse nothing more');
  assert.deepEqual({ ...sheet, copies }, fromScratch(now.text), 'byte for byte what a from-scratch parse gives');

  // A target opened before the edit holds the old pair, whose text is not what a step on the new text reads: it parses.
  resetProseCaches();
  const c1 = parseCount();
  const stale = runStep(FIRST, now.text, null, before);
  assert.ok(parseCount() > c1, 'a stale pair is not used');
  assert.equal(stale, runTransform(FIRST, now.text), 'and the output is the new text\'s');
  assert.ok(stale.includes('Añadido 日本語 🙂'), 'the edit is in it');
  assert.equal(parsedDocEnd(now), enc.encode(now.text).length, 'the pair\'s root ends at the new text\'s byte length');

  // Undo goes back to the earlier bytes: the pair is that version's again, made afresh, and equal to a parse of them.
  assert.equal(await s.undo(), true);
  const undone = s.textParse()!;
  assert.equal(undone.text, text);
  const scratch = fromScratch(text);
  assert.deepEqual(sheetOn(undone.text, undone), { first: scratch.first, second: scratch.second });
});

const parsedDocEnd = (p: ParsedText): number => p.doc.src.end;

test('a CRLF file, a file with a byte-order mark, a file that is not UTF-8 and a lazy store hand over nothing, and the output is a from-scratch parse\'s', () => {
  const lf = '# T 日本\n\n---\n\n* b\n* a\n';
  const cases: [string, Uint8Array][] = [
    ['CRLF', enc.encode(lf.replace(/\n/g, '\r\n'))],
    ['CR', enc.encode(lf.replace(/\n/g, '\r'))],
    ['BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode(lf)])],
    ['not UTF-8', new Uint8Array([...enc.encode(lf), 0xff, 0x0a])],
  ];
  for (const [name, bytes] of cases) {
    const s = store(bytes);
    assert.equal(s.textParse(), null, `${name}: no parse is handed over`);
    const text = dec.decode(bytes);
    resetProseCaches();
    const at = parseCount();
    // What the commands do: no pair, so the steps parse for themselves, as on main.
    const out = runStep(FIRST, text, null, s.textParse());
    assert.ok(parseCount() > at, `${name}: the step parses for itself`);
    resetProseCaches();
    assert.equal(out, runTransform(FIRST, text), name);
  }

  const lazy = store(lf, { lazy: true });
  const at = parseCount();
  assert.equal(lazy.textParse(), null, 'a store that has not parsed hands over nothing');
  assert.equal(lazy.parsed(), false, 'and asking did not make its parse');
  assert.equal(parseCount(), at);
  void lazy.snapshot().ast;
  assert.ok(lazy.textParse(), 'once the parse exists it is handed over');
});

test('the pair is the standard parse: what the store hands over is what parseMarkdown(bytes) gives', () => {
  const text = bigDocument(50_000);
  const s = store(text);
  const pair = s.textParse()!;
  const standard = parseMarkdown(enc.encode(text), { file: PATH });
  assert.deepEqual(pair.doc, standard);
});

test('a code file hands over nothing: its AST is code blocks, not a Markdown parse of the text (V-10), and a rename follows the kind', async () => {
  const text = '# not a heading\n\n---\n\n* a\n* b\n';
  const code = openDocumentStore({ writeFileAtomic: async () => {} }, '/t/script.py', enc.encode(text));
  assert.equal(code.textParse(), null, 'a code file is not read as Markdown');
  resetProseCaches();
  const at = parseCount();
  assert.equal(runStep(FIRST, text, null, code.textParse()), runTransform(FIRST, text));
  assert.ok(parseCount() > at, 'the step parses the text as Markdown for itself');

  const s = store(text);
  const markdown = s.textParse();
  assert.ok(markdown);
  await s.rename('/t/script.py');
  assert.equal(s.textParse(), null, 'renamed to a code file, the same bytes hand over nothing');
  await s.rename('/t/doc.md');
  const again = s.textParse();
  assert.ok(again && again.doc === s.snapshot().ast && again.doc !== markdown.doc, 'renamed back, the pair is of the current parse');
});
