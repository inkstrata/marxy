// The run mapping (token lines to runs), and a text read a piece at a time giving the runs it gives whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAMMAR_SAMPLES } from './grammar-samples.ts';
import { grammarTokens, hasGrammarRuns, highlight, type HighlightToken } from './grammar.ts';
import { RUN_ROLES, eachRun, runsFromTokens } from './runs.ts';
import { RunSession } from './session.ts';

const lines = (...ls: HighlightToken[][]): HighlightToken[][] => ls;

test('runs: a token with a role is a run at its offsets; a newline is one position; plain text and classes make none', () => {
  const runs = runsFromTokens(lines(
    [{ text: 'const', scope: 'keyword' }, { text: ' x = ' }, { text: '1', scope: 'number' }],
    [],
    [{ text: 'ERROR', className: 'marxy-log-level' }, { text: '"s"', scope: 'string' }],
  ));
  assert.deepEqual([...eachRun(runs)], [[0, 5, 'keyword'], [10, 11, 'number'], [18, 21, 'string']]);
});

test('runs: neighbours of one role are one run, and a base moves every offset', () => {
  const runs = runsFromTokens(lines([{ text: '"', scope: 'string' }, { text: 'ab', scope: 'string' }, { text: '"', scope: 'string' }, { text: ';', scope: 'punctuation' }]), 100);
  assert.deepEqual([...eachRun(runs)], [[100, 104, 'string'], [104, 105, 'punctuation']]);
});

test('runs: every role a token can carry has an index, and the order is the role table\'s', () => {
  assert.ok(RUN_ROLES.includes('keyword') && RUN_ROLES.includes('escape') && !RUN_ROLES.includes('heading' as never));
  for (const [i, role] of RUN_ROLES.entries()) {
    assert.deepEqual([...eachRun(runsFromTokens(lines([{ text: 'x', scope: role }])))], [[0, 1, role]], `${i}`);
  }
});

/** Each character's role, from a set of pieces laid over the text in the order they arrived. */
function rolesFromPieces(length: number, pieces: readonly { from: number; to: number; runs: Uint32Array }[]): (string | null)[] {
  const roles: (string | null)[] = new Array(length).fill(null);
  for (const p of pieces) {
    for (let i = p.from; i < Math.min(p.to, length); i++) roles[i] = null;
    for (const [from, to, role] of eachRun(p.runs)) for (let i = from; i < to; i++) roles[i] = role;
  }
  return roles;
}

async function readAll(session: RunSession, pieces: { from: number; to: number; runs: Uint32Array }[] = []) {
  while (!session.done) {
    const piece = await session.next();
    assert.ok(piece && piece !== 'stale');
    pieces.push(piece);
  }
  return pieces;
}

async function wholeRoles(text: string, lang: string): Promise<(string | null)[]> {
  const read = await grammarTokens(text.split('\n'), lang);
  return rolesFromPieces(text.length, [{ from: 0, to: text.length, runs: runsFromTokens(read!.lines) }]);
}

/** A text long enough for several pieces, with a block comment and a template string crossing the piece boundaries. */
function longTypeScript(): string {
  const parts: string[] = [];
  for (let i = 0; parts.join('\n').length < 160_000; i++) {
    parts.push(i % 37 === 0 ? `/* a comment\n   that spans ${i}\n   lines */` : i % 41 === 0 ? `const t${i} = \`line\n${'${'}x${i}}\nend\`;` : `export function f${i}(a: number): string { return "s" + a * ${i}; } // c`);
  }
  return parts.join('\n');
}

test('session: pieces read in turn give the runs of the whole text, across piece boundaries', async () => {
  for (const [lang, text] of [['typescript', longTypeScript()], ['ruby', GRAMMAR_SAMPLES.ruby!.repeat(1000)], ['python', GRAMMAR_SAMPLES.python!.repeat(1000)]] as const) {
    const pieces = await readAll(new RunSession(lang, text));
    assert.ok(pieces.length > 2, `${lang}: ${pieces.length} pieces`);
    assert.equal(pieces[0]!.from, 0);
    for (let i = 1; i < pieces.length; i++) assert.equal(pieces[i]!.from, pieces[i - 1]!.to, `${lang}: pieces abut`);
    assert.deepEqual(rolesFromPieces(text.length, pieces), await wholeRoles(text, lang), lang);
  }
});

test('session: an edit is read again from its piece, not the top, and the result is the edited text\'s runs', async () => {
  const text = longTypeScript();
  const session = new RunSession('typescript', text);
  const pieces = await readAll(session);
  const at = text.indexOf('\n', Math.floor(text.length * 0.7));
  // Opening a block comment changes the role of everything after it.
  const edited = `${text.slice(0, at)}\n/* opened${text.slice(at)}`;
  session.update(edited);
  const again = await session.next();
  assert.ok(again && again !== 'stale');
  assert.ok(again.from > 0 && again.from <= at + 1, `re-read from ${again.from}, edit at ${at}`);
  pieces.push(again);
  await readAll(session, pieces);
  assert.deepEqual(rolesFromPieces(edited.length, pieces), await wholeRoles(edited, 'typescript'));
});

test('session: a text changed while a piece is read gives that piece as stale', async () => {
  const session = new RunSession('typescript', 'const a = 1;');
  const reading = session.next();
  session.update('const b = 2;');
  assert.equal(await reading, 'stale');
  const piece = await session.next();
  assert.ok(piece && piece !== 'stale' && piece.done);
});

test('session: a language with no grammar has no runs; Read\'s own readings are not grammar runs', async () => {
  assert.equal(await new RunSession('nope', 'x').next(), null);
  assert.equal(hasGrammarRuns('ruby'), true);
  assert.equal(hasGrammarRuns('log'), false);
  assert.equal(hasGrammarRuns('terminal'), false);
  assert.equal(hasGrammarRuns('markdown'), true);
});

test('session: the runs for a fence are the runs Read paints for it', async () => {
  for (const [lang, sample] of Object.entries(GRAMMAR_SAMPLES)) {
    const [piece] = await readAll(new RunSession(lang, sample));
    const read = await highlight(sample, lang);
    assert.deepEqual([...eachRun(piece!.runs)], [...eachRun(runsFromTokens(read!))], lang);
  }
});
