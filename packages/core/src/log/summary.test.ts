import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inZone, summariseLog, zoneName } from './summary.ts';

const LOG = [
  '2026-10-14T16:02:11.402Z INFO  build: starting',
  '2026-10-14T16:02:48.017Z WARN  \u001b[33mindexer\u001b[0m: unused import',
  '2026-10-14T16:03:09.118Z ERROR sign: codesign failed',
  '    at sign::run (sign.rs:88)',
  '2026-10-14T16:03:15.901Z INFO  build: done in 64.5 s',
  '',
].join('\n');

test('levels are counted, warnings and errors kept with their times, escapes counted', () => {
  const s = summariseLog(LOG);
  assert.deepEqual(s.counts, [0, 2, 1, 1]);
  assert.deepEqual(s.notable.map((e) => [e.level, e.time, e.text]), [
    ['WARN', '2026-10-14T16:02:48.017Z', '\u001b[33mindexer\u001b[0m: unused import'],
    ['ERROR', '2026-10-14T16:03:09.118Z', 'sign: codesign failed'],
  ]);
  assert.equal(LOG.slice(s.notable[1]!.at).startsWith('2026-10-14T16:03:09.118Z ERROR'), true);
  assert.equal(s.first, '2026-10-14T16:02:11.402Z');
  assert.equal(s.last, '2026-10-14T16:03:15.901Z');
  assert.equal(s.zoned, true);
  assert.equal(s.escapes, 2);
});

test('a log whose times name no zone cannot be moved to another', () => {
  assert.equal(summariseLog('2026-10-14 16:02:11 INFO a\n2026-10-14 16:02:12 INFO b\n').zoned, false);
  assert.equal(inZone('2026-10-14 16:02:11', 60), null);
});

test('a time in another zone keeps the instant and the digits the file wrote', () => {
  assert.deepEqual(inZone('2026-10-14T16:02:11.402Z', -240), { date: '2026-10-14', time: '12:02:11.402' });
  assert.deepEqual(inZone('2026-10-14T01:30:00Z', -240), { date: '2026-10-13', time: '21:30:00' });
  assert.deepEqual(inZone('2026-10-14T16:02:11+02:00', 0), { date: '2026-10-14', time: '14:02:11' });
  assert.equal(zoneName(-240), 'UTC−04:00');
  assert.equal(zoneName(330), 'UTC+05:30');
  assert.equal(zoneName(0), 'UTC');
});
