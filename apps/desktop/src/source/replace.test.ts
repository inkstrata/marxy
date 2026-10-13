// Find and replace in Source (V-03): the change set Replace all makes and the rows its preview shows (`replace.ts`), and
// the one transaction Apply makes over a real CodeMirror state with no DOM (`replace-sheet.ts` `applyReplacePlan`). The
// file's bytes go in through `cmDocText` and `lineSeparatorFor` and come out through `leaveSourceMode`, the Source fold
// the app uses, so what is checked is what would be saved.
//
// The differential tests hold the promise byte for byte: over many seeded random texts, queries and replacements,
// Replace all through the app gives exactly what JavaScript's own `String.prototype.replace` gives over the same text,
// in every line ending, with and without a byte-order mark.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { history, undo, undoDepth } from '@codemirror/commands';
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import { createBuffer } from '@marxy/core';
import { cmDocText, leaveSourceMode, lineSeparatorFor } from './buffer-commit.ts';
import { applyReplacePlan, planFor, replaceNext } from './replace-sheet.ts';
import {
  applyPlan,
  countLine,
  expandReplacement,
  nextMatch,
  planReplace,
  PREVIEW_MAX_CHANGES,
  PREVIEW_SHOWN,
  previewRows,
  shownChanges,
  type ReplacePlan,
  type ReplaceQuery,
} from './replace.ts';

const encoder = new TextEncoder();
const SEP = { lf: '\n', crlf: '\r\n', cr: '\r' } as const;
type Eol = keyof typeof SEP;
const BOM = '﻿';

function plan(text: string, query: ReplaceQuery, lineBreak = '\n'): ReplacePlan {
  const p = planReplace(text, query, lineBreak);
  assert.ok(!('error' in p), 'error' in p ? p.error : '');
  return p;
}

/** One editor over `bytes`, as Source holds it: the file's separator, a history. */
function editor(bytes: Uint8Array, path = '/t/a.md') {
  const buffer = createBuffer(path, bytes);
  let state = EditorState.create({
    doc: cmDocText(buffer),
    extensions: [history(), EditorState.lineSeparator.of(lineSeparatorFor(buffer))],
  });
  const target = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction | TransactionSpec) {
      state = tr instanceof Transaction ? tr.state : state.update(tr).state;
    },
  };
  const out = (): Uint8Array => {
    const fold = leaveSourceMode(buffer, state.sliceDoc(0, state.doc.length));
    return fold.changed ? fold.buffer.bytes : bytes;
  };
  return { target, out, get state() { return state; } };
}

/** Sets the find panel's query on `state`, as the panel's commit does. */
async function withQuery(t: ReturnType<typeof editor>['target'], query: ReplaceQuery): Promise<void> {
  const { SearchQuery, setSearchQuery, search } = await import('@codemirror/search');
  t.dispatch({ effects: (await import('@codemirror/state')).StateEffect.appendConfig.of(search()) });
  t.dispatch({ effects: setSearchQuery.of(new SearchQuery(query)) });
}

/** Replace all through the app: the plan the preview shows, then Apply, then the Source fold. */
async function replaceAllBytes(bytes: Uint8Array, query: ReplaceQuery, spanAbove?: number): Promise<{ bytes: Uint8Array; plan: ReplacePlan; undone: () => Uint8Array; steps: number }> {
  const ed = editor(bytes);
  await withQuery(ed.target, query);
  const p = planFor(ed.target.state);
  assert.ok(!('error' in p), 'error' in p ? p.error : '');
  const doc = ed.target.state.doc;
  const outcome = applyReplacePlan(ed.target, doc, p, spanAbove);
  assert.equal(outcome, p.changes.length === 0 ? 'unchanged' : 'applied');
  const after = ed.out();
  const steps = undoDepth(ed.target.state);
  return {
    bytes: after,
    plan: p,
    steps,
    undone() {
      undo(ed.target as never);
      return ed.out();
    },
  };
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

// ---- the card's four ------------------------------------------------------------------------------------------------

test('the change set for a regular expression with $1 is the expected splices', () => {
  const text = 'let a = f(x);\nlet b = f(yy);\n';
  const p = plan(text, { search: 'f\\((\\w+)\\)', replace: 'g($1, $1)', regexp: true, caseSensitive: true });
  assert.deepEqual(
    p.changes.map((c) => [c.from, c.to, c.insert]),
    [
      [8, 12, 'g(x, x)'],
      [22, 27, 'g(yy, yy)'],
    ],
  );
  assert.equal(p.matches, 2);
  assert.equal(p.lines, 2);
  assert.equal(applyPlan(text, p), 'let a = g(x, x);\nlet b = g(yy, yy);\n');
});

test('applying it to a CRLF text keeps CRLF, a line break put in included, and the byte-order mark', async () => {
  const lf = 'one two\nthree two\n';
  const bytes = encoder.encode(BOM + lf.replace(/\n/g, '\r\n'));
  const run = await replaceAllBytes(bytes, { search: 'two', replace: '2\\nlines' });
  const want = encoder.encode(BOM + 'one 2\r\nlines\r\nthree 2\r\nlines\r\n');
  assert.equal(hex(run.bytes), hex(want));
  assert.equal(run.steps, 1, 'one undo step');
  assert.equal(hex(run.undone()), hex(bytes), 'one undo restores the exact bytes');
});

test('zero matches give an empty change set', () => {
  const p = plan('alpha beta\n', { search: 'gamma', replace: 'x' });
  assert.deepEqual(p.changes, []);
  assert.equal(p.matches, 0);
});

test('a replacement producing the same text is not counted, and the count says so', () => {
  const p = plan('Cat cat CAT\n', { search: 'cat', replace: 'cat' });
  assert.equal(p.matches, 3, 'three matches (case ignored)');
  assert.deepEqual(p.changes.map((c) => c.from), [0, 8], 'only the two that change');
  assert.equal(countLine(p), '2 replacements on 1 line');
  const same = plan('abc\n', { search: '(b)', replace: '$1', regexp: true });
  assert.equal(same.changes.length, 0);
  assert.equal(same.matches, 1);
});

// ---- the edges a rewrite must survive -------------------------------------------------------------------------------

test('empty matches (^, $, \\b, x*) replace once per place and never loop', () => {
  const text = 'ab\ncd\n\nef';
  assert.equal(applyPlan(text, plan(text, { search: '^', replace: '> ', regexp: true })), text.replace(/^/gmu, '> '));
  assert.equal(applyPlan(text, plan(text, { search: '$', replace: ';', regexp: true })), text.replace(/$/gmu, ';'));
  assert.equal(applyPlan(text, plan(text, { search: '\\b', replace: '|', regexp: true })), text.replace(/\b/gmu, '|'));
  assert.equal(applyPlan(text, plan(text, { search: 'x*', replace: '-', regexp: true })), text.replace(/x*/gmu, '-'));
  assert.equal(applyPlan('aab', plan('aab', { search: 'a*', replace: 'X', regexp: true })), 'XXbX', 'a match then an empty one where it ends: both, as JavaScript does');
  // Over a surrogate pair an empty match steps the whole character, so the pair is never split.
  const emoji = 'a😀b';
  assert.ok('error' in planReplace(emoji, { search: '', replace: 'x' }), 'an empty query finds nothing');
  assert.equal(applyPlan(emoji, plan(emoji, { search: '(?:)', replace: '.', regexp: true })), emoji.replace(/(?:)/gmu, '.'));
});

test('matches that would overlap are taken left to right, and matches that touch are each replaced', () => {
  assert.equal(applyPlan('aaaaa', plan('aaaaa', { search: 'aa', replace: 'b' })), 'bba');
  assert.equal(applyPlan('abab', plan('abab', { search: 'ab', replace: 'X' })), 'XX');
  assert.equal(plan('abab', { search: 'ab', replace: 'X' }).lines, 1);
});

test('a replacement that contains the query is made once, not again over its own result', () => {
  const text = 'a a\na';
  const p = plan(text, { search: 'a', replace: 'aa' });
  assert.equal(p.changes.length, 3);
  assert.equal(applyPlan(text, p), 'aa aa\naa');
});

test('case, by word and named groups behave as the panel says', () => {
  assert.equal(applyPlan('Cat cat', plan('Cat cat', { search: 'cat', replace: 'dog', caseSensitive: true })), 'Cat dog');
  assert.equal(applyPlan('cat concat cat_x cat', plan('cat concat cat_x cat', { search: 'cat', replace: 'dog', wholeWord: true })), 'dog concat cat_x dog');
  // A match turned down by By word is looked for again one character on, so a match inside it can still be found.
  assert.equal(applyPlan('ba a a', plan('ba a a', { search: 'a a', replace: 'X', wholeWord: true })), 'ba X');
  assert.equal(applyPlan('2026-10-12', plan('2026-10-12', { search: '(?<y>\\d+)-(?<m>\\d+)-(?<d>\\d+)', replace: '$<d>.$<m>.$<y>', regexp: true })), '12.10.2026');
  assert.equal(applyPlan('a.b', plan('a.b', { search: '.', replace: '!' })), 'a!b', 'a plain query is literal');
  assert.equal(applyPlan('a$b', plan('a$b', { search: 'b', replace: '$&$1' })), 'a$$&$1', 'a plain replacement is literal');
  assert.equal(expandReplacement('[$01|$1|$10|$9|$$|$<n>|$', /(a)/u.exec('xa') as RegExpExecArray, 'xa'), '[a|a|a0|$9|$|$<n>|$');
});

test('every ASCII punctuation character is a plain query that finds itself (no escape the u flag refuses)', () => {
  const punct = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
  for (const ch of punct) {
    const text = `x${ch}y ${ch}${ch} well${ch}known\n${ch}`;
    const p = planReplace(text, { search: ch, replace: 'R' });
    assert.ok(!('error' in p), `${ch}: ${'error' in p ? p.error : ''}`);
    assert.equal(applyPlan(text, p), text.split(ch).join('R'), ch);
    const word = planReplace(text, { search: `well${ch}known`, replace: 'W', caseSensitive: true });
    assert.ok(!('error' in word) && applyPlan(text, word) === text.split(`well${ch}known`).join('W'), `well${ch}known`);
  }
  const hyphen = nextMatch('a well-known b', { search: 'well-known', replace: 'famous' }, 0);
  assert.ok(hyphen && !('error' in hyphen) && hyphen.from === 2, 'Replace one at a time finds a hyphenated word');
});

test('a regular expression that does not parse, or an empty query, is a reason and no plan', () => {
  const bad = planReplace('x', { search: '(', replace: '', regexp: true });
  assert.ok('error' in bad && /not valid/.test(bad.error));
  const empty = planReplace('x', { search: '', replace: 'y' });
  assert.ok('error' in empty);
});

test('a match never splits a CRLF that a file of mixed endings holds inside a line', async () => {
  // Mixed: the editor's separator is LF and the CR of each CRLF is a character of its line (F-24).
  const bytes = encoder.encode('a\r\nb\nc\r\n');
  const run = await replaceAllBytes(bytes, { search: '^', replace: '> ', regexp: true });
  assert.equal(new TextDecoder().decode(run.bytes), '> a\r\n> b\n> c\r\n> ', 'every line start, and no "> " between a CR and its LF');
  const dollar = await replaceAllBytes(bytes, { search: '$', replace: ';', regexp: true });
  assert.ok(!/\r;\n/.test(new TextDecoder().decode(dollar.bytes)));
});

test('bytes that are not UTF-8 come back exactly, inside a match and outside it', async () => {
  const bytes = new Uint8Array([...encoder.encode('x'), 0xff, ...encoder.encode(' x\n'), 0xe2, 0x82, ...encoder.encode(' end x\n')]);
  const run = await replaceAllBytes(bytes, { search: 'x(.?)', replace: '[$1]', regexp: true });
  const want = new Uint8Array([...encoder.encode('['), 0xff, ...encoder.encode('] []\n'), 0xe2, 0x82, ...encoder.encode(' end []\n')]);
  assert.equal(hex(run.bytes), hex(want));
  assert.equal(hex(run.undone()), hex(bytes));
});

// ---- the preview's rows -------------------------------------------------------------------------------------------------

test('the rows: one per change, with its line number, before and after; a change across a line ending says so', () => {
  const text = 'keep\nfoo and foo\nkeep\nend foo\nbar';
  const p = plan(text, { search: 'foo', replace: 'baz' });
  const rows = previewRows(text, p);
  assert.deepEqual(rows.map((r) => [r.line, r.lastLine]), [[2, 2], [2, 2], [4, 4]]);
  assert.deepEqual(rows[1]?.before, [
    { kind: 'same', text: 'foo and ' },
    { kind: 'del', text: 'foo' },
  ]);
  assert.deepEqual(rows[1]?.after, [
    { kind: 'same', text: 'foo and ' },
    { kind: 'ins', text: 'baz' },
  ]);
  const join = plan(text, { search: 'foo\\nbar', replace: 'joined', regexp: true });
  const [row] = previewRows(text, join);
  assert.equal(row?.line, 4);
  assert.equal(row?.lastLine, 5);
  assert.equal(row?.spansLineEnding, true);
  assert.equal(join.lines, 2);
  const empty = plan('ab\n', { search: '^', replace: '> ', regexp: true });
  assert.deepEqual(previewRows('ab\n', empty)[0]?.after, [{ kind: 'ins', text: '> ' }, { kind: 'same', text: 'ab' }]);
});

test('past 2,000 changes the preview shows the first 200; the plan keeps every change', () => {
  const text = 'x\n'.repeat(PREVIEW_MAX_CHANGES + 1);
  const p = plan(text, { search: 'x', replace: 'y' });
  assert.equal(p.changes.length, PREVIEW_MAX_CHANGES + 1);
  assert.equal(shownChanges(p.changes.length), PREVIEW_SHOWN);
  assert.equal(previewRows(text, p).length, PREVIEW_SHOWN);
  assert.equal(shownChanges(PREVIEW_MAX_CHANGES), PREVIEW_MAX_CHANGES);
});

test('a long line is shortened in the preview only', () => {
  const text = `${'a'.repeat(500)}NEEDLE${'b'.repeat(500)}`;
  const p = plan(text, { search: 'NEEDLE', replace: 'pin' });
  const [row] = previewRows(text, p);
  const shown = row?.before.map((s) => s.text).join('') ?? '';
  assert.ok(shown.length < 120, `${shown.length} characters shown`);
  assert.equal(applyPlan(text, p), `${'a'.repeat(500)}pin${'b'.repeat(500)}`);
});

// ---- Replace, one at a time ---------------------------------------------------------------------------------------------

test('Replace changes the current match and selects the next, one undo step each, in the file endings', async () => {
  const bytes = encoder.encode('one x\r\ntwo x\r\n');
  const ed = editor(bytes);
  await withQuery(ed.target, { search: 'x', replace: 'y\\nz' });
  assert.equal(replaceNext(ed.target), true, 'first press selects the first match');
  assert.equal(ed.state.sliceDoc(ed.state.selection.main.from, ed.state.selection.main.to), 'x');
  replaceNext(ed.target);
  assert.equal(ed.state.sliceDoc(ed.state.selection.main.from, ed.state.selection.main.to), 'x', 'the next match is selected');
  replaceNext(ed.target);
  assert.equal(new TextDecoder().decode(ed.out()), 'one y\r\nz\r\ntwo y\r\nz\r\n');
  assert.equal(undoDepth(ed.state), 2);
  undo(ed.target as never);
  assert.equal(new TextDecoder().decode(ed.out()), 'one y\r\nz\r\ntwo x\r\n');
});

test('Apply over a document that changed since the plan refuses and changes nothing', async () => {
  const ed = editor(encoder.encode('a a a\n'));
  await withQuery(ed.target, { search: 'a', replace: 'b' });
  const p = planFor(ed.target.state);
  assert.ok(!('error' in p));
  const doc = ed.target.state.doc;
  ed.target.dispatch({ changes: { from: 0, insert: 'X' } });
  const before = ed.state.doc.toString();
  assert.equal(applyReplacePlan(ed.target, doc, p), 'stale');
  assert.equal(ed.state.doc.toString(), before);
});

// ---- differential: through the app versus JavaScript's own replace ----------------------------------------------------

/** mulberry32: the same seed, the same draws, on every machine. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ['a', 'a', 'b', 'A', 'B', ' ', ' ', '\n', '\n', 'é', '😀', '_', '.', '$', '1', '\t', '-', '/', '(', '[', '{', '|', '^', '*'];
const PATTERNS = ['a', 'ab', 'a+', 'a*', 'b?', '^', '$', '\\b', '\\B', '(a)(b)?', '(?<x>a|b)', '[ab]+', '.', '\\n', 'a\\nb', '(?=a)', 'é|😀', '\\s+', '(a)|(b)', '^a', 'b$', '[^a]', '(?<=a)b', '(?:)', 'A', '\\.', '\\$', '.\\n.'];
const REPLACEMENTS = ['', 'X', '$1', '$2', '$&', '$$', '$`', "$'", '$<x>', '$<y>', '$0', '$10', '$1$1', 'a', 'aa', 'ab', '\\n', 'q\\nq', '$', '\\t', '😀', '\\r\\n', '\\\\'];
const LITERALS = ['a', 'b', 'ab', 'aa', ' ', '\\n', 'a\\nb', 'é', '😀', '.', '$', 'A', '_', '-', 'a-b', 'a/b', '(a', '[', ']', '{', '}', '|', '^', '*', '+', '?', '"', "'", '#', '%', '&', ',', ':', ';', '<', '=', '>', '@', '`', '~', '!', '/'];
const PUNCT_ALPHABET = ['-', '/', '(', ')', '[', ']', '{', '}', '|', '^', '*', '?', '+'];
const WORDS = ['a', 'b', 'ab', 'aa', 'é', '_', 'a_', 'A'];

const unq = (s: string): string => s.replace(/\\([nrt\\])/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : '\\'));
/** Every character as a code point escape: independent of which characters the code chooses to escape. */
const esc = (s: string): string => [...s].map((c) => `\\u{${(c.codePointAt(0) as number).toString(16)}}`).join('');
const W = '[\\p{Alphabetic}\\p{Number}_]';

/** The reference: JavaScript's own replace over the text with "\n" lines, written out in the file's ending. */
function reference(lf: string, q: ReplaceQuery, sep: string): string {
  const flags = `gmu${q.caseSensitive ? '' : 'i'}`;
  const replacement = unq(q.replace);
  let out: string;
  if (q.regexp) out = lf.replace(new RegExp(q.search, flags), replacement);
  else if (q.wholeWord) out = lf.replace(new RegExp(`(?<!${W})${esc(unq(q.search))}(?!${W})`, flags), () => replacement);
  else out = lf.replace(new RegExp(esc(unq(q.search)), flags), () => replacement);
  return sep === '\n' ? out : out.replace(/\r?\n/g, sep);
}

function draw(rand: () => number) {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const n = Math.floor(rand() * 40);
  let lf = '';
  for (let i = 0; i < n; i++) lf += pick(ALPHABET);
  const kind = rand();
  const caseSensitive = rand() < 0.5;
  const query: ReplaceQuery =
    kind < 0.55
      ? { search: pick(PATTERNS), replace: pick(REPLACEMENTS), regexp: true, caseSensitive }
      : kind < 0.85
        ? { search: pick(LITERALS), replace: pick(REPLACEMENTS), caseSensitive }
        : { search: pick(WORDS), replace: pick(REPLACEMENTS), wholeWord: true, caseSensitive };
  return { lf, query, eol: pick(['lf', 'crlf', 'cr'] as const) as Eol, bom: rand() < 0.3 };
}

test('differential, pure: the plan applied equals JavaScript’s replace over 5,000 random texts, queries and replacements', () => {
  const rand = prng(3);
  for (let i = 0; i < 5000; i++) {
    const { lf, query } = draw(rand);
    const p = planReplace(lf, query);
    assert.ok(!('error' in p), `${i}: ${JSON.stringify(query)}`);
    assert.equal(applyPlan(lf, p), reference(lf, query, '\n'), `case ${i}: ${JSON.stringify({ lf, query })}`);
  }
});

test('differential, through the app: Apply on a CodeMirror state and the Source fold give the reference bytes in every ending, with and without a BOM (1,500 cases)', async () => {
  const rand = prng(11);
  let ran = 0;
  let changed = 0;
  for (let i = 0; i < 1500; i++) {
    const { lf, query, eol, bom } = draw(rand);
    const sep = SEP[eol];
    // A CR file whose text ends in a lone CR is read as CRLF-free text; keep the drawn text's ending kind uniform.
    const fileText = lf.replace(/\n/g, sep);
    const bytes = encoder.encode((bom ? BOM : '') + fileText);
    const buffer = createBuffer('/t/a.md', bytes);
    if (lf.includes('\n') && lineSeparatorFor(buffer) !== sep) continue; // the drawn file is not uniform in its ending
    // Every other case writes the plan as one span (`SPAN_ABOVE` set to nothing): both ways must give the same bytes.
    const run = await replaceAllBytes(bytes, query, i % 2 === 0 ? undefined : 0);
    ran++;
    if (run.plan.changes.length > 0) changed++;
    const want = encoder.encode((bom ? BOM : '') + reference(lf, query, lf.includes('\n') ? sep : lineSeparatorFor(buffer)));
    assert.equal(hex(run.bytes), hex(want), `case ${i}: ${JSON.stringify({ lf, query, eol, bom })}`);
    if (run.plan.changes.length > 0) {
      assert.equal(run.steps, 1, `case ${i}: one undo step`);
      if (i % 5 === 0) assert.equal(hex(run.undone()), hex(bytes), `case ${i}: one undo restores the bytes`);
    }
  }
  assert.ok(ran >= 1400 && changed >= 600, `${ran} cases ran, ${changed} of them changed something`);
});

test('nextMatch wraps to the start, and is the plan’s first match from the start', () => {
  const text = 'xa ya\nza';
  const q = { search: '(\\w)a', replace: '$1A', regexp: true };
  const first = nextMatch(text, q, 0);
  assert.ok(first && !('error' in first));
  assert.deepEqual([first.from, first.to, first.insert], [0, 2, 'xA']);
  const wrapped = nextMatch(text, q, 7);
  assert.ok(wrapped && !('error' in wrapped));
  assert.equal(wrapped.from, 0);
  const p = plan(text, q);
  assert.equal(p.changes[0]?.from, first.from);
});

test('above the span threshold a selection inside the stretch becomes a caret after the last replacement, never the stretch', async () => {
  const ed = editor(encoder.encode('x y\n'.repeat(200)));
  ed.target.dispatch({ selection: EditorSelection.create([EditorSelection.range(100, 400), EditorSelection.cursor(1)], 0) });
  await withQuery(ed.target, { search: 'x', replace: 'xx' });
  const p = planFor(ed.target.state);
  assert.ok(!('error' in p) && p.changes.length === 200);
  applyReplacePlan(ed.target, ed.target.state.doc, p, 0);
  const lastEnd = ed.state.doc.toString().lastIndexOf('xx') + 2;
  const main = ed.state.selection.main;
  assert.ok(main.empty, `a caret, not ${main.from}..${main.to}`);
  assert.equal(main.from, lastEnd);
  assert.ok(ed.state.selection.ranges.every((r) => r.empty), 'no range selects the stretch');
  const outside = editor(encoder.encode('x y\n'.repeat(200) + 'tail'));
  const len = outside.state.doc.length;
  outside.target.dispatch({ selection: EditorSelection.range(len - 3, len - 1) });
  await withQuery(outside.target, { search: 'x', replace: 'xx' });
  const q = planFor(outside.target.state);
  assert.ok(!('error' in q));
  applyReplacePlan(outside.target, outside.target.state.doc, q, 0);
  assert.equal(outside.state.sliceDoc(outside.state.selection.main.from, outside.state.selection.main.to), 'ai', 'a selection outside the stretch stays on its text');
});

test('Apply is one transaction: the selection stays where it was, mapped', async () => {
  const ed = editor(encoder.encode('aa bb aa\n'));
  ed.target.dispatch({ selection: EditorSelection.single(3, 5) });
  await withQuery(ed.target, { search: 'aa', replace: 'a' });
  const p = planFor(ed.target.state);
  assert.ok(!('error' in p));
  applyReplacePlan(ed.target, ed.target.state.doc, p);
  assert.equal(ed.state.sliceDoc(ed.state.selection.main.from, ed.state.selection.main.to), 'bb');
});

test('Apply right after typing is its own undo step: one undo takes back the replacements and leaves the typing', async () => {
  const ed = editor(encoder.encode('a a'));
  await withQuery(ed.target, { search: 'a', replace: 'c' });
  ed.target.dispatch({ changes: { from: 3, insert: 'b' }, userEvent: 'input.type' });
  const typed = ed.state.doc.toString();
  const p = planFor(ed.target.state);
  assert.ok(!('error' in p));
  applyReplacePlan(ed.target, ed.target.state.doc, p);
  assert.equal(ed.state.doc.toString(), 'c cb');
  undo(ed.target as never);
  assert.equal(ed.state.doc.toString(), typed, 'the typing stays; only the replacements went');
});

test('empty matches next to astral characters: one at a time never starts inside a pair, and Replace all matches JavaScript', async () => {
  for (const [text, search] of [['😀😀', '(?:)'], ['a😀b', '^|\\b'], ['𝔸x😀', 'x*'], ['😀\n𝔸', '$']] as const) {
    for (let from = 0; from <= text.length + 1; from++) {
      const m = nextMatch(text, { search, replace: '.', regexp: true }, from);
      assert.ok(m !== null && !('error' in m), `${search} from ${from}`);
      const c = text.charCodeAt(m.from);
      assert.ok(!(c >= 0xdc00 && c < 0xe000 && m.from > 0), `${search} from ${from}: starts at ${m.from}, inside a pair`);
    }
    assert.equal(applyPlan(text, plan(text, { search, replace: '.', regexp: true })), text.replace(new RegExp(search, 'gmu'), '.'));
    // Replace pressed over and over walks the whole text without throwing.
    const ed = editor(encoder.encode(text));
    await withQuery(ed.target, { search, replace: '.', regexp: true });
    for (let press = 0; press < 3 * text.length + 4; press++) assert.doesNotThrow(() => replaceNext(ed.target), `${search}, press ${press}`);
  }
});
