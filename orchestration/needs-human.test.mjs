// The committed human queue must not re-open work that already landed (MARXY-179).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { here, ROOT } from './lib.mjs';

const AUTH = /Headless auth failure:/;
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

test('unchecked bullets never name work CHANGELOG.md records as landed, except a same-day auth failure', () => {
  // An empty queue is the goal, not a failure (MARXY-188 cleared it and this used to go red). What
  // must not happen is a bullet re-opening landed work: a key a CHANGELOG line closes with (KEY).
  const landed = new Set([...readFileSync(`${ROOT}CHANGELOG.md`, 'utf8').matchAll(/\((MARXY-\d+)\)\s*$/gm)].map(m => m[1]));
  for (const line of openItems()) {
    if (AUTH.test(line)) continue;
    for (const key of line.match(/MARXY-\d+/g) ?? []) {
      assert.ok(!landed.has(key), `${key} already landed (CHANGELOG.md) but is still an open human item: ${line}`);
    }
  }
});

test('the landed-work check catches a stale bullet', () => {
  const fake = '- [ ] **MARXY-5** — approve the thing\n- [x] **MARXY-6** — done\n';
  assert.deepEqual(openItems(fake), ['- [ ] **MARXY-5** — approve the thing']);
});
