// Presence check for MARXY-129 taste-review pairs: review #0 passages 2 and 4 at 1× and 2×.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const SHOTS = ['p2-inline-code', 'p4-heading-stack'];
const dir = new URL('../../../docs/taste-review/2026-09-marxy-129/', import.meta.url);

test('review #0 passages 2 and 4 exist as before/after pairs at 1× and 2×', () => {
  for (const prefix of ['before', 'after']) {
    for (const dpr of ['1', '2']) {
      for (const page of SHOTS) {
        const name = `${prefix}-${page}-${dpr}x.png`;
        assert.ok(existsSync(new URL(name, dir)), `missing ${name}`);
      }
    }
  }
});

test('the taste-review queue asks whether the code size and heading voice are right', () => {
  const queue = readFileSync(new URL('../../../docs/taste-review/queue.md', import.meta.url), 'utf8');
  assert.match(queue, /MARXY-129/);
  assert.match(queue, /code size/i);
  assert.match(queue, /heading voice/i);
});
