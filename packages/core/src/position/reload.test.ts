// Live-reload of 01-long-technical.md must stay under the 100 ms product budget (ADR-0013).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { reloadOpenDocument } from './reload.ts';

const bytes = new Uint8Array(
  readFileSync(new URL('../../../../fixtures/corpus/01-long-technical.md', import.meta.url)),
);

/**
 * Shared CI runners are several times slower than the machine the 100 ms budget was set on.
 * The workload matches a reload: decode, walk, and allocate a small tree.
 */
const PROBE_REFERENCE_MS = 4.3;

function machineFactor(): number {
  const words = 'the quick brown fox jumps over the lazy dog'.split(' ');
  const run = (): number => {
    const started = performance.now();
    let sink = 0;
    for (let round = 0; round < 3000; round++) {
      let line = '';
      for (const word of words) line += `${word} *${word}* \`${word}\` `;
      for (const match of line.matchAll(/[*`]\w+[*`]/g)) sink += match.index;
      sink += line.split(/\s+/).map((word) => ({ word, length: word.length })).filter((token) => token.length > 3).length;
    }
    return performance.now() - started;
  };
  run();
  const runs = [run(), run(), run(), run(), run()].sort((a, b) => a - b);
  return Math.max(1, runs[2]! / PROBE_REFERENCE_MS);
}

test('reload of 01-long-technical.md stays under 100 ms and keeps the byteOffset', () => {
  const document = parseMarkdown(bytes, { file: '01-long-technical.md' });
  const first = document.children[0];
  assert.ok(first);
  const previous = {
    path: '01-long-technical.md',
    byteOffset: first.src.start,
    fraction: 0,
    mode: 'rendered' as const,
  };
  for (let warmup = 0; warmup < 10; warmup++) reloadOpenDocument(bytes, previous);
  const runs: number[] = [];
  for (let i = 0; i < 15; i++) {
    const started = performance.now();
    const reloaded = reloadOpenDocument(bytes, previous);
    runs.push(performance.now() - started);
    assert.equal(reloaded.position.byteOffset, previous.byteOffset);
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)]!;
  const factor = machineFactor();
  const budget = 100 * factor;
  console.log(
    `reload 01-long-technical.md: ${median.toFixed(2)} ms median, machine ${factor.toFixed(2)}× the reference, budget ${budget.toFixed(1)} ms`,
  );
  assert.ok(
    median < budget,
    `reload took ${median.toFixed(2)} ms (median of ${runs.length}); budget is 100 ms on the reference machine, ${budget.toFixed(1)} ms on this one`,
  );
});

test('an edit above the reader moves the byteOffset with the text, not the bytes', () => {
  const document = parseMarkdown(bytes, { file: '01-long-technical.md' });
  const reading = document.children[Math.floor(document.children.length / 2)]!;
  const previous = { path: '01-long-technical.md', byteOffset: reading.src.start, fraction: 0.25, mode: 'rendered' as const };
  const inserted = new TextEncoder().encode('## Inserted by an agent\n\nA new paragraph above the reader.\n\n');
  const next = new Uint8Array(bytes.length + inserted.length);
  next.set(bytes.subarray(0, 10), 0);
  next.set(inserted, 10);
  next.set(bytes.subarray(10), 10 + inserted.length);
  const reloaded = reloadOpenDocument(next, previous, bytes);
  assert.equal(reloaded.position.byteOffset, reading.src.start + inserted.length);
  assert.equal(reloaded.position.fraction, 0.25);
  const same = reloaded.document.children.find((block) => block.src.start === reloaded.position.byteOffset);
  assert.equal(same?.type, reading.type, 'the offset still names the block the reader was in');
});

test('an edit below the reader leaves the byteOffset alone; one inside it lands at its start', () => {
  const before = new TextEncoder().encode('aaaa\n\nbbbb\n\ncccc\n');
  const below = new TextEncoder().encode('aaaa\n\nbbbb\n\ncccc and more\n');
  const inside = new TextEncoder().encode('aaaa\n\nbXXXXb\n\ncccc\n');
  const previous = { path: 'x.md', byteOffset: 8, fraction: 0, mode: 'rendered' as const };
  assert.equal(reloadOpenDocument(below, previous, before).position.byteOffset, 8);
  assert.equal(reloadOpenDocument(inside, previous, before).position.byteOffset, 7);
  assert.equal(reloadOpenDocument(below, previous).position.byteOffset, 8, 'no previous bytes: offset kept as before');
});
