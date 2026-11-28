import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-state-'));
process.env.MARXY_STATE_DIR = path.join(tmp, 'state');
const { appendJsonl, readJsonl, publish, readPublished, listPublished, attribution } = await import('./state.mjs');

test('jsonl appends, reads and limits', () => {
  appendJsonl('t', { a: 1 });
  appendJsonl('t', { a: 2 });
  appendJsonl('t', { a: 3 });
  assert.deepEqual(readJsonl('t').map((r) => r.a), [1, 2, 3]);
  assert.deepEqual(readJsonl('t', { limit: 2 }).map((r) => r.a), [2, 3]);
  assert.deepEqual(readJsonl('missing'), []);
});

test('publish creates the orphan branch, commits, skips no-ops and rejoins a moved remote', () => {
  const remote = path.join(tmp, 'remote.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
  const a = { remoteUrl: remote, dir: path.join(tmp, 'a') };
  const b = { remoteUrl: remote, dir: path.join(tmp, 'b') };

  assert.equal(listPublished('nights', a).length, 0);
  assert.equal(publish({ 'nights/2026-11-27-nightly.md': 'one' }, 'first', a), true);
  assert.equal(readPublished('README.md', a).startsWith('# auto-state'), true);
  assert.equal(publish({ 'nights/2026-11-27-nightly.md': 'one' }, 'same', a), false);

  // A second clone publishes while the first is behind; the first then has to rebase.
  assert.equal(publish({ 'dashboard.md': 'from b' }, 'b', b), true);
  assert.equal(publish({ 'nights/2026-11-28-nightly.md': 'two' }, 'again', a), true);
  assert.equal(readPublished('dashboard.md', a), 'from b');
  assert.equal(readPublished('nope.md', a), null);
  assert.deepEqual(listPublished('nights', b), ['2026-11-27-nightly.md', '2026-11-28-nightly.md']);
});

test('reading never creates the branch', () => {
  const remote = path.join(tmp, 'empty.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
  assert.equal(readPublished('x.md', { remoteUrl: remote, dir: path.join(tmp, 'c') }), null);
  assert.equal(execFileSync('git', ['--git-dir', remote, 'branch', '--list'], { encoding: 'utf8' }).trim(), '');
});

test('attribution counts only weekly growth inside run pairs since the reset', () => {
  const at = (h) => `2026-11-27T${String(h).padStart(2, '0')}:00:00Z`;
  const u = (p) => ({ weekly: { pct: p } });
  const runs = [
    { at: at(1), event: 'start', run: 'old', usage: u(5) },
    { at: at(2), event: 'end', run: 'old', usage: u(9) },
    { at: at(11), event: 'start', run: 'r1', usage: u(20) },
    { at: at(13), event: 'end', run: 'r1', usage: u(26) },
    { at: at(14), event: 'start', run: 'r2', usage: u(26) },
  ];
  const r = attribution(runs, 40, new Date(at(10)));
  assert.deepEqual(r, { autoPct: 6, ownerPct: 34, totalPct: 40 });
  assert.equal(attribution([], null, new Date(at(10))).ownerPct, null);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
