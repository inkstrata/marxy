// The committed human queue must not re-open work that already landed (MARXY-179).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { here } from './lib.mjs';

const AUTH = /Headless auth failure:/;
const ALLOWED = new Set(['MARXY-22', 'MARXY-94', 'MARXY-122']);
const STALE_PRS = /\bPR #(?:1|10|14|23|25|28)\b/;

function openItems(text = readFileSync(here('needs-human.md'), 'utf8')) {
  return text.split('\n').filter(l => l.startsWith('- [ ]'));
}

test('unchecked bullets do not name closed PRs that were waiting on approval', () => {
  for (const line of openItems()) {
    assert.doesNotMatch(line, STALE_PRS, line);
    assert.doesNotMatch(line, /Approve PR/);
  }
});

test('unchecked bullets name only still-open human-gated work, or a same-day auth failure', () => {
  const open = openItems();
  assert.ok(open.length > 0, 'the queue still has live items');
  for (const line of open) {
    if (AUTH.test(line)) continue;
    for (const key of line.match(/MARXY-\d+/g) ?? []) {
      assert.ok(ALLOWED.has(key), `${key} is not a live human-gated item: ${line}`);
    }
  }
  assert.ok(open.some(l => l.includes('MARXY-22')));
  assert.ok(open.some(l => l.includes('MARXY-94')));
  assert.ok(open.some(l => l.includes('MARXY-122')));
});
