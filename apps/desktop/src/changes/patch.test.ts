import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { changesOf, changesWords, NO_CHANGES } from './patch.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Applies a patch `changesOf` made to `before`, as `patch` would: proves it says every byte. */
function applyPatch(before: string, patch: string): string {
  const old = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const lines = patch.split('\n');
  const out: string[] = [];
  let i = 0;
  let k = 2;
  while (k < lines.length) {
    const h = /^@@ -(\d+)(?:,(\d+))? /.exec(lines[k]!);
    if (!h) {
      k++;
      continue;
    }
    const start = Number(h[1]) - (h[2] === '0' ? 0 : 1);
    while (i < start) out.push(old[i++]!);
    k++;
    while (k < lines.length && !lines[k]!.startsWith('@@')) {
      const l = lines[k]!;
      const noEol = lines[k + 1]?.startsWith('\\') === true;
      const body = l.slice(1) + (noEol ? '' : '\n');
      if (l.startsWith(' ')) {
        out.push(old[i++]!);
      } else if (l.startsWith('-')) i++;
      else if (l.startsWith('+')) out.push(body);
      k += noEol ? 2 : 1;
    }
  }
  while (i < old.length) out.push(old[i++]!);
  return out.join('');
}

test('no changes: the same bytes, or a buffer that equals its disk', () => {
  assert.equal(changesOf('a.md', enc('x\n'), enc('x\n')), NO_CHANGES);
});

test('one place: counts, the buffer line it marks, and the patch applies back byte for byte', () => {
  const disk = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n';
  const now = disk.replace('four', 'FOUR');
  const c = changesOf('/r/a.md', enc(disk), enc(now))!;
  assert.equal(c.places, 1);
  assert.equal(c.added, 1);
  assert.equal(c.removed, 1);
  assert.deepEqual(c.lines, [3]);
  assert.match(c.patch, /^--- \/r\/a\.md\n\+\+\+ \/r\/a\.md\n@@ -1,7 \+1,7 @@\n/);
  assert.equal(applyPatch(disk, c.patch), now);
  assert.equal(changesWords(c), 'changed in 1 place, +1 −1 lines');
});

test('two places far apart are two hunks; an added line and a removed one', () => {
  const disk = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const lines = disk.split('\n');
  lines.splice(2, 0, 'inserted');
  lines.splice(26, 1);
  const now = lines.join('\n');
  const c = changesOf('a.md', enc(disk), enc(now))!;
  assert.equal(c.places, 2);
  assert.deepEqual([c.added, c.removed], [1, 1]);
  assert.deepEqual(c.lines, [2]);
  assert.equal(applyPatch(disk, c.patch), now);
});

test('CRLF lines keep their CR, and a missing final newline is said', () => {
  const disk = 'a\r\nb\r\nc';
  const now = 'a\r\nB\r\nc';
  const c = changesOf('a.md', enc(disk), enc(now))!;
  assert.ok(c.patch.includes('-b\r\n+B\r\n'), 'the CR stays on its line');
  assert.equal(applyPatch(disk, c.patch), now);
  const grown = changesOf('a.md', enc(disk), enc('a\r\nb\r\nc\n'))!;
  assert.ok(grown.patch.includes('-c\n\\ No newline at end of file\n+c\n'));
  assert.equal(applyPatch(disk, grown.patch), 'a\r\nb\r\nc\n');
});

test('a document never written compares against nothing', () => {
  const c = changesOf('untitled', null, enc('new\n'))!;
  assert.deepEqual([c.places, c.added, c.removed], [1, 1, 0]);
  assert.deepEqual(c.lines, [0]);
});
