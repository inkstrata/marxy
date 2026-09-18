// The four write shapes watching must see while a document is open (ADR-0018).

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diffSnapshots, type DirSnapshot, type FileIdentity } from './snapshot.ts';
import { effectForOpenDocument } from './watch-events.ts';

function identity(path: string): FileIdentity {
  const stat = statSync(path);
  return { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino };
}

function snapshot(paths: readonly string[]): DirSnapshot {
  const out: Record<string, FileIdentity> = {};
  for (const path of paths) out[path] = identity(path);
  return out;
}

function scratch(): { dir: string; open: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-34-watch-'));
  const open = join(dir, 'open.md');
  writeFileSync(open, '# open\n\nbody\n');
  return { dir, open, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('an in-place write while open reloads the document', () => {
  const { open, done } = scratch();
  try {
    const before = snapshot([open]);
    writeFileSync(open, '# open\n\nbody rewritten in place\n');
    const events = diffSnapshots(before, snapshot([open]));
    assert.equal(effectForOpenDocument(events, open).action, 'reload');
    assert.ok(events.some((event) => event.kind === 'modified' && event.path === open), JSON.stringify(events));
  } finally {
    done();
  }
});

test('a write-temp-then-rename while open reloads the document', () => {
  const { dir, open, done } = scratch();
  try {
    const before = snapshot([open]);
    const tmp = join(dir, '.open.md.tmp');
    writeFileSync(tmp, '# open\n\natomic replacement\n');
    renameSync(tmp, open);
    const events = diffSnapshots(before, snapshot([open]));
    assert.equal(effectForOpenDocument(events, open).action, 'reload');
    assert.ok(
      events.some((event) => event.kind === 'renamed' && event.path === open && event.to === undefined),
      JSON.stringify(events),
    );
  } finally {
    done();
  }
});

test('a delete while open marks the document gone', () => {
  const { open, done } = scratch();
  try {
    const before = snapshot([open]);
    unlinkSync(open);
    const events = diffSnapshots(before, {});
    assert.deepEqual(effectForOpenDocument(events, open), { action: 'gone' });
    assert.ok(events.some((event) => event.kind === 'removed' && event.path === open), JSON.stringify(events));
  } finally {
    done();
  }
});

test('a move while open follows the new path', () => {
  const { dir, open, done } = scratch();
  try {
    const dest = join(dir, 'moved.md');
    const before = snapshot([open]);
    renameSync(open, dest);
    const events = diffSnapshots(before, snapshot([dest]));
    assert.deepEqual(effectForOpenDocument(events, open), { action: 'follow', path: dest });
    assert.ok(
      events.some((event) => event.kind === 'renamed' && event.path === open && event.to === dest),
      JSON.stringify(events),
    );
  } finally {
    done();
  }
});

test('events for other files do not disturb the open document', () => {
  const { dir, open, done } = scratch();
  try {
    const other = join(dir, 'other.md');
    writeFileSync(other, 'x\n');
    mkdirSync(join(dir, 'sub'));
    const events = diffSnapshots(snapshot([open]), snapshot([open, other]));
    assert.equal(effectForOpenDocument(events, open).action, 'ignore');
  } finally {
    done();
  }
});

test('a move that also looks like a delete follows rather than treating the file as gone', () => {
  const open = '/root/open.md';
  const dest = '/root/moved.md';
  const effect = effectForOpenDocument(
    [
      { kind: 'removed', path: open },
      { kind: 'renamed', path: open, to: dest },
    ],
    open,
  );
  assert.deepEqual(effect, { action: 'follow', path: dest });
});
