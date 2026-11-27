// The log page's words: how a pause reads and what the heading says of the file's zone. Pure: no DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pauseWords, timesWords } from './log-page.ts';

test('a pause reads in seconds, then minutes, then hours and minutes', () => {
  assert.equal(pauseWords(36_427), '+36 s');
  assert.equal(pauseWords(59_600), '+1 min');
  assert.equal(pauseWords(4 * 60_000 + 20_000), '+4 min');
  assert.equal(pauseWords(3 * 3_600_000), '+3 h');
  assert.equal(pauseWords(3_600_000 + 5 * 60_000), '+1 h 5 min');
});

test('the heading says the zone the file writes its times in, or that it names none', () => {
  assert.equal(timesWords('2026-10-14T16:02:11.402Z', false), 'times are UTC, as the file writes them (Z)');
  assert.equal(timesWords('2026-10-14T16:02:11+02:00', false), 'times are UTC+02:00, as the file writes them (+02:00)');
  assert.equal(timesWords('2026-10-14T16:02:11-0430', false), 'times are UTC−04:30, as the file writes them (-0430)');
  assert.equal(timesWords('2026-10-14 16:02:11,402', false), 'times as the file writes them, naming no zone');
  assert.match(timesWords('2026-10-14T16:02:11.402Z', true), /^times shown in your zone, UTC.*; the file writes them in UTC, and Source keeps them so$/);
});
