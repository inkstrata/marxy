// A log's lines (K-08): what a head is, its runs, and the rank each line takes. The pattern is detection's (`TIMESTAMP`).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TIMESTAMP } from '../kind/detect.ts';
import { highlight, lineMetaForHighlight, plainTextFromTokens, LOG_ERROR_LINE_CLASS, LOG_LEVEL_CLASS, LOG_TIME_CLASS } from './index.ts';
import { logHead, logRanks } from './line-classes.ts';

test('a head has its timestamp, separator and level word located; a continuation line is no head', () => {
  const line = '2026-10-08T09:14:05.002Z ERROR [compile] boom';
  assert.deepEqual(logHead(line), { rank: 3, time: [0, 24], level: [25, 30] });
  assert.deepEqual(logHead('[2026-10-08 09:14:05,002] warn: disk')?.time, [1, 24]);
  assert.equal(logHead('[2026-10-08 09:14:05,002] warn: disk')?.rank, 2);
  assert.equal(logHead('09:14:05 INFO ready')?.rank, 1);
  for (const gone of ['    at foo (bar.ts:12:3)', '', 'ERROR: no timestamp', 'caused by: 2026-10-08T09:14:05Z ERROR x', '2026-10-08T09:14:05Z']) assert.equal(logHead(gone), null, JSON.stringify(gone));
});

test('detection and the runs read one pattern: whatever TIMESTAMP matches is a head, and nothing else is', () => {
  for (const line of ['2026-10-08T09:14:02.118Z INFO  [build] x', '2026-10-08 09:14:05,002 WARNING y', '[09:14:05] FATAL z', '12:00:00.5 | TRACE t', 'plain line', '  2026-10-08T09:14:05Z ERROR indented']) {
    assert.equal(logHead(line) !== null, TIMESTAMP.test(line), line);
  }
});

test('the ranks: trace and debug 0, info and notice 1, warn 2, error, fatal and critical 3; a continuation line takes its head\'s', () => {
  const lines = [
    '    orphan frame before any head',
    '2026-10-08T09:00:00Z DEBUG a',
    '2026-10-08T09:00:01Z INFO b',
    '    continues b',
    '2026-10-08T09:00:02Z NOTICE c',
    '2026-10-08T09:00:03Z WARNING d',
    '',
    '2026-10-08T09:00:04Z ERROR e',
    '    at frame one',
    '    at frame two',
    '2026-10-08T09:00:05Z INFO f',
    '2026-10-08T09:00:06Z FATAL g',
    '2026-10-08T09:00:07Z CRIT h',
  ];
  assert.deepEqual([...logRanks(lines)], [1, 0, 1, 1, 1, 2, 2, 3, 3, 3, 1, 3, 3]);
});

test('a log line is its text in three runs: timestamp, level word, the rest; a level word in a message is not a level', async () => {
  const text = '2026-10-08T09:14:05.002Z ERROR [compile] no ERROR here\n    at foo\n\n[09:14:06] INFO ok\n';
  const lines = (await highlight(text, 'log'))!;
  assert.equal(plainTextFromTokens(lines), text.replace(/\n$/, '\n'), 'the runs are the text, byte for byte');
  assert.deepEqual(lines[0]!.map((t) => [t.text, t.className ?? null]), [
    ['2026-10-08T09:14:05.002Z', LOG_TIME_CLASS],
    [' ', null],
    ['ERROR', LOG_LEVEL_CLASS],
    [' [compile] no ERROR here', null],
  ]);
  assert.deepEqual(lines[1]!.map((t) => t.className ?? null), [null], 'a frame is plain');
  assert.deepEqual(lines[2], [], 'a blank line has no runs');
  assert.deepEqual(lines[3]!.map((t) => [t.text, t.className ?? null]), [['[', null], ['09:14:06', LOG_TIME_CLASS], ['] ', null], ['INFO', LOG_LEVEL_CLASS], [' ok', null]]);
  assert.ok(lines.flat().every((t) => t.scope === undefined), 'no token hue: the level is weight, the timestamp the comment colour');
});

test('the line at ERROR or above and its continuation lines carry the rule class; nothing else does', async () => {
  const lines = (await highlight('2026-10-08T09:00:00Z INFO a\n2026-10-08T09:00:01Z ERROR b\n    at c\n2026-10-08T09:00:02Z WARN d\n    at e\n', 'log'))!;
  const meta = lineMetaForHighlight('log', lines);
  assert.deepEqual(meta.map((m) => m.lineClass ?? null), [null, LOG_ERROR_LINE_CLASS, LOG_ERROR_LINE_CLASS, null, null, null]);
});

test('a log with no heads has no rule and no weight: an .out that is not a log reads as plain text', async () => {
  const lines = (await highlight('make: Entering directory\ncc -o a a.c\nERROR in the middle\n', 'log'))!;
  assert.ok(lines.flat().every((t) => t.className === undefined));
  assert.ok(lineMetaForHighlight('log', lines).every((m) => m.lineClass === undefined));
});
