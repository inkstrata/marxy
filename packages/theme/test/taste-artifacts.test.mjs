// Presence check for the MARXY-128 taste-review pairs: five corpus pages × dark/light,
// before and after, plus the queue row that names the six faults.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const PAGES = [
  '01-long-technical',
  '02-readme-real-world',
  '03-ai-plan',
  '09-gfm-everything',
  '15-prose-volume',
];
const dir = new URL('../../../docs/taste-review/2026-09-marxy-128/', import.meta.url);

test('the five MARXY-20 pages exist as before/after pairs in dark and light', () => {
  for (const prefix of ['before', 'after']) {
    for (const variant of ['dark', 'light']) {
      for (const page of PAGES) {
        const name = `${prefix}-${variant}-${page}.png`;
        assert.ok(existsSync(new URL(name, dir)), `missing ${name}`);
      }
    }
  }
});

test('the taste-review queue names each of the six faults', () => {
  const queue = readFileSync(new URL('../../../docs/taste-review/queue.md', import.meta.url), 'utf8');
  assert.match(queue, /MARXY-128/);
  for (const fault of [
    'heading',
    'italic',
    'code-block',
    'quote',
    'checkbox',
    'table',
  ]) {
    assert.match(queue, new RegExp(fault, 'i'), `queue row does not name ${fault}`);
  }
});
