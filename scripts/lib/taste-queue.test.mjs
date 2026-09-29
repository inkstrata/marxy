// An optional taste-review entry is one file per story (MARXY-324).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QUEUE_DIR, queueFragmentPath, isQueueFragmentPath, queueFragmentKey, validQueueFragment, foldRows } from './taste-queue.mjs';
import { fold } from '../taste-queue.mjs';

const row = key => `| 2026-09-29 | ${key} | what a reader sees | \`x.png\` | is it right? | |`;

test('path helpers agree on the fragment shape and README is not a fragment', () => {
  assert.equal(queueFragmentPath('MARXY-1'), 'docs/taste-review/queue.d/MARXY-1.md');
  assert.ok(isQueueFragmentPath('docs/taste-review/queue.d/MARXY-1.md'));
  assert.ok(!isQueueFragmentPath('docs/taste-review/queue.d/README.md'));
  assert.ok(!isQueueFragmentPath('docs/taste-review/queue.md'));
  assert.equal(queueFragmentKey('docs/taste-review/queue.d/MARXY-1.md'), 'MARXY-1');
  assert.equal(QUEUE_DIR, 'docs/taste-review/queue.d');
});

test('validQueueFragment requires exactly one six-column row whose story cell is the key', () => {
  assert.ok(validQueueFragment(row('MARXY-1') + '\n', 'MARXY-1'));
  assert.ok(!validQueueFragment(row('MARXY-2'), 'MARXY-1'), 'wrong key');
  assert.ok(!validQueueFragment(`${row('MARXY-1')}\n${row('MARXY-1')}`, 'MARXY-1'), 'two lines');
  assert.ok(!validQueueFragment('| a | MARXY-1 | b |', 'MARXY-1'), 'wrong column count');
  assert.ok(!validQueueFragment('no table', 'MARXY-1'));
  assert.ok(!validQueueFragment('', 'MARXY-1'));
  assert.ok(!validQueueFragment('| --- | --- | --- | --- | --- | --- |', 'MARXY-1'));
});

const QUEUE = '# Taste review queue\n\n| Date | PR / story | a | b | c | Decision |\n| --- | --- | --- | --- | --- | --- |\n| 2026-09-18 | MARXY-9 | x | y | z | ok |\n\n## Review #0\n\nprose | with a pipe\n';

test('foldRows appends after the first table and touches nothing else', () => {
  const out = foldRows(QUEUE, [row('MARXY-1')]);
  assert.equal(out, QUEUE.replace('| ok |\n', `| ok |\n${row('MARXY-1')}\n`));
});

test('--fold appends every fragment in key order, deletes them, and touches no other byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-taste-fold-'));
  try {
    mkdirSync(join(dir, QUEUE_DIR), { recursive: true });
    writeFileSync(join(dir, 'docs/taste-review/queue.md'), QUEUE);
    writeFileSync(join(dir, QUEUE_DIR, 'README.md'), 'the rule\n');
    writeFileSync(join(dir, QUEUE_DIR, 'MARXY-10.md'), row('MARXY-10') + '\n');
    writeFileSync(join(dir, QUEUE_DIR, 'MARXY-2.md'), row('MARXY-2') + '\n');
    const got = fold({ root: dir });
    assert.equal(got.folded, 2);
    assert.equal(readFileSync(join(dir, 'docs/taste-review/queue.md'), 'utf8'),
      QUEUE.replace('| ok |\n', `| ok |\n${row('MARXY-2')}\n${row('MARXY-10')}\n`));
    assert.ok(!existsSync(join(dir, QUEUE_DIR, 'MARXY-2.md')));
    assert.ok(!existsSync(join(dir, QUEUE_DIR, 'MARXY-10.md')));
    assert.ok(existsSync(join(dir, QUEUE_DIR, 'README.md')), 'README stays');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--fold refuses a fragment that names the wrong key and changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-taste-fold-bad-'));
  try {
    mkdirSync(join(dir, QUEUE_DIR), { recursive: true });
    writeFileSync(join(dir, 'docs/taste-review/queue.md'), QUEUE);
    writeFileSync(join(dir, QUEUE_DIR, 'MARXY-1.md'), row('MARXY-2') + '\n');
    assert.throws(() => fold({ root: dir }), /not one queue table row for MARXY-1/);
    assert.equal(readFileSync(join(dir, 'docs/taste-review/queue.md'), 'utf8'), QUEUE);
    assert.ok(existsSync(join(dir, QUEUE_DIR, 'MARXY-1.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two branches that each add a queue.d fragment merge with no conflict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-taste-merge-'));
  try {
    const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(dir, QUEUE_DIR), { recursive: true });
    writeFileSync(join(dir, 'docs/taste-review/queue.md'), QUEUE);
    writeFileSync(join(dir, QUEUE_DIR, 'README.md'), 'the rule\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD').trim();
    git('checkout', '-q', '-b', 'story-a');
    writeFileSync(join(dir, QUEUE_DIR, 'MARXY-1.md'), row('MARXY-1') + '\n');
    git('add', '.');
    git('commit', '-q', '-m', 'a');
    const a = git('rev-parse', 'HEAD').trim();
    git('checkout', '-q', '-b', 'story-b', base);
    writeFileSync(join(dir, QUEUE_DIR, 'MARXY-2.md'), row('MARXY-2') + '\n');
    git('add', '.');
    git('commit', '-q', '-m', 'b');
    const b = git('rev-parse', 'HEAD').trim();
    const tree = git('merge-tree', '--write-tree', a, b);
    assert.ok(!/CONFLICT/.test(tree), `expected a clean merge, got:\n${tree}`);
    const listing = git('ls-tree', '-r', '--name-only', tree.trim().split('\n')[0]);
    assert.ok(listing.includes('queue.d/MARXY-1.md') && listing.includes('queue.d/MARXY-2.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
