// Parking a dirty orchestrator checkout (MARXY-223). The git fixtures are their own repos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendParkNote, parkBullet, parkDirtyBoard, parkStamp, planBoardPark } from './board-park.mjs';

const git = (root, args) => execFileSync('git', [
  '-C', root, '-c', 'user.email=board-park@marxy.local', '-c', 'user.name=board-park',
  '-c', 'commit.gpgsign=false', '-c', 'rerere.enabled=false', ...args,
], { encoding: 'utf8' });

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'marxy-park-'));
  git(root, ['init', '-q', '-b', 'main']);
  mkdirSync(join(root, 'orchestration'));
  writeFileSync(join(root, 'orchestration/ready.mjs'), 'export const v = 1;\n');
  writeFileSync(join(root, 'README.md'), 'readme\n');
  git(root, ['add', 'orchestration/ready.mjs', 'README.md']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

const NOW = new Date('2026-09-25T18:50:00Z');

test('planBoardPark parks tracked board edits on main and refuses off-main, unmerged, and clean', () => {
  assert.equal(planBoardPark({ branch: 'main', statusText: ' M orchestration/ready.mjs\n' }).park, true);
  assert.deepEqual(planBoardPark({ branch: 'main', statusText: ' M orchestration/ready.mjs\n?? orchestration/notes.md\n' }).files, ['orchestration/ready.mjs']);
  const off = planBoardPark({ branch: 'fix/x', statusText: ' M orchestration/ready.mjs\n' });
  assert.equal(off.park, false);
  assert.match(off.why, /not main/);
  const unmerged = planBoardPark({ branch: 'main', statusText: 'UU orchestration/ready.mjs\n' });
  assert.equal(unmerged.park, false);
  assert.match(unmerged.why, /unmerged: orchestration\/ready\.mjs/);
  assert.equal(planBoardPark({ branch: 'main', statusText: '' }).why, 'clean');
});

test('a second note for the same stash is the same text', () => {
  const bullet = parkBullet({ files: ['orchestration/ready.mjs'], stashMessage: parkStamp(NOW), patchPath: '/tmp/x.patch' });
  const once = appendParkNote('# Needs a human\n\n', bullet, parkStamp(NOW));
  assert.equal(appendParkNote(once, bullet, parkStamp(NOW)), once);
  assert.match(once, /git stash apply --index stash\^\{\/marxy-board-park 2026-09-25T18-50-00Z\}/);
});

test('a tracked orchestration edit is stashed, HEAD is restored, and stash apply brings it back', () => {
  const root = repo();
  const quarantineDir = mkdtempSync(join(tmpdir(), 'marxy-park-q-'));
  const needsHumanPath = join(root, 'needs-human.md');
  writeFileSync(needsHumanPath, '# Needs a human\n\n');
  writeFileSync(join(root, 'orchestration/ready.mjs'), 'export const v = 2;\n');
  writeFileSync(join(root, 'README.md'), 'changed\n');
  writeFileSync(join(root, 'orchestration/notes.md'), 'local\n');
  try {
    const parked = parkDirtyBoard({ root, quarantineDir, needsHumanPath, now: NOW });
    assert.equal(parked.parked, true);
    assert.deepEqual(parked.files, ['orchestration/ready.mjs']);
    assert.equal(parked.stashMessage, 'marxy-board-park 2026-09-25T18-50-00Z');
    assert.equal(readFileSync(join(root, 'orchestration/ready.mjs'), 'utf8'), 'export const v = 1;\n');
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'changed\n');
    assert.equal(readFileSync(join(root, 'orchestration/notes.md'), 'utf8'), 'local\n');
    const patch = readFileSync(parked.patchPath, 'utf8');
    assert.match(patch, /v = 2/);
    execFileSync('git', ['-C', root, 'apply', '--check', parked.patchPath]);
    const note = readFileSync(needsHumanPath, 'utf8');
    assert.match(note, /marxy-board-park 2026-09-25T18-50-00Z/);
    assert.equal(note.split('\n').filter(l => l.includes('Orchestrator checkout parked')).length, 1);
    git(root, ['stash', 'apply']);
    assert.equal(readFileSync(join(root, 'orchestration/ready.mjs'), 'utf8'), 'export const v = 2;\n');
    const again = parkDirtyBoard({ root, quarantineDir, needsHumanPath, now: new Date('2026-09-25T18:51:00Z') });
    assert.equal(again.parked, true);
    const notes = readFileSync(needsHumanPath, 'utf8');
    assert.match(notes, /18-50-00Z/);
    assert.match(notes, /18-51-00Z/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(quarantineDir, { recursive: true, force: true });
  }
});

test('staged and unstaged edits both come back from the stash', () => {
  const root = repo();
  const quarantineDir = mkdtempSync(join(tmpdir(), 'marxy-park-q-'));
  writeFileSync(join(root, 'orchestration/ready.mjs'), 'export const v = 2;\n');
  git(root, ['add', 'orchestration/ready.mjs']);
  writeFileSync(join(root, 'orchestration/ready.mjs'), 'export const v = 3;\n');
  try {
    const parked = parkDirtyBoard({ root, quarantineDir, now: NOW });
    assert.equal(parked.parked, true);
    assert.equal(readFileSync(join(root, 'orchestration/ready.mjs'), 'utf8'), 'export const v = 1;\n');
    git(root, ['stash', 'apply', '--index']);
    assert.equal(readFileSync(join(root, 'orchestration/ready.mjs'), 'utf8'), 'export const v = 3;\n');
    assert.match(git(root, ['diff', '--cached']), /v = 2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(quarantineDir, { recursive: true, force: true });
  }
});

test('an off-main checkout and an unmerged path are not parked', () => {
  const root = repo();
  const quarantineDir = mkdtempSync(join(tmpdir(), 'marxy-park-q-'));
  const needsHumanPath = join(root, 'needs-human.md');
  writeFileSync(needsHumanPath, '# Needs a human\n\n');
  try {
    git(root, ['checkout', '-q', '-b', 'side']);
    writeFileSync(join(root, 'orchestration/ready.mjs'), 'export const v = 2;\n');
    const off = parkDirtyBoard({ root, quarantineDir, needsHumanPath, now: NOW });
    assert.equal(off.parked, false);
    assert.match(off.why, /not main/);
    assert.equal(readFileSync(join(root, 'orchestration/ready.mjs'), 'utf8'), 'export const v = 2;\n');
    assert.equal(readFileSync(needsHumanPath, 'utf8'), '# Needs a human\n\n');

    git(root, ['checkout', '-q', '--', 'orchestration/ready.mjs']);
    git(root, ['checkout', '-q', 'main']);
    git(root, ['checkout', '-q', '-b', 'other']);
    writeFileSync(join(root, 'orchestration/ready.mjs'), 'export const v = 2;\n');
    git(root, ['commit', '-aq', '-m', 'other']);
    git(root, ['checkout', '-q', 'main']);
    writeFileSync(join(root, 'orchestration/ready.mjs'), 'export const v = 3;\n');
    git(root, ['commit', '-aq', '-m', 'main']);
    try { git(root, ['merge', 'other']); } catch { /* conflict is the point */ }
    const conflicted = parkDirtyBoard({ root, quarantineDir, needsHumanPath, now: NOW });
    assert.equal(conflicted.parked, false);
    assert.match(conflicted.why, /unmerged/);
    assert.match(readFileSync(join(root, 'orchestration/ready.mjs'), 'utf8'), /<<<<<<</);
    assert.equal(git(root, ['stash', 'list']).trim(), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(quarantineDir, { recursive: true, force: true });
  }
});
