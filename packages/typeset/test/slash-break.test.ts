// Long inline paths break after `/` in a third pass only (MARXY-239).
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { insertSlashBreaks } from '../src/slash-break.ts';
import type { Piece } from '../src/runs.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('insertSlashBreaks adds dash opportunities only after slashes in code', () => {
  const node = {
    data: '/usr/local/lib/pkg/file-name.ts',
    parentElement: { closest: (sel: string) => (sel.includes('code') ? {} : null) },
  } as Text & { parentElement: Element };
  const piece: Piece = {
    kind: 'piece',
    text: node.data,
    segments: [{ node, start: 0, end: node.data.length }],
  };
  const tokens = insertSlashBreaks([piece]);
  const dashes = tokens.filter((t) => t.kind === 'dash');
  assert.equal(dashes.length, 3);
  assert.ok(!tokens.some((t) => t.kind === 'piece' && t.text.includes('-name')));
});

test('a path that fits never gains slash breaks', () => {
  const node = {
    data: 'short',
    parentElement: { closest: (sel: string) => (sel.includes('code') ? {} : null) },
  } as Text & { parentElement: Element };
  const piece: Piece = { kind: 'piece', text: 'short', segments: [{ node, start: 0, end: 5 }] };
  assert.equal(insertSlashBreaks([piece]).length, 1);
});

test('corpus rag overfull count does not rise after slash breaks', () => {
  const baselinePath = join(repoRoot, 'packages/typeset/RESEARCH.md');
  const baseline = readFileSync(baselinePath, 'utf8');
  const match = baseline.match(/\| webkit-macos ragged \|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\| (\d+) \|/);
  const before = match ? Number(match[1]) : 0;
  const out = execFileSync('node', ['packages/typeset/scripts/measure-rag.mjs'], { cwd: repoRoot, encoding: 'utf8' });
  const row = out.split('\n').find((line) => line.includes('webkit-macos ragged'));
  const after = row ? Number(row.split('|').map((s) => s.trim()).filter(Boolean).pop()) : before;
  assert.ok(after <= before, `overfull ${after} rose above baseline ${before}`);
});
