// node --test .claude/skills/resolve-taste-queue/test.mjs — runs finish() against a temp copy of the real queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRows, finish, inside } from './lib.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'taste-'));
  for (const p of ['docs/taste-review/queue.md', 'docs/taste-review/queue.d', 'scripts/taste-queue.mjs', 'scripts/lib']) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    cpSync(join(repo, p), join(root, p), { recursive: true });
  }
  for (const n of [0, 1, 2]) mkdirSync(join(root, `docs/taste-review/2026-09-review-${n}`), { recursive: true });
  return root;
}

test('rows parse with ids, defaults and fragments', async () => {
  const rows = await loadRows(repo);
  assert.ok(rows.length > 50);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length, 'ids are unique');
  assert.ok(rows.some(r => r.source.startsWith('queue.d/')));
  assert.equal(rows.find(r => r.key === 'C-12')?.malformed, true);
  assert.equal(rows.find(r => r.key === 'MARXY-236').default?.startsWith('1ch hairline'), true);
});

test('finish folds fragments, fills Decision cells and writes decisions.md', async () => {
  const root = sandbox();
  const rows = await loadRows(root);
  const open = rows.filter(r => !r.decision);
  const frag = open.find(r => r.source.startsWith('queue.d/'));
  const tbl = open.find(r => r.source === 'queue.md');
  const out = await finish(root, { [tbl.id]: { verdict: 'tune', note: 'too loud | a bit' }, [frag.id]: { verdict: 'fine', note: '' } }, { today: '2026-10-10' });
  assert.equal(out.folder, '2026-10-review-3');
  assert.equal(out.decided, 2);
  const q = readFileSync(join(root, 'docs/taste-review/queue.md'), 'utf8');
  assert.match(q, /\*\*Tune\.\*\* too loud \\\| a bit `2026-10-review-3\/decisions.md` \|/);
  assert.ok(q.includes(`| ${frag.key} |`), 'fragment row was folded');
  assert.ok(!existsSync(join(root, 'docs/taste-review/queue.d', frag.source.replace('queue.d/', ''))));
  const after = await loadRows(root);
  assert.equal(after.filter(r => !r.decision).length, open.length - 2);
  assert.ok(existsSync(join(root, 'docs/taste-review/queue.d/C-12.md')), 'prose fragment is left in place');
  assert.match(readFileSync(join(root, out.file), 'utf8'), /## .* — /);
});

test('inside() refuses escapes', () => {
  assert.equal(inside('/a/b', 'c/d.png'), true);
  assert.equal(inside('/a/b', '../x'), false);
  assert.equal(inside('/a/b', '/etc/passwd'), false);
});
