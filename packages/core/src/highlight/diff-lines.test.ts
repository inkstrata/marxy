// K-09: a diff file is read hunk by hunk; a line's meaning comes from where it is, not from how it begins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIFF_LINE_ADD as A, DIFF_LINE_DEL as D } from './line-classes.ts';
import { DIFF_OUTSIDE, diffFileLineClasses, diffFileRead } from './diff-lines.ts';

const read = (text: string) => diffFileLineClasses(text.split(/\r\n|\r|\n/));
const U = undefined;

test('inside a hunk the first column decides: a removed `---` and a removed `-- comment` are removals', () => {
  const lines = ['--- a/x.md', '+++ b/x.md', '@@ -1,4 +1,2 @@', ' keep', '----', '--- not a header', '-- sql comment', '+new'];
  assert.deepEqual(diffFileLineClasses(lines).slice(3), [U, D, D, D, A]);
  assert.deepEqual(diffFileLineClasses(lines).slice(0, 3), [U, U, U], 'file headers and the hunk header are plain');
});

test('an added `++x` and `+++x` are additions', () => {
  assert.deepEqual(read('@@ -0,0 +1,2 @@\n++x\n+++x'), [U, A, A]);
});

test('a format-patch ends with a `-- ` signature that is not a removal, and its email headers are plain', () => {
  const patch = ['From abc Mon Sep 17 00:00:00 2001', 'Subject: [PATCH] fix', '---', ' a | 2 +-', '', 'diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1 +1 @@', '-old', '+new', '-- ', '2.44.0', ''].join('\n');
  assert.deepEqual(read(patch), [U, U, U, U, U, U, U, U, U, D, A, U, U, U]);
});

test('two files in one diff: each hunk header starts its own counts', () => {
  const text = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n x\n-y\n+z\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-p\n+q';
  assert.deepEqual(read(text), [U, U, U, U, U, D, A, U, U, U, U, D, A]);
});

test('a hunk header without counts means one line each', () => {
  assert.deepEqual(read('@@ -3 +3 @@\n-a\n+b\n-- tail'), [U, D, A, U]);
});

test('CRLF: the line endings do not matter', () => {
  assert.deepEqual(read('@@ -1,2 +1,2 @@\r\n x\r\n--- y\r\n+++ z\r\n\\ No newline at end of file'), [U, U, D, A, U]);
});

test('the no-newline note is plain and does not end a hunk; a stripped blank context line is context', () => {
  assert.deepEqual(read('@@ -1,3 +1,2 @@\n-a\n\\ No newline at end of file\n\n+b'), [U, D, U, U, A]);
});

test('combined diffs are left plain and do not break', () => {
  assert.deepEqual(read('diff --cc f\n@@@ -1,2 -1,2 +1,3 @@@\n  x\n+ y'), [U, U, U, U]);
});

// A file is cut into pieces and each is read with the state its predecessor ended in: that must equal reading it whole.
function randomDiff(seed: number): string[] {
  let x = seed;
  const rnd = (n: number) => ((x = (x * 1103515245 + 12345) & 0x7fffffff), x % n);
  const out: string[] = [];
  if (rnd(3) === 0) out.push('From abc Mon Sep 17 00:00:00 2001', 'Subject: [PATCH] x', '---', ' f | 1 +');
  for (let f = 0, files = 1 + rnd(3); f < files; f++) {
    out.push(`diff --git a/f${f} b/f${f}`, 'index 1..2 100644', `--- a/f${f}`, `+++ b/f${f}`);
    for (let h = 0, hunks = 1 + rnd(3); h < hunks; h++) {
      const o = rnd(40), n = rnd(40), ctx = rnd(20);
      out.push(rnd(4) === 0 && o === 1 && n === 1 ? '@@ -3 +3 @@' : `@@ -1,${o + ctx} +1,${n + ctx} @@ fn`);
      const body = [...Array(o).fill('-'), ...Array(n).fill('+'), ...Array(ctx).fill(' ')];
      for (let i = body.length - 1; i > 0; i--) { const j = rnd(i + 1); [body[i], body[j]] = [body[j]!, body[i]!]; }
      for (const m of body) out.push(m + (['', '--', '++', '-- x', 'text'][rnd(5)] ?? ''));
      if (rnd(3) === 0) out.push('\\ No newline at end of file');
    }
  }
  if (rnd(2) === 0) out.push('-- ', '2.44.0');
  return out;
}

test('reading a diff piece by piece, each piece from the state the last ended in, equals reading it whole', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const lines = randomDiff(seed);
    const whole = diffFileLineClasses(lines);
    const size = 1 + (seed % 17);
    const parts: (string | undefined)[] = [];
    let state = DIFF_OUTSIDE;
    for (let at = 0; at < lines.length; at += size) {
      const r = diffFileRead(lines.slice(at, at + size), state);
      parts.push(...r.classes);
      state = r.end;
    }
    assert.deepEqual(parts, whole, `seed ${seed}, pieces of ${size}`);
  }
});
