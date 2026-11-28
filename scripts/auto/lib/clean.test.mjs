import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDue, oldNames, parseWork, pruneRows } from './clean.mjs';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const ago = (d) => new Date(NOW - d * 864e5).toISOString();

test('rows older than the cutoff go; unreadable and undated lines stay', () => {
  const text = [`{"at":"${ago(100)}","a":1}`, `{"at":"${ago(10)}","a":2}`, 'torn {', '{"a":3}', ''].join('\n');
  assert.equal(pruneRows(text, NOW - 90 * 864e5), `{"at":"${ago(10)}","a":2}\ntorn {\n{"a":3}\n`);
  assert.equal(pruneRows(`{"at":"${ago(100)}"}\n`, NOW - 90 * 864e5), '');
});

test('names older than the limit are picked by their time', () => {
  const t = { old: NOW - 31 * 864e5, new: NOW - 2 * 864e5 };
  assert.deepEqual(oldNames(['old', 'new'], (n) => t[n], 30, NOW), ['old']);
});

test('a cleanup is due when none is recorded or the last is over a week old', () => {
  assert.equal(cleanDue(null, NOW), true);
  assert.equal(cleanDue({ at: ago(8) }, NOW), true);
  assert.equal(cleanDue({ at: ago(6) }, NOW), false);
});

test('the work clean output gives the removed and archived counts', () => {
  const out = '1 worktrees and 2 bare branches removed; 0 kept\nremoved  x\n\nstale: removed=4 archived=3\n';
  assert.deepEqual(parseWork(out), { removed: 7, archived: 3 });
  assert.deepEqual(parseWork(''), { removed: 0, archived: 0 });
});
