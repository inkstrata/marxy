// What is in view is read first, the rest after it, and the end is the whole text's runs; past the plain-text tier,
// coloured anyway, only what is in view is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grammarTokens } from './grammar.ts';
import { eachRun, runsFromTokens } from './runs.ts';
import { RunSession, type RunChunk } from './session.ts';

function rolesFromPieces(length: number, pieces: readonly { from: number; to: number; runs: Uint32Array }[]): (string | null)[] {
  const roles: (string | null)[] = new Array(length).fill(null);
  for (const p of pieces) {
    for (let i = p.from; i < Math.min(p.to, length); i++) roles[i] = null;
    for (const [from, to, role] of eachRun(p.runs)) for (let i = from; i < to; i++) roles[i] = role;
  }
  return roles;
}

async function wholeRoles(text: string, lang: string): Promise<(string | null)[]> {
  const read = await grammarTokens(text.split('\n'), lang);
  return rolesFromPieces(text.length, [{ from: 0, to: text.length, runs: runsFromTokens(read!.lines) }]);
}

async function step(session: RunSession): Promise<RunChunk> {
  const piece = await session.next();
  assert.ok(piece && piece !== 'stale');
  return piece;
}

/** About 4,000 lines of TypeScript, with block comments every so often, so a state made up mid-file can be wrong. */
function longTypeScript(): string {
  const parts: string[] = [];
  for (let i = 0; i < 4000; i++) {
    parts.push(i % 97 === 0 ? `/* opens here\n  and runs on ${i}\n*/` : `export function f${i}(a: number): string { return "s" + a * ${i}; } // c`);
  }
  return parts.join('\n');
}

const offsetOfLine = (text: string, line: number): number => {
  let at = 0;
  for (let i = 0; i < line; i++) at = text.indexOf('\n', at) + 1;
  return at;
};

test('view first: the lines in view are the first piece read, far down the file, and the end is the whole text\'s runs', async () => {
  const text = longTypeScript();
  const session = new RunSession('typescript', text);
  session.setView([[3000, 3060]]);
  const first = await step(session);
  assert.ok(first.from <= offsetOfLine(text, 3000) && first.to >= offsetOfLine(text, 3060), `first piece ${first.from}..${first.to}`);
  assert.ok(first.from > 0, 'not read from the top');
  assert.ok(first.runs.length > 0);
  const pieces = [first];
  while (!session.done) pieces.push(await step(session));
  // The reading top down reached the view and sent it again: what is left is the whole text's runs.
  assert.deepEqual(rolesFromPieces(text.length, pieces), await wholeRoles(text, 'typescript'));
});

test('view first: a view a little below what is read is read on from there, rightly', async () => {
  const text = longTypeScript();
  const session = new RunSession('typescript', text);
  session.setView([[40, 100]]);
  const first = await step(session);
  assert.equal(first.from, 0, 'read on from the top');
  assert.ok(first.to >= offsetOfLine(text, 100));
  const want = await wholeRoles(text, 'typescript');
  const got = rolesFromPieces(text.length, [first]);
  assert.deepEqual(got.slice(0, first.to - 1), want.slice(0, first.to - 1));
});

test('view first: the view moving down is read next, ahead of the reading top down', async () => {
  const text = longTypeScript();
  const session = new RunSession('typescript', text);
  await step(session);
  session.setView([[2000, 2050]]);
  const moved = await step(session);
  assert.ok(moved.from <= offsetOfLine(text, 2000) && moved.to >= offsetOfLine(text, 2050));
  // Read already: the same view asks for nothing more, and the next piece is the reading top down's.
  session.setView([[2000, 2050]]);
  const next = await step(session);
  assert.ok(next.to < offsetOfLine(text, 2000), 'the top-down reading goes on');
});

test('in view only (coloured anyway): only the view is read, then nothing until it moves', async () => {
  const text = longTypeScript();
  const session = new RunSession('typescript', text, { whole: false });
  assert.equal(session.done, true, 'nothing in view, nothing to read');
  session.setView([[1500, 1560], [1560, 1700]]);
  assert.equal(session.done, false);
  const a = await step(session);
  const b = await step(session);
  assert.ok(a.from <= offsetOfLine(text, 1500) && a.to >= offsetOfLine(text, 1560));
  assert.ok(b.from <= offsetOfLine(text, 1560) && b.to >= offsetOfLine(text, 1700));
  assert.equal(session.done, true);
  // A small move reads only the lines new to the view.
  session.setView([[1600, 1720]]);
  const c = await step(session);
  assert.ok(c.from >= offsetOfLine(text, 1700) && c.to >= offsetOfLine(text, 1720), `${c.from}..${c.to}`);
  assert.equal(session.done, true);
});

test('in view only: an edit reads the view again', async () => {
  const text = longTypeScript();
  const session = new RunSession('typescript', text, { whole: false });
  session.setView([[100, 140]]);
  await step(session);
  assert.equal(session.done, true);
  const at = offsetOfLine(text, 120);
  session.update(`${text.slice(0, at)}/* opened ${text.slice(at)}`);
  assert.equal(session.done, false);
  const again = await step(session);
  assert.ok(again.from <= at && again.to >= offsetOfLine(text, 140));
});

test('cuts: every piece begins and ends where a piece of Read\'s page does', async () => {
  const text = longTypeScript();
  const lines = text.split('\n').length;
  const cuts: number[] = [];
  for (let l = 0; l < lines; l += 200) cuts.push(l);
  const starts = new Set([...cuts.map((l) => offsetOfLine(text, l)), text.length + 1]);
  const session = new RunSession('typescript', text, { cuts });
  session.setView([[2510, 2530]]);
  const pieces: RunChunk[] = [];
  while (!session.done) pieces.push(await step(session));
  for (const p of pieces) {
    assert.ok(starts.has(p.from), `piece begins at ${p.from}`);
    assert.ok(starts.has(p.to), `piece ends at ${p.to}`);
  }
  assert.equal(pieces[0]!.from, offsetOfLine(text, 2400));
  assert.deepEqual(rolesFromPieces(text.length, pieces), await wholeRoles(text, 'typescript'));
});
