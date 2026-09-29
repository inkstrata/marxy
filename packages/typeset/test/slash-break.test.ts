// Long inline paths break after `/` in a third pass only (MARXY-239).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { insertSlashBreaks } from '../src/slash-break.ts';
import type { Piece } from '../src/runs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');

function codePiece(data: string): Piece {
  const node = {
    data,
    parentElement: { closest: (sel: string) => (sel.includes('code') ? {} : null) },
  } as Text & { parentElement: Element };
  return {
    kind: 'piece',
    text: data,
    segments: [{ node, start: 0, end: data.length }],
  };
}

test('insertSlashBreaks adds dash opportunities only after slashes in code', () => {
  const tokens = insertSlashBreaks([codePiece('/usr/local/file-name.ts')]);
  const dashes = tokens.filter((t) => t.kind === 'dash');
  assert.equal(dashes.length, 3);
  assert.ok(tokens.some((t) => t.kind === 'piece' && t.text === 'file-name.ts'));
  assert.ok(!tokens.some((t) => t.kind === 'dash' && t.node.data[t.offset - 1] === '-'));
  for (const token of tokens) {
    if (token.kind !== 'piece') continue;
    assert.equal(token.segments.length, 1);
    assert.equal(token.text, token.segments[0]!.node.data.slice(token.segments[0]!.start, token.segments[0]!.end));
  }
});

test('a path that fits never gains slash breaks', () => {
  assert.equal(insertSlashBreaks([codePiece('short')]).length, 1);
});

test('slash breaks are a third pass after an overfull first choose', () => {
  const src = readFileSync(join(pkg, 'src/index.ts'), 'utf8');
  const first = src.indexOf('let broken = choose(');
  const gate = src.indexOf('if (broken === null)');
  const retry = src.indexOf('tokens = insertSlashBreaks');
  assert.ok(first !== -1 && gate !== -1 && retry !== -1);
  assert.ok(first < gate && gate < retry, 'insertSlashBreaks must run only after the first choose fails');
  assert.equal(src.split('insertSlashBreaks(').length - 1, 1);
});

test('corpus rag overfull count in RESEARCH.md does not rise', () => {
  const baseline = readFileSync(join(pkg, 'RESEARCH.md'), 'utf8');
  const start = baseline.indexOf('| Document | Paras | Engine |');
  const end = baseline.indexOf('The third block is the one to read');
  assert.ok(start !== -1 && end > start);
  let overfull = 0;
  for (const line of baseline.slice(start, end).split('\n')) {
    if (!line.includes('justif/core')) continue;
    const cells = line.split('|').map((s) => s.trim()).filter(Boolean);
    const n = Number(cells.at(-1));
    if (Number.isFinite(n)) overfull += n;
  }
  assert.ok(overfull <= 8, `justif/core overfull ${overfull} rose above the published ceiling`);
});
