// F-60: a parse handed to a transform or to Copy as is a cache and nothing more. With a parse of exactly the text, with
// one a character off, or with one of some other text, the bytes out are the bytes out without it; and with the
// matching parse the body does not parse again (the counter), which is the whole point of handing it in.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document } from '../contracts/ast.ts';
import { parseCount, parseMarkdown } from '../parse/parse.ts';
import { reparseMarkdown } from '../parse/reparse.ts';
import { DEFAULT_SEED, generateCases } from '../parse/testing/generate.ts';
import { generated, generatedHostile, random } from '../parse/testing/structured.ts';
import { COPY_TARGETS, copyAsFromText } from '../operations/copy-as.ts';
import { corpusDocuments } from '../operations/testing/corpus.ts';
import { assertParsedIsOnlyACache, heldParses, oneCharOff } from '../operations/testing/test-kit.ts';
import { TRANSFORMS, runTransform } from './registry.ts';
import { resetProseCaches } from './prose.ts';
import type { ParsedText } from './types.ts';

const enc = new TextEncoder();
const FILE = '/held/doc.md';
const BOM = '﻿';
const lfOf = (s: string): string => s.replace(/\r\n|\r/g, '\n');

interface Tally {
  documents: number;
  copyDocuments: number;
  transformRuns: number;
  copyRuns: number;
}
const total: Tally = { documents: 0, copyDocuments: 0, transformRuns: 0, copyRuns: 0 };

/** Every transform and every Copy as target on `text`, with and without each of the parses held for it. */
function differential(label: string, text: string, held?: Document, copy = true, withOther = true): void {
  const parses = heldParses(text, held, withOther);
  total.documents++;
  for (const t of TRANSFORMS) total.transformRuns += assertParsedIsOnlyACache(`${t.id} on ${label}`, (parsed) => t.fn(text, parsed ? { parsed } : {}), parses);
  if (!copy) return;
  total.copyDocuments++;
  for (const target of COPY_TARGETS) {
    const built = (parsed?: ParsedText): string => {
      const out = target.build(copyAsFromText(text, { path: '/notes/doc.md', ...(parsed ? { parsed } : {}) }));
      return JSON.stringify([out.text, out.html ?? null]);
    };
    total.copyRuns += assertParsedIsOnlyACache(`copy as ${target.id} on ${label}`, built, parses);
  }
}

/** `text` with a paragraph added after its first blank line, and the parse of that made by `reparseMarkdown`. */
function edited(text: string): { text: string; doc: Document } {
  const at = text.indexOf('\n\n');
  const cut = at < 0 ? text.length : at + 2;
  const next = `${text.slice(0, cut)}A paragraph added by an *edit*, with a [link](/x).\n\n${text.slice(cut)}`;
  const before = enc.encode(text);
  const after = enc.encode(next);
  return { text: next, doc: reparseMarkdown(parseMarkdown(before, { file: FILE }), before, after, { file: FILE }) };
}

test('over the corpus, as given, LF-normalised and edited: every transform and Copy as target is byte for byte the same with a parse', () => {
  const before = { ...total };
  let files = 0;
  for (const { file, bytes } of corpusDocuments()) {
    files++;
    const given = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    // The corpus files are large and each run is dear, so these leave out the third parse (the generated documents have it).
    differential(`${file} as given`, given, parseMarkdown(bytes, { file: FILE }), true, false);
    const lf = lfOf(given.startsWith(BOM) ? given.slice(1) : given);
    if (lf !== given) differential(`${file} LF`, lf, undefined, true, false);
    const e = edited(lf);
    differential(`${file} edited`, e.text, e.doc, true, false);
  }
  assert.ok(files >= 25, `${files} corpus files`);
  console.log(`# differential, corpus: ${files} files (as given, LF when that differs, edited), ${total.transformRuns - before.transformRuns} transform runs, ${total.copyRuns - before.copyRuns} Copy as runs`);
});

test('over generated documents: every transform and Copy as target is byte for byte the same with a parse', () => {
  const before = { ...total };
  // Every transform on every document; Copy as (dearer: it renders HTML) on every third.
  let n = 0;
  const copyThird = (): boolean => n++ % 3 === 0;
  for (const c of generateCases(DEFAULT_SEED, 2000)) differential(`generated case seed=${c.seed} index=${c.index}`, c.input, undefined, copyThird());
  for (let seed = 1; seed <= 300; seed++) differential(`structured seed=${seed}`, generated(random(seed)), undefined, copyThird());
  for (let seed = 1; seed <= 200; seed++) differential(`hostile seed=${seed}`, generatedHostile(random(seed)), undefined, copyThird());
  const docs = total.documents - before.documents;
  assert.ok(docs >= 2500);
  console.log(`# differential, generated: ${docs} documents (${total.copyDocuments - before.copyDocuments} also through Copy as), ${total.transformRuns - before.transformRuns} transform runs, ${total.copyRuns - before.copyRuns} Copy as runs`);
});

test('a parse of a text one character off is ignored where using it would change the answer', () => {
  // The parse of `# a` is not the parse of `# b`, and both give a different heading: if the guard were dropped, the
  // transform would read the other document's tree and the output would differ (checked: this test is red then).
  const text = '# alpha\n\n---\n\n## beta\n\n* one\n* two\n';
  const off = oneCharOff(text);
  assert.notEqual(off, text);
  const other = '---\n\n---\n\n---\n\n---\n\n---\n\n';
  for (const t of TRANSFORMS) {
    assert.equal(t.fn(text, { parsed: { text: other, doc: parseMarkdown(enc.encode(other), { file: FILE }) } }), t.fn(text), `${t.id}: used a parse of another text`);
  }
  assert.equal(runTransform('strip-hr', text, { parsed: { text: off, doc: parseMarkdown(enc.encode(off), { file: FILE }) } }), runTransform('strip-hr', text));
  assert.notEqual(runTransform('strip-hr', text), text, 'the sample must have a rule for strip-hr to remove');
});

test('a parse is used only for LF text without a byte-order mark', () => {
  const lf = '# T\n\n---\n\n* a\n* b\n';
  for (const [name, text] of [['CRLF', lf.replace(/\n/g, '\r\n')], ['CR', lf.replace(/\n/g, '\r')], ['BOM', BOM + lf]] as const) {
    const doc = parseMarkdown(enc.encode(text), { file: FILE });
    resetProseCaches();
    const at = parseCount();
    const out = runTransform('strip-hr', text, { parsed: { text, doc } });
    assert.ok(parseCount() > at, `${name}: the body must parse for itself`);
    resetProseCaches();
    assert.equal(out, runTransform('strip-hr', text), name);
    const here = parseCount(); // the title is read when the input is made, so it parses there
    copyAsFromText(text, { parsed: { text, doc } }).plain();
    assert.ok(parseCount() > here, `${name}: Copy as parses for itself`);
  }
});

test('the count: a matching parse is not parsed again by a whole-document clean step or the jira target; without it, it is', () => {
  const text = '# Title\n\nA *word* [1] and `code`.\n\n---\n\n* one\n* two\n\n## Next\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
  const held: ParsedText = { text, doc: parseMarkdown(enc.encode(text), { file: FILE }) };

  for (const id of ['strip-hr', 'normalize-bullets', 'normalize-headings']) {
    resetProseCaches();
    let at = parseCount();
    const withHeld = runTransform(id, text, { parsed: held });
    assert.equal(parseCount(), at, `${id} with a matching parse must not parse`);
    resetProseCaches();
    at = parseCount();
    const without = runTransform(id, text);
    assert.ok(parseCount() > at, `${id} without a parse must parse`);
    assert.equal(withHeld, without, id);
  }

  const jira = COPY_TARGETS.find((t) => t.id === 'jira')!;
  resetProseCaches();
  let at = parseCount();
  const withHeld = jira.build(copyAsFromText(text, { parsed: held })).text;
  assert.equal(parseCount(), at, 'jira with a matching parse must not parse');
  resetProseCaches();
  at = parseCount();
  const without = jira.build(copyAsFromText(text)).text;
  assert.ok(parseCount() > at, 'jira without a parse must parse');
  assert.equal(withHeld, without);

  // Plain and rich text read the parse too; a parse of other text does not stop a parse being made.
  for (const read of ['plain', 'rich'] as const) {
    at = parseCount();
    copyAsFromText(text, { parsed: held })[read]();
    assert.equal(parseCount(), at, `${read} with a matching parse must not parse`);
    copyAsFromText(text)[read]();
    assert.equal(parseCount(), at + 1, `${read} without a parse parses once`);
  }
  resetProseCaches();
  at = parseCount();
  runTransform('strip-hr', text, { parsed: { text: oneCharOff(text), doc: held.doc } });
  assert.ok(parseCount() > at, 'a parse of a text a character off must not be used');
});

test('the parse a body is given does not outlive the call: a later run without it parses and reads its own text', () => {
  const text = '# T\n\n---\n\n* a\n';
  const other = '---\n\n---\n\n---\n';
  const held: ParsedText = { text: other, doc: parseMarkdown(enc.encode(other), { file: FILE }) };
  resetProseCaches();
  // Even a held parse of the very text must be gone afterwards, so nothing later can read a file name from it.
  const mine: ParsedText = { text, doc: parseMarkdown(enc.encode(text), { file: FILE }) };
  runTransform('strip-hr', text, { parsed: mine });
  const at = parseCount();
  runTransform('strip-hr', text);
  assert.ok(parseCount() > at, 'the call without a parse must make its own');
  assert.equal(runTransform('strip-hr', text, { parsed: held }), runTransform('strip-hr', text));
});

test('the guard: a parse whose root does not end at the text\'s UTF-8 length is ignored, whatever its text says (F-60.1)', () => {
  // `text` has multi-byte characters, so its length in UTF-16 units and in bytes differ; the mismatched parse is the
  // parse of a different document carried under this text, as a stale parse mislabelled with the current text would be.
  const text = '# Café 日本語 🙂\n\n---\n\n* one\n* two\n';
  const stale = '# Café\n\n---\n\n* one\n';
  const staleDoc = parseMarkdown(enc.encode(stale), { file: FILE });
  assert.notEqual(staleDoc.src.end, enc.encode(text).length);
  const wrong: ParsedText = { text, doc: staleDoc };
  const right: ParsedText = { text, doc: parseMarkdown(enc.encode(text), { file: FILE }) };
  assert.equal(right.doc.src.end, enc.encode(text).length, 'the root ends at the text\'s byte length');

  for (const t of TRANSFORMS) assert.equal(t.fn(text, { parsed: wrong }), t.fn(text), `${t.id}: used a parse of other bytes`);
  resetProseCaches();
  let at = parseCount();
  const out = runTransform('strip-hr', text, { parsed: wrong });
  assert.ok(parseCount() > at, 'a mismatched parse must be ignored: the body parses afresh');
  assert.notEqual(out, text, 'the sample has a rule to strip');
  resetProseCaches();
  assert.equal(out, runTransform('strip-hr', text));
  // The matching parse is still used.
  resetProseCaches();
  at = parseCount();
  runTransform('strip-hr', text, { parsed: right });
  assert.equal(parseCount(), at, 'the matching parse is used');

  // Copy as: the same guard, for the targets that run a transform and for plain and rich text.
  for (const target of COPY_TARGETS) {
    const built = (parsed: ParsedText): string => JSON.stringify(target.build(copyAsFromText(text, { path: '/notes/doc.md', parsed })));
    assert.equal(built(wrong), built(right), `copy as ${target.id}: used a parse of other bytes`);
  }
  at = parseCount();
  copyAsFromText(text, { parsed: wrong }).plain();
  assert.ok(parseCount() > at, 'Copy as parses afresh for a mismatched parse');
});
