// Position is a source-map coordinate across reload (ADR-0018); stale bytes must not win a save.

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { blockAt, followPath, restorePosition } from './restore.ts';
import { applyWatchToOpenDocument, reloadOpenDocument } from './reload.ts';
import { staleWriteError } from './stale-write.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const longTechnical = () => new Uint8Array(readFileSync(new URL('01-long-technical.md', corpus)));

test('after a reload the first visible block byteOffset is unchanged', () => {
  const bytes = longTechnical();
  const document = parseMarkdown(bytes, { file: '01-long-technical.md' });
  const heading = document.children.find((block) => block.type === 'heading' && block.level === 2);
  assert.ok(heading, 'the long fixture lost its second-level headings');
  const previous = {
    path: '01-long-technical.md',
    byteOffset: heading.src.start,
    fraction: 0.25,
    mode: 'rendered' as const,
  };
  const reloaded = reloadOpenDocument(bytes, previous);
  assert.equal(reloaded.position.byteOffset, previous.byteOffset);
  assert.equal(blockAt(reloaded.document, reloaded.position.byteOffset)?.src.start, heading.src.start);
});

test('a rewrite that shifts later blocks still keeps the stored byteOffset', () => {
  const original = parseMarkdown('# Title\n\nFirst.\n\nSecond.\n', { file: 'n.md' });
  const second = original.children.find((block) => block.type === 'paragraph' && block.src.start > 10);
  assert.ok(second);
  const previous = { path: 'n.md', byteOffset: second.src.start, fraction: 0, mode: 'rendered' as const };
  const restored = restorePosition(previous, parseMarkdown('# Title\n\nInserted.\n\nFirst.\n\nSecond.\n', { file: 'n.md' }));
  assert.equal(restored.byteOffset, previous.byteOffset);
});

function saveIfFresh(path: string, expected: Uint8Array, next: Uint8Array): void {
  const error = staleWriteError(path, expected, new Uint8Array(readFileSync(path)));
  if (error) throw new Error(error);
  writeFileSync(path, next);
}

test('a save is refused when another process replaced the file between open and save', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-34-stale-'));
  const path = join(dir, 'doc.md');
  try {
    const opened = Buffer.from('# notes\n\nread by marxy\n');
    writeFileSync(path, opened);
    const expected = new Uint8Array(readFileSync(path));
    // Another process (an editor, an agent) writes the file the reader still holds.
    writeFileSync(path, Buffer.from('# notes\n\nwritten by someone else\n'));
    const readerWantsToSave = Buffer.from('# notes\n\nread by marxy\n\nand then edited\n');
    assert.throws(() => saveIfFresh(path, expected, readerWantsToSave), /refusing to overwrite/);
    assert.equal(readFileSync(path).toString(), '# notes\n\nwritten by someone else\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a save proceeds when the file on disk is still the bytes that were read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-34-fresh-'));
  const path = join(dir, 'doc.md');
  try {
    const expected = Buffer.from('# notes\n\nread by marxy\n');
    writeFileSync(path, expected);
    saveIfFresh(path, new Uint8Array(expected), Buffer.from('# notes\n\nread by marxy\n\nand then edited\n'));
    assert.equal(readFileSync(path).toString(), '# notes\n\nread by marxy\n\nand then edited\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a move while open follows the path and keeps the byteOffset', () => {
  const previous = { path: '/root/open.md', byteOffset: 12, fraction: 0.5, mode: 'rendered' as const };
  const followed = followPath(previous, '/root/moved.md');
  assert.equal(followed.byteOffset, 12);
  assert.equal(followed.path, '/root/moved.md');
});

test('a watch batch that deletes the open file marks it gone', () => {
  const previous = { path: '/root/open.md', byteOffset: 0, fraction: 0, mode: 'rendered' as const };
  assert.deepEqual(applyWatchToOpenDocument([{ kind: 'removed', path: '/root/open.md' }], previous, null), {
    action: 'gone',
  });
});

test('a watch batch that rewrites the open file reloads and keeps the byteOffset', () => {
  const bytes = longTechnical();
  const document = parseMarkdown(bytes, { file: '/root/01-long-technical.md' });
  const heading = document.children.find((block) => block.type === 'heading' && block.level === 2);
  assert.ok(heading);
  const previous = {
    path: '/root/01-long-technical.md',
    byteOffset: heading.src.start,
    fraction: 0.25,
    mode: 'rendered' as const,
  };
  const update = applyWatchToOpenDocument(
    [{ kind: 'modified', path: '/root/01-long-technical.md' }],
    previous,
    bytes,
  );
  assert.equal(update.action, 'reload');
  if (update.action === 'reload') {
    assert.equal(update.position.byteOffset, previous.byteOffset);
    assert.equal(blockAt(update.document, update.position.byteOffset)?.src.start, heading.src.start);
  }
});
