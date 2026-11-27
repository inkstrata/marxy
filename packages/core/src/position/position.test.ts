// Position is a source-map coordinate across reload; stale bytes must not win a save.

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { followPath, restorePosition } from './restore.ts';
import { staleWriteError } from './stale-write.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const longTechnical = () => new Uint8Array(readFileSync(new URL('01-long-technical.md', corpus)));

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
