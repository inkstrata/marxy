// The 2026-09-19 taste pass is on disk: pair A, 68 ch, ADR-0015 accepted (MARXY-127).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './lib.mjs';

test('taste review #0 recorded pair A and accepted ADR-0015', () => {
  const adr = readFileSync(`${ROOT}docs/adr/0015-typeface.md`, 'utf8');
  assert.match(adr, /\*\*Status:\*\* accepted/);
  const index = readFileSync(`${ROOT}docs/adr/README.md`, 'utf8');
  assert.match(index, /0015-typeface\.md.*accepted/);
  const decision = readFileSync(`${ROOT}docs/taste-review/2026-09-review-0/decisions.md`, 'utf8');
  assert.match(decision, /Pair A \(Literata \+ JetBrains Mono\)/);
  assert.match(decision, /68 `ch` survives/);
  const queue = readFileSync(`${ROOT}docs/taste-review/queue.md`, 'utf8');
  const row = queue.split('\n').find(l => l.includes('| MARXY-17 |'));
  assert.ok(row, 'MARXY-17 queue row');
  assert.match(row, /Pair A/);
  assert.ok(!/\| pending \|$/.test(row), row);
});
