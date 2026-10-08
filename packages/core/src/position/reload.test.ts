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

test('text inserted at a held heading\'s first byte moves the position with the heading (F-19)', () => {
  const enc = new TextEncoder();
  const before = enc.encode('# One\n\nintro\n\n## Two\n\nbody\n');
  const held = before.length - enc.encode('## Two\n\nbody\n').length;
  const previous = { path: 'x.md', byteOffset: held, fraction: 0, mode: 'rendered' as const };
  const insert = (text: string): Uint8Array => {
    const bits = enc.encode(text);
    const out = new Uint8Array(before.length + bits.length);
    out.set(before.subarray(0, held), 0);
    out.set(bits, held);
    out.set(before.subarray(held), held + bits.length);
    return out;
  };
  for (const text of ['Inserted paragraph.\n\n', '## Fresh\n\nnew\n\n']) {
    const next = insert(text);
    const reloaded = reloadOpenDocument(next, previous, before);
    assert.equal(reloaded.position.byteOffset, held + enc.encode(text).length, JSON.stringify(text));
    const block = reloaded.document.children.find((b) => b.src.start === reloaded.position.byteOffset);
    assert.equal(block?.type, 'heading', 'the offset names the heading the reader was at');
  }
  // Inserted text that runs into the heading line is no longer a block start there: kept as before.
  const glued = reloadOpenDocument(insert('glued '), previous, before);
  assert.equal(glued.position.byteOffset, held);
});

test('text inserted inside a held heading keeps the offset at the heading start (F-19)', () => {
  const enc = new TextEncoder();
  const before = enc.encode('# One\n\nintro\n\n## Two\n\nbody\n');
  const next = enc.encode('# One\n\nintro\n\n## Two and a half\n\nbody\n');
  const held = enc.encode('# One\n\nintro\n\n').length;
  const previous = { path: 'x.md', byteOffset: held, fraction: 0, mode: 'rendered' as const };
  assert.equal(reloadOpenDocument(next, previous, before).position.byteOffset, held);
});

/** `source` with `text` spliced in at `marker`, held at `marker`, reloaded: where the position lands. */
function insertedAt(source: string, marker: string, text: string): { landed: number; held: number; next: string } {
  const enc = new TextEncoder();
  const at = source.indexOf(marker);
  const held = enc.encode(source.slice(0, at)).length;
  const next = enc.encode(source.slice(0, at) + text + source.slice(at));
  const previous = { path: 'x.md', byteOffset: held, fraction: 0, mode: 'rendered' as const };
  return {
    landed: reloadOpenDocument(next, previous, enc.encode(source)).position.byteOffset,
    held,
    next: new TextDecoder().decode(next),
  };
}

test('a reader held at offset 0 stays at the top when text is prepended (F-19.1)', () => {
  for (const text of ['Preface.\n\n', '# Title\n\n']) {
    const r = insertedAt('# One\n\nintro\n', '# One', text);
    assert.equal(r.held, 0);
    assert.equal(r.landed, 0, JSON.stringify(text));
  }
});

test('a held nested list item follows text inserted where it begins (F-19.1)', () => {
  const r = insertedAt('- a\n  - b\n  - c\n\nafter\n', '- c', '- new\n  ');
  assert.equal(r.landed, r.held + '- new\n  '.length);
  assert.equal(r.next.slice(r.landed, r.landed + 3), '- c');
});

test('a held fence in a list follows text inserted where it begins (F-19.1)', () => {
  const r = insertedAt('- item\n\n  ```js\n  let a;\n  ```\n\nafter\n', '```js', 'More text.\n\n  ');
  assert.equal(r.landed, r.held + 'More text.\n\n  '.length);
  assert.equal(r.next.slice(r.landed, r.landed + 5), '```js');
});
