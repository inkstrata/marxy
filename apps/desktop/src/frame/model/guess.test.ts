// The guess mark: the head names the guessed part, is quiet when nothing was guessed, and
// says what the Reading card says.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Reason } from '@marxy/core/src/kind/detect.ts';
import type { Reading } from '@marxy/core/src/reading/index.ts';
import type { Part, PartReading } from '@marxy/core/src/reading/parts.ts';
import { guessMark, partGuessed, type GuessInput } from './guess.ts';

const reason = (tier: number, kind = 'article'): Reason => ({ tier, signal: 's', kind: kind as Reason['kind'], at: 'x', decisive: true });
const reading = (id: Reading['id'], name: string): Reading => ({ id, name, format: 'plain text', html: '', contents: null, failed: null }) as Reading;
const part = (o: Partial<Part> & { key: string; firstLine: number }): Part =>
  ({ start: 100, end: 200, lastLine: o.firstLine + 3, lang: '', guess: 'session', from: 'text', reasons: [], ways: ['session', 'written'], note: null, ...o }) as unknown as Part;
const input = (o: Partial<GuessInput>): GuessInput => ({
  detected: { kind: 'article', reasons: [reason(7)] },
  reading: null,
  family: true,
  markdownGuessed: false,
  kindName: 'Article',
  parts: [],
  ...o,
});
const now = (p: Part, r: PartReading = p.guess, chosen = false) => ({ part: p, reading: r, chosen });

test('a Markdown page with a guessed session fence names the part, not the kind', () => {
  const m = guessMark(input({ detected: { kind: 'report', reasons: [reason(4, 'report')] }, kindName: 'Report', parts: [now(part({ key: 'a', firstLine: 20 }))] }));
  assert.deepEqual([m?.label, m?.how, m?.mine], ['session at line 20', 'guessed', false]);
  assert.equal(m?.places[0]?.start, 100);
});

test('a Markdown page whose kind alone was guessed is quiet (no "report · guessed")', () => {
  assert.equal(guessMark(input({ detected: { kind: 'report', reasons: [reason(6, 'report')] }, kindName: 'Report' })), null);
});

test('a .txt or an empty file set as written is quiet: finding no reading is not a guess', () => {
  assert.equal(guessMark(input({ reading: reading('written', 'written') })), null);
});

test('verse and plain prose found from a file\'s text are guessed, by the reading\'s own name', () => {
  assert.equal(guessMark(input({ reading: reading('verse', 'verse') }))?.label, 'verse');
  assert.equal(guessMark(input({ reading: reading('prose', 'plain prose') }))?.label, 'plain prose');
  assert.equal(guessMark(input({ reading: reading('tree', 'a data tree'), family: false })), null, 'a tree from its name is not a guess');
});

test('a plain-text name that read as Markdown, and a kind found from a nameless file\'s text, are guessed', () => {
  assert.equal(guessMark(input({ markdownGuessed: true }))?.label, 'Markdown');
  assert.equal(guessMark(input({ family: false, detected: { kind: 'log', reasons: [reason(4, 'log')] }, kindName: 'Log' }))?.label, 'log');
});

test('a kind the reader chose is said in the select\'s words, as theirs', () => {
  const m = guessMark(input({ detected: { kind: 'code', reasons: [reason(1, 'code')] }, kindName: 'Code · Python' }));
  assert.deepEqual([m?.label, m?.how, m?.mine], ['code · Python', 'your choice', true]);
});

test('a fence with no language set as written is not a guess, in the head or the card', () => {
  const p = part({ key: 'w', firstLine: 4, guess: 'written', ways: ['written'] });
  assert.equal(guessMark(input({ parts: [now(p)] })), null);
  assert.equal(partGuessed(p, 'written', false), false);
  assert.equal(partGuessed(part({ key: 's', firstLine: 9 }), 'session', false), true);
});

test('several places are counted, and guessed wins over chosen', () => {
  const m = guessMark(input({ parts: [now(part({ key: 'a', firstLine: 3 })), now(part({ key: 'b', firstLine: 30, guess: 'log', ways: ['log', 'written'] }), 'written', true)] }));
  assert.deepEqual([m?.label, m?.how, m?.places.map((p) => p.words)], ['2 parts', 'guessed', ['session at line 3', 'as written at line 30']]);
  const fenced = part({ key: 'f', firstLine: 5, from: 'fence', guess: 'data', ways: ['data', 'written'] });
  assert.equal(guessMark(input({ parts: [now(fenced)] })), null, 'a part read as its fence says is no guess');
});
