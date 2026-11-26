// Search as data: what Aa, .* and word compile to, lines that hold a match, replaces that keep every ending, saved names.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchContent } from '@marxy/core/src/index-model/content-search.ts';
import { compileSearch, filesHolding, joinLines, literalOf, matchLines, minimalSplice, replaceAll, replaceOne, savedName, leftAloneWhy, savedOf, snippet, splitLines, tickedByDefault, wordPair } from './search-model.ts';

const re = (q: string, o: Partial<{ case: boolean; regex: boolean; word: boolean }> = {}): RegExp => {
  const c = compileSearch({ q, case: false, regex: false, word: false, ...o });
  assert.ok(c && 're' in c, `compiles ${q}`);
  return c.re;
};
const count = (text: string, r: RegExp): number => matchLines(text, r).length;

test('a match is a line: two on one line are one place, and Aa, word and .* narrow or widen it', () => {
  const text = 'Watcher and watcher\nmax_wait_ms = 5\nthe maximum\nmax.wait or maxXwait\n';
  assert.equal(count(text, re('watcher')), 1);
  assert.equal(count(text, re('watcher', { case: true })), 1);
  assert.equal(count(text, re('Watcher', { case: true })), 1);
  assert.equal(count(text, re('max')), 3);
  assert.equal(count(text, re('max', { word: true })), 1);
  assert.equal(count(text, re('max.wait')), 1);
  assert.equal(count(text, re('max.wait', { regex: true })), 2);
  assert.equal(compileSearch({ q: 'a', case: false, regex: false, word: false }), null, 'one character is too short');
  const bad = compileSearch({ q: '(open', case: false, regex: true, word: false });
  assert.ok(bad && 'error' in bad, 'an unclosed group is not a regular expression yet');
});

test('plain text folds as in-page find does: a straight quote finds a curly one', () => {
  assert.equal(count('it’s here\nit is\n', re("it's")), 1);
  assert.equal(literalOf({ q: "it's", case: false, regex: false, word: false }), null, 'the shell cannot narrow a folded query');
  assert.equal(literalOf({ q: 'Max_Wait', case: true, regex: false, word: false }), 'max_wait');
});

test('a replace keeps CRLF lines, lone CRs and a missing final newline, and changes only lines that match', () => {
  const text = 'one runner\r\ntwo\rthree runner\nfour runner';
  const all = replaceAll(text, re('runner'), 'builder', false);
  assert.equal(all.text, 'one builder\r\ntwo\rthree builder\nfour builder');
  assert.equal(all.n, 3);
  assert.equal(replaceOne(text, 2, re('runner'), 'builder', false), 'one runner\r\ntwo\rthree builder\nfour runner');
  assert.equal(replaceAll('a1 b2\n', re('([a-z])(\\d)', { regex: true }), '$2$1', true).text, '1a 2b\n', '$1 in a regular expression');
  assert.equal(replaceAll('cost $5\n', re('cost'), '$&!', false).text, '$&! $5\n', 'plain text is put in as written');
  const sp = splitLines(text);
  assert.equal(joinLines(sp.lines, sp.eols), text);
});

test('the list shows a line from its first word, past a timestamp, and from near the match when it is far in', () => {
  const s = snippet('2026-10-14T08:00:01Z ERROR max_wait_ms hit', [[27, 11]]);
  assert.equal(s.parts.map((p) => p[0]).join(''), 'ERROR max_wait_ms hit');
  assert.deepEqual(s.parts.filter((p) => p[1]).map((p) => p[0]), ['max_wait_ms']);
  const far = snippet(`${'x'.repeat(60)} needle`, [[61, 6]]);
  assert.equal(far.pre, true);
});

test('a changed line is struck and put in around one middle; ticks leave logs and transcripts alone', () => {
  const w = wordPair('timeout: max_wait_ms', 'timeout: max_burst_ms');
  assert.ok(w.a.some(([t, c]) => c && /wait/.test(t)) && w.b.some(([t, c]) => c && /burst/.test(t)));
  assert.equal(tickedByDefault('/w/logs/indexer.log'), false);
  assert.equal(tickedByDefault('/w/t/session.jsonl'), false);
  assert.equal(tickedByDefault('/w/plan.md'), true);
});

test('a file a replace leaves alone by default says why', () => {
  assert.equal(leftAloneWhy('/w/logs/indexer.log'), 'a log');
  assert.equal(leftAloneWhy('/w/t/session.jsonl'), 'JSON Lines');
  assert.equal(leftAloneWhy('/w/plan.md'), null);
});

test('a saved search keeps its text, toggles and scope in its name', () => {
  const s = { q: 'max · x', case: true, regex: false, word: true, scope: 'file' as const };
  assert.equal(savedName(s), 'Search: max · x · this file · Aa · word');
  assert.deepEqual(savedOf(savedName(s)), s);
  assert.equal(savedOf('Plans this week'), null);
});

test('the smallest splice keeps a character whole and maps characters to UTF-8 bytes', () => {
  assert.deepEqual(minimalSplice('café au lait', 'café au thé'), { start: 9, end: 13, replacement: 'thé' });
  assert.equal(minimalSplice('same', 'same'), null);
  assert.deepEqual(minimalSplice('a😀b', 'a😁b'), { start: 1, end: 5, replacement: '😁' });
});

test('filesHolding: a second hit in a file does not throw the narrowing away, and a search stopped early reads the rest', async () => {
  const files: Record<string, string> = { '/w/a.md': 'foo foo\n', '/w/b.md': 'bar\n', '/w/c.md': 'foo\n', '/w/d.md': 'none\n', '/w/e.md': 'nor\n' };
  const paths = Object.keys(files);
  const enc = new TextEncoder();
  const reader = (p: string) => ({ size: enc.encode(files[p]!).length, read: () => enc.encode(files[p]!) });
  const calls: string[][] = [];
  const all = await filesHolding(paths, async (ps) => {
    calls.push([...ps]);
    return searchContent(ps, 'foo', reader, { limit: 10_000, perFile: 1 });
  });
  assert.deepEqual(all.sort(), ['/w/a.md', '/w/c.md']);
  assert.deepEqual(calls[1], ['/w/d.md', '/w/e.md'], 'asked again only past the last hit');
  // A search that stops after two files (its byte budget): the files it never reached are read, never dropped.
  let call = 0;
  const stopped = await filesHolding(paths, async (ps) => {
    let seen = 0;
    const first = call++ === 0;
    return searchContent(ps, 'foo', reader, { limit: 10_000, perFile: 1, cancelled: () => first && seen++ >= 2 });
  });
  assert.deepEqual(stopped.sort(), ['/w/a.md', '/w/c.md'], 'c, never reached by the first search, is found by the second');
  // One that stops before any hit leaves every file to be read.
  const none = await filesHolding(paths, async () => ({ hits: [], truncated: true }));
  assert.deepEqual(none, paths);
});
