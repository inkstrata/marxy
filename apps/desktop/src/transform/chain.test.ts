// The transform chain and Apply's store write (W-21). Pure: no DOM. The sheet and the commands are in
// test/transform-sheet.test.mjs; the data-safety walk drives `applyToStore` too (test/support/store-walk.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRANSFORMS, runTransform } from '@marxy/core';
import { openDocumentStore } from '../document/store.ts';
import { addStep, applyToStore, canApply, characterCount, createChain, eolOf, lastKind, openedOf, output, outputs, replacesExactly, runStep, withoutBom } from './chain.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const store = (text: string | Uint8Array, path = '/t/doc.md') =>
  openDocumentStore({ writeFileAtomic: async () => {} }, path, typeof text === 'string' ? enc.encode(text) : text);
const textOfStore = (s: ReturnType<typeof store>): string => dec.decode(s.snapshot().buffer.bytes);

const kindOf = (kind: string): string => TRANSFORMS.find((t) => t.kind === kind)!.id;

test('the same input and the same steps give the same output, step by step, and an empty chain is its input', () => {
  const input = 'b\nc\na\nb\n';
  assert.equal(output(createChain(input)), input);
  assert.deepEqual(outputs(createChain(input)), []);
  const one = addStep(createChain(input), 'sort');
  assert.equal(output(one), runTransform('sort', input));
  assert.equal(output(one), output(createChain(input, ['sort'])));
  const two = addStep(one, 'dedupe');
  assert.deepEqual(outputs(two), [runTransform('sort', input), runTransform('dedupe', runTransform('sort', input))]);
  assert.equal(output(two), outputs(two).at(-1));
  assert.equal(two.input, input, 'the input never changes');
  assert.deepEqual(one.steps, ['sort'], 'adding a step makes a new chain and leaves the old one');
});

test('a step the registry does not have adds nothing, and a not-yet id is not a step', () => {
  const chain = createChain('x\n', ['sort']);
  assert.equal(addStep(chain, 'no-such-transform'), chain);
  assert.deepEqual(createChain('x', ['no-such-transform', 'sort', 'nope']).steps, ['sort']);
});

test('Apply is for chains of edit steps only: a derive or literal step anywhere takes it away', () => {
  const edit = TRANSFORMS.find((t) => t.kind === 'edit')!.id;
  assert.equal(canApply(createChain('a')), false, 'no steps, nothing to apply');
  assert.equal(canApply(createChain('a', [edit])), true);
  for (const id of ['x-links', 'json-string', kindOf('derive')]) {
    assert.equal(canApply(createChain('a', [id])), false, id);
    assert.equal(canApply(createChain('a', [edit, id])), false, `${id} after an edit`);
    assert.equal(canApply(createChain('a', [id, edit])), false, `${id} before an edit`);
  }
  assert.equal(lastKind(createChain('a', [edit, 'x-links'])), 'derive');
  assert.equal(lastKind(createChain('a', ['json-string'])), 'literal');
  assert.equal(lastKind(createChain('a')), null);
});

test('characters are code points, a byte-order mark is not one', () => {
  assert.equal(characterCount(''), 0);
  assert.equal(characterCount('abc'), 3);
  assert.equal(characterCount('é漢😀'), 3);
  assert.equal(characterCount('﻿abc'), 3);
  assert.equal(characterCount('😀😀'), 2);
  assert.equal(withoutBom('﻿a'), 'a');
  assert.equal(withoutBom('a﻿'), 'a﻿');
});

test('Apply: one splice over the range, every other byte as it was, one undo gives the exact bytes back', async () => {
  const original = 'intro line\n\nc\nb\na\n\nafter\n';
  const s = store(original);
  const start = original.indexOf('c\n');
  const end = original.indexOf('\n\nafter') + 1;
  const text = original.slice(start, end);
  const out = runTransform('sort', text);
  assert.notEqual(out, text);
  const outcome = await applyToStore(s, openedOf(s), { start, end }, out, 'transform: Sort');
  assert.equal(outcome, 'applied');
  assert.equal(textOfStore(s), original.slice(0, start) + out + original.slice(end));
  assert.equal(s.snapshot().dirty, true);
  assert.equal(s.snapshot().canUndo, true);
  assert.equal(await s.undo(), true);
  assert.equal(textOfStore(s), original, 'one undo restores the original');
  assert.equal(s.snapshot().canUndo, false, 'it was one history entry');
  assert.equal(s.snapshot().dirty, false);
});

test('Apply keeps CRLF and the byte-order mark, and a document with mixed endings keeps each line its own', async () => {
  for (const original of ['﻿c\r\nb\r\na\r\n', '﻿c\r\nb\na\r\nz\n', 'tail\r\n﻿no mark\r\nb\r\na\r\n']) {
    const s = store(original);
    const bytes = s.snapshot().buffer.bytes.slice();
    const text = dec.decode(bytes);
    const out = runTransform('sort', text);
    assert.equal(await applyToStore(s, openedOf(s), { start: 0, end: bytes.length }, out, 'transform: Sort'), 'applied');
    const after = s.snapshot().buffer.bytes;
    if (original.startsWith('﻿')) assert.deepEqual([...after.slice(0, 3)], [0xef, 0xbb, 0xbf], 'the mark is still first');
    const kinds = (b: Uint8Array): Set<string> => new Set(dec.decode(b).match(/\r\n|\n/g) ?? []);
    for (const kind of kinds(after)) assert.ok(kinds(bytes).has(kind), `no ${JSON.stringify(kind)} the file did not have`);
    assert.equal(await s.undo(), true);
    assert.deepEqual([...s.snapshot().buffer.bytes], [...bytes], 'one undo, the same bytes');
  }
});

test('Apply is refused, and nothing is touched, once the document changed since the sheet read it', async () => {
  const original = 'c\nb\na\n';
  const s = store(original);
  const opened = openedOf(s);
  assert.equal(await s.apply({ range: { file: '/t/doc.md', start: 0, end: 0 }, replacement: 'x', label: 'edit' }), true);
  const edited = textOfStore(s);
  const version = s.snapshot().version;
  assert.equal(await applyToStore(s, opened, { start: 0, end: original.length }, 'a\nb\nc\n', 'transform'), 'stale');
  assert.equal(textOfStore(s), edited, 'the bytes are as the edit left them');
  assert.equal(s.snapshot().version, version, 'no transition happened');
  // An undo is a change too: the range was read before it.
  const reopened = openedOf(s);
  assert.equal(await s.undo(), true);
  assert.equal(await applyToStore(s, reopened, { start: 0, end: 3 }, 'z', 'transform'), 'stale');
  assert.equal(textOfStore(s), original);
});

test('a change queued behind the check cannot slip through: the store refuses the stale base itself', async () => {
  const original = 'c\nb\na\n';
  const s = store(original);
  const opened = openedOf(s);
  // The edit is on the store's queue before Apply asks; Apply's own check passes (the snapshot is still old).
  const pending = s.apply({ range: { file: '/t/doc.md', start: 0, end: 1 }, replacement: 'zz', label: 'edit' });
  const outcome = await applyToStore(s, opened, { start: 0, end: original.length }, 'a\nb\nc\n', 'transform');
  assert.equal(await pending, true);
  assert.equal(outcome, 'stale');
  assert.equal(textOfStore(s), 'zz\nb\na\n');
});

test('a save in between does not make Apply stale (the bytes are the same); nothing is written by Apply itself', async () => {
  let writes = 0;
  const s = openDocumentStore({ writeFileAtomic: async () => void (writes += 1) }, '/t/doc.md', enc.encode('c\nb\na\n'));
  const opened = openedOf(s);
  assert.equal(await applyToStore(s, opened, { start: 0, end: 6 }, 'a\nb\nc\n', 'transform'), 'applied');
  assert.equal(writes, 0, 'the reader saves; Apply does not');
});

test('a result equal to the text is unchanged, not applied', async () => {
  const s = store('a\nb\n');
  assert.equal(await applyToStore(s, openedOf(s), { start: 0, end: 4 }, 'a\nb\n', 'transform'), 'unchanged');
  assert.equal(s.snapshot().canUndo, false);
});

test('a range that cuts a code point is refused by the store, untouched', async () => {
  const s = store('é\n');
  await assert.rejects(applyToStore(s, openedOf(s), { start: 1, end: 3 }, 'x', 'transform'));
  assert.equal(textOfStore(s), 'é\n');
});

test('a CRLF or CR document gets CRLF or CR from a transform that adds lines to text with no line break in it', () => {
  // `fence` on one line writes LF (the input has no ending to follow): in a CRLF file that would be the only bare LF.
  const lf = output(createChain('one line', ['fence']));
  assert.match(lf, /\n/);
  assert.doesNotMatch(lf, /\r/);
  const crlf = output(createChain('one line', ['fence'], eolOf('crlf')));
  assert.ok(!/(?<!\r)\n/.test(crlf), JSON.stringify(crlf));
  assert.equal(crlf, lf.replace(/\n/g, '\r\n'));
  const cr = output(createChain('one line', ['fence'], eolOf('cr')));
  assert.ok(!cr.includes('\n') && cr.includes('\r'));
  // Already settled text is unchanged, mixed and LF files are left to the registry, and a literal result is quoted exactly.
  assert.equal(output(createChain('b\r\na\r\n', ['sort'], eolOf('crlf'))), runTransform('sort', 'b\r\na\r\n'));
  assert.equal(eolOf('mixed'), null);
  assert.equal(eolOf('lf'), null);
  assert.equal(eolOf('none'), null);
  assert.equal(output(createChain('a\r\nb', ['json-string'], eolOf('crlf'))), runTransform('json-string', 'a\r\nb'));
  assert.equal(createChain('x', ['sort'], eolOf('crlf')).eol, '\r\n');
  assert.equal(addStep(createChain('x', ['sort'], eolOf('crlf')), 'dedupe').eol, '\r\n', 'a step keeps the ending');
});

test('replacesExactly: text that is the bytes decoded may replace them; a byte that is not UTF-8 may not', () => {
  assert.equal(replacesExactly('héllo\n', enc.encode('héllo\n')), true);
  assert.equal(replacesExactly('', new Uint8Array()), true);
  const stray = new Uint8Array([0x61, 0xff, 0x62]);
  assert.equal(replacesExactly(new TextDecoder().decode(stray), stray), false, 'it decoded to U+FFFD');
  assert.equal(replacesExactly('\uFEFFa', new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), true, 'a mark kept as text is the same bytes');
});

test('a chain grown a step at a time (each step run once, on the step before) gives the text the whole chain gives', () => {
  const input = 'b\r\nc\r\na\r\nb\r\n';
  for (const eol of [null, eolOf('crlf')]) {
    const ids = ['sort', 'dedupe', 'upper', 'fence'];
    let text = input;
    for (const id of ids) text = runStep(id, text, eol);
    assert.equal(text, output(createChain(input, ids, eol)));
    const each = ids.map((_, n) => output(createChain(input, ids.slice(0, n + 1), eol)));
    let grown = input;
    ids.forEach((id, n) => {
      grown = runStep(id, grown, eol);
      assert.equal(grown, each[n], `after step ${n + 1}`);
    });
  }
});

// Source holds a byte that is not UTF-8 as a lone U+DC80..U+DCFF (F-34.1), and Apply writes the transform's text back as
// bytes. A transform that dropped or rewrote such a code unit would change a byte nobody asked to change, silently.
test('every edit transform keeps each stray-byte code unit of its input (Source text), and a derive result never holds one', () => {
  const strays = ['\udcff', '\udcfe', '\udcfd', '\udcfc', '\udcfb'];
  const input = '# Intro\n\nline \udcff end\nsecond line\n\n- item \udcfe\n- other\n\n| a | b |\n|---|---|\n| \udcfd | 2 |\n\n> quote \udcfc\n\n    code \udcfb\n';
  const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  assert.ok(lone.test(input));
  for (const t of TRANSFORMS) {
    const out = runTransform(t.id, input);
    if (t.kind === 'edit') {
      for (const c of strays) assert.ok(out.includes(c), `${t.id} lost the stray byte ${c.charCodeAt(0).toString(16)}`);
    } else if (t.id !== 'json-string') {
      assert.ok(!lone.test(out), `${t.id} made a lone surrogate`);
    }
  }
  // Why a result that is new text is made from the readable input: a literal quote of a lone surrogate spells it out.
  assert.equal(runTransform('json-string', 'a\udcffb'), '"a\\udcffb"');
});
