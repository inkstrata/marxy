// node --test .claude/skills/resolve-taste-queue/test.mjs — runs against a synthetic queue in a temp
// copy of the repo's own taste-queue scripts, so a format change there shows up here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRows, finish, inside } from './lib.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const HEAD = '| Date | PR / story | What the reader would notice | Artifacts | Question for the reviewer | Decision |\n| --- | --- | --- | --- | --- | --- |';
const row = (d, k, dec = '') => `| ${d} | ${k} | notice for ${k} | \`docs/x.png\` | Q for ${k}? (Default: yes.) | ${dec} |`;

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'taste-'));
  for (const p of ['scripts/taste-queue.mjs', 'scripts/lib']) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    cpSync(join(repo, p), join(root, p), { recursive: true });
  }
  mkdirSync(join(root, 'docs/taste-review/queue.d'), { recursive: true });
  for (const n of [0, 1, 2]) mkdirSync(join(root, `docs/taste-review/2026-09-review-${n}`), { recursive: true });
  writeFileSync(join(root, 'docs/taste-review/queue.md'), `# Queue\n\n${HEAD}\n${row('2026-10-01', 'A-1')}\n${row('2026-10-01', 'A-2', '**Fine.** ok')}\n${row('2026-10-01', 'A-3', '**Deferred.** later `x/decisions.md`')}\n\n## Notes\n`);
  writeFileSync(join(root, 'docs/taste-review/queue.d/A-4.md'), row('2026-10-02', 'A-4') + '\n');
  writeFileSync(join(root, 'docs/taste-review/queue.d/C-1.md'), '# C-1 — prose\n\nLook at it:\n\n- is it quiet?\n');
  return root;
}

test('rows parse: ids, defaults, fragments, prose fragments', async () => {
  const rows = await loadRows(sandbox());
  assert.deepEqual(rows.map(r => r.key).sort(), ['A-1', 'A-2', 'A-3', 'A-4', 'C-1']);
  assert.equal(rows[0].default, 'yes.');
  assert.equal(rows.find(r => r.key === 'A-4').source, 'queue.d/A-4.md');
  assert.equal(rows.find(r => r.key === 'C-1').malformed, true);
});

test('finish folds fragments, fills Decision cells, keeps prose fragments, writes decisions.md', async () => {
  const root = sandbox();
  const out = await finish(root, { '2026-10-01|A-1': { verdict: 'tune', note: 'too loud | a bit' }, '2026-10-02|A-4': { verdict: 'fine', note: '' }, '2026-10-01|A-3': { verdict: 'fine', note: 'must not apply' } }, { today: '2026-10-10' });
  assert.equal(out.folder, '2026-10-review-3');
  assert.equal(out.decided, 2);
  const q = readFileSync(join(root, 'docs/taste-review/queue.md'), 'utf8');
  assert.match(q, /\*\*Tune\.\*\* too loud \\\| a bit `2026-10-review-3\/decisions.md` \|/);
  assert.match(q, /\| A-4 \|.*\*\*Fine\.\*\* `2026-10-review-3\/decisions.md` \|/);
  assert.match(q, /A-3 .*\*\*Deferred\.\*\* later/, 'a decided row is never overwritten');
  assert.ok(!existsSync(join(root, 'docs/taste-review/queue.d/A-4.md')), 'folded fragment removed');
  assert.ok(existsSync(join(root, 'docs/taste-review/queue.d/C-1.md')), 'prose fragment left in place');
  assert.match(readFileSync(join(root, out.file), 'utf8'), /## A-1 — /);
});

test('re-review: a deferred row reopens and is replaced, with its earlier note kept', async () => {
  const root = sandbox();
  const rows = await loadRows(root, { redoDeferred: true });
  const a3 = rows.find(r => r.key === 'A-3');
  assert.equal(a3.decision, '');
  assert.match(a3.previous, /Deferred/);
  const out = await finish(root, { [a3.id]: { verdict: 'change', note: 'no' } }, { today: '2026-10-10', redoDeferred: true });
  assert.equal(out.decided, 1);
  assert.match(readFileSync(join(root, 'docs/taste-review/queue.md'), 'utf8'), /A-3 \|.*\*\*Change\.\*\* no/);
});

test('inside() refuses escapes', () => {
  assert.equal(inside('/a/b', 'c/d.png'), true);
  assert.equal(inside('/a/b', '../x'), false);
  assert.equal(inside('/a/b', '/etc/passwd'), false);
});
