// E-16: line diff. Every case is judged on bytes: apply the diff to A and demand B exactly.

import assert from 'node:assert/strict';
import { Buffer as NodeBuffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { diffLines, splitLines, type DiffOp } from './lines.ts';
import { unifiedDiff } from './unified.ts';

// ---------------------------------------------------------------- helpers

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Test-local patch: apply a unified diff produced by `unifiedDiff` to `a`. Lines split on \n only. */
function applyUnified(a: string, patch: string): string {
  if (patch === '') return a;
  const aLines = splitLines(a, 'lf');
  const lines = patch.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const out: string[] = [];
  let ai = 0;
  let i = 2; // skip ---/+++
  let lastOut: 'a' | 'b' | null = null;
  while (i < lines.length) {
    const head = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(lines[i] as string);
    assert.ok(head, `hunk header expected, got ${JSON.stringify(lines[i])}`);
    const aStart = Number(head[2]) === 0 ? Number(head[1]) : Number(head[1]) - 1;
    while (ai < aStart) out.push(aLines[ai++] as string);
    i++;
    while (i < lines.length && !(lines[i] as string).startsWith('@@ ')) {
      const l = lines[i] as string;
      if (l.startsWith('\\')) {
        // The previous emitted/consumed line has no terminator.
        if (lastOut === 'b') out[out.length - 1] = (out[out.length - 1] as string).replace(/\n$/, '');
        else assert.equal(lastOut, 'a');
      } else if (l[0] === ' ') {
        assert.equal(aLines[ai]?.replace(/\n$/, ''), l.slice(1), 'context matches A');
        out.push(aLines[ai++] as string);
        lastOut = 'b';
      } else if (l[0] === '-') {
        assert.equal(aLines[ai]?.replace(/\n$/, ''), l.slice(1), 'removed line matches A');
        ai++;
        lastOut = 'a';
      } else if (l[0] === '+') {
        out.push(`${l.slice(1)}\n`);
        lastOut = 'b';
      } else assert.fail(`bad patch line ${JSON.stringify(l)}`);
      i++;
    }
  }
  while (ai < aLines.length) out.push(aLines[ai++] as string);
  return out.join('');
}

/** Rebuild B from A using only the ops' byte ranges, checking both sides are covered with no gap. */
function applyOps(a: string, b: string, ops: DiffOp[]): string {
  const ab = NodeBuffer.from(a, 'utf8');
  const bb = NodeBuffer.from(b, 'utf8');
  let aAt = 0;
  let bAt = 0;
  const parts: NodeBuffer[] = [];
  for (const op of ops) {
    assert.equal(op.aByteStart, aAt, 'A side is contiguous');
    assert.equal(op.bByteStart, bAt, 'B side is contiguous');
    if (op.kind === 'equal') {
      const x = ab.subarray(op.aByteStart, op.aByteEnd);
      assert.ok(x.equals(bb.subarray(op.bByteStart, op.bByteEnd)), 'equal ranges hold the same bytes');
      parts.push(x);
    } else if (op.kind === 'insert') {
      assert.equal(op.aByteStart, op.aByteEnd);
      parts.push(bb.subarray(op.bByteStart, op.bByteEnd));
    } else assert.equal(op.bByteStart, op.bByteEnd);
    aAt = op.aByteEnd;
    bAt = op.bByteEnd;
  }
  assert.equal(aAt, ab.length, 'ops cover all of A');
  assert.equal(bAt, bb.length, 'ops cover all of B');
  return NodeBuffer.concat(parts).toString('utf8');
}

type Eol = 'lf' | 'crlf' | 'cr' | 'mixed';
const VOCAB = ['}', '{', '', 'a', 'b', 'c', 'let x = 1;', 'if (x) {', '  return;', 'é世界', 'tab\there', '😀', 'x'];

function randomText(r: () => number, eol: Eol, lines: number): string {
  let out = '';
  for (let i = 0; i < lines; i++) {
    const e = eol === 'lf' ? '\n' : eol === 'crlf' ? '\r\n' : eol === 'cr' ? '\r' : (['\n', '\r\n', '\r'][Math.floor(r() * 3)] as string);
    out += (VOCAB[Math.floor(r() * VOCAB.length)] as string) + (i === lines - 1 && r() < 0.4 ? '' : e);
  }
  return out;
}

function edit(r: () => number, text: string): string {
  let t = text;
  const n = 1 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const at = Math.floor(r() * (t.length + 1));
    const len = Math.floor(r() * 12);
    const kind = r();
    const bit = (['\n', '\r\n', '\r', 'zz', '}\n', '', 'é'] as string[])[Math.floor(r() * 7)] as string;
    // Never split a surrogate pair: move to a boundary.
    let p = at;
    if (p > 0 && p < t.length && (t.charCodeAt(p) & 0xfc00) === 0xdc00) p--;
    let q = Math.min(t.length, p + len);
    if (q < t.length && (t.charCodeAt(q) & 0xfc00) === 0xdc00) q++;
    t = kind < 0.4 ? t.slice(0, p) + bit + t.slice(p) : kind < 0.7 ? t.slice(0, p) + t.slice(q) : t.slice(0, p) + bit + t.slice(q);
  }
  return t;
}

function checkPair(a: string, b: string, what: string): void {
  const ops = diffLines(a, b);
  assert.ok(ops, what);
  assert.equal(applyOps(a, b, ops), b, `${what}: ops rebuild B`);
  const u = unifiedDiff(a, b);
  assert.ok(u, what);
  assert.equal(applyUnified(a, u.text), b, `${what}: unified applies`);
  if (a === b) assert.equal(u.text, '');
  else assert.notEqual(u.text, '', `${what}: a difference is never invisible`);
}

// ---------------------------------------------------------------- acceptance

test('round trip: 200 seeded random pairs of small texts (LF, CRLF, CR, mixed)', () => {
  const r = rng(16);
  const eols: Eol[] = ['lf', 'crlf', 'cr', 'mixed'];
  for (let i = 0; i < 200; i++) {
    const eol = eols[i % 4] as Eol;
    const a = randomText(r, eol, Math.floor(r() * 30));
    const b = r() < 0.5 ? edit(r, a) : randomText(r, eols[Math.floor(r() * 4)] as Eol, Math.floor(r() * 30));
    checkPair(a, b, `pair ${i} (${eol})`);
  }
});

test('property: 3000 random edits keep byte-exact round trip across line-ending styles', () => {
  const r = rng(2026);
  const eols: Eol[] = ['lf', 'crlf', 'cr', 'mixed'];
  for (let i = 0; i < 3000; i++) {
    const a = randomText(r, eols[i % 4] as Eol, 1 + Math.floor(r() * 60));
    checkPair(a, edit(r, a), `edit ${i}`);
  }
});

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const corpusFiles = readdirSync(corpus).filter((n) => n.endsWith('.md')).sort();

test('round trip: every corpus markdown file against an edited copy of itself, and against its neighbour', () => {
  const r = rng(7);
  assert.ok(corpusFiles.length > 10);
  let prev = '';
  for (const name of corpusFiles) {
    const a = readFileSync(new URL(name, corpus), 'utf8');
    checkPair(a, edit(r, edit(r, a)), `${name} edited`);
    checkPair(a, a.replace(/\r?\n/g, '\r\n'), `${name} to CRLF`);
    checkPair(prev, a, `${name} against the previous file`);
    prev = a;
  }
});

test('identical inputs give an empty diff; fully different inputs give one hunk', () => {
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n')?.text, '');
  assert.equal(unifiedDiff('', '')?.text, '');
  assert.deepEqual(diffLines('a\nb\n', 'a\nb\n')?.map((o) => o.kind), ['equal']);
  const u = unifiedDiff('a\nb\nc\n', 'x\ny\n', { aLabel: 'old', bLabel: 'new' });
  assert.ok(u);
  assert.equal(u.text, '--- old\n+++ new\n@@ -1,3 +1,2 @@\n-a\n-b\n-c\n+x\n+y\n');
  assert.equal(u.text.match(/^@@/gm)?.length, 1);
  assert.deepEqual([u.added, u.removed], [2, 3]);
  assert.equal(unifiedDiff('', 'a\n')?.text, '--- a\n+++ b\n@@ -0,0 +1,1 @@\n+a\n');
});

test('a single changed line in a 1,000-line file is one hunk with 3 lines of context each side', () => {
  const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
  const a = `${lines.join('\n')}\n`;
  const changed = [...lines];
  changed[500] = 'CHANGED';
  const u = unifiedDiff(a, `${changed.join('\n')}\n`);
  assert.ok(u);
  assert.equal(u.text.match(/^@@/gm)?.length, 1);
  assert.match(u.text, /@@ -498,7 \+498,7 @@/);
  assert.equal(u.text.split('\n').filter((l) => l.startsWith(' ')).length, 6);
  assert.deepEqual([u.added, u.removed], [1, 1]);
});

test('a missing final newline is distinguished: marker under the changed last line', () => {
  const u = unifiedDiff('a\nb\nc\n', 'a\nB\nc');
  assert.ok(u);
  assert.equal(u.text, '--- a\n+++ b\n@@ -1,3 +1,3 @@\n a\n-b\n-c\n+B\n+c\n\\ No newline at end of file\n');
  // Only the newline differs: still a change, with the marker on the side that lacks it.
  const v = unifiedDiff('x\ny\n', 'x\ny');
  assert.equal(v?.text, '--- a\n+++ b\n@@ -1,2 +1,2 @@\n x\n-y\n+y\n\\ No newline at end of file\n');
  assert.equal(applyUnified('x\ny\n', v?.text ?? ''), 'x\ny');
  const w = unifiedDiff('x\ny', 'x\ny\n');
  assert.equal(w?.text, '--- a\n+++ b\n@@ -1,2 +1,2 @@\n x\n-y\n\\ No newline at end of file\n+y\n');
  assert.equal(applyUnified('x\ny', w?.text ?? ''), 'x\ny\n');
  // Both sides lack it and agree: not a change.
  assert.equal(unifiedDiff('x\ny', 'x\ny')?.text, '');
});

test('line endings are bytes: CRLF to LF is a change, reported, with exact byte ranges', () => {
  const a = 'one\r\ntwo\r\nthree\r\n';
  const b = 'one\ntwo\nthree\n';
  const u = unifiedDiff(a, b);
  assert.ok(u);
  assert.notEqual(u.text, '');
  assert.equal(u.eolChanged, true);
  assert.equal(applyUnified(a, u.text), b);
  const ops = diffLines(a, b);
  assert.deepEqual(ops?.map((o) => [o.kind, o.aByteStart, o.aByteEnd, o.bByteStart, o.bByteEnd]), [
    ['delete', 0, 17, 0, 0],
    ['insert', 17, 17, 0, 14],
  ]);
  // A real edit with unchanged endings does not claim an ending change.
  assert.equal(unifiedDiff('a\r\nb\r\n', 'a\r\nB\r\n')?.eolChanged, false);
  // CR-only files: each lone CR is a line end for diffLines.
  assert.equal(diffLines('a\rb\rc', 'a\rB\rc')?.length, 4);
  assert.equal(unifiedDiff('a\rb\rc', 'a\rB\rc') !== null, true);
});

test('byte ranges are UTF-8 bytes, not code units', () => {
  const a = 'é\n😀\nz\n';
  const b = 'é\nQ\nz\n';
  const ops = diffLines(a, b) as DiffOp[];
  const del = ops.find((o) => o.kind === 'delete') as DiffOp;
  assert.deepEqual([del.aByteStart, del.aByteEnd], [3, 8]);
  assert.equal(applyOps(a, b, ops), b);
});

test('an inserted block that moves a repeated line does not drag the file into the diff', () => {
  const fn = (name: string) => [`function ${name}() {`, '  step();', '}', ''];
  const a = [...fn('one'), ...fn('two'), ...fn('three')].join('\n');
  const b = [...fn('one'), ...fn('inserted'), ...fn('two'), ...fn('three')].join('\n');
  const u = unifiedDiff(a, b);
  assert.ok(u);
  assert.equal(u.removed, 0);
  assert.equal(u.added, 4);
  assert.equal(applyUnified(a, u.text), b);
});

test('a 10,000-line file with scattered edits diffs; over maxLines returns null (time printed, not asserted)', () => {
  const r = rng(99);
  const lines = Array.from({ length: 10_000 }, (_, i) => (i % 7 === 0 ? '}' : `statement ${i} ${Math.floor(r() * 1e6)};`));
  const a = `${lines.join('\n')}\n`;
  const edited = [...lines];
  for (let i = 0; i < 100; i++) edited[Math.floor(r() * edited.length)] = `edited ${i}`;
  const b = `${edited.join('\n')}\n`;
  const t0 = performance.now();
  const u = unifiedDiff(a, b);
  const ms = performance.now() - t0;
  console.log(`# E-16 10,000 lines, ~100 scattered edits: ${ms.toFixed(1)} ms, ${u?.added} added / ${u?.removed} removed`);
  assert.ok(u && u.exact);
  assert.equal(applyUnified(a, u.text), b);
  assert.equal(diffLines(a, b, { maxLines: 9_999 }), null);
  assert.equal(unifiedDiff(a, b, { maxLines: 9_999 }), null);
});

// ---------------------------------------------------------------- performance bounds

function fixture1MB(seed: number, distinct: number, pad = 30): string {
  const r = rng(seed);
  let out = '';
  while (out.length < 1_000_000) out += `row ${Math.floor(r() * distinct)} ${'x'.repeat(pad === 0 ? 0 : Math.floor(r() * pad))}\n`;
  return out;
}

test('1 MB: a small edit is fast and exact; two unrelated files cannot hang (time printed)', () => {
  const a = fixture1MB(1, 1_000_000);
  const r = rng(5);
  const ls = a.split('\n');
  for (let i = 0; i < 5; i++) ls[Math.floor(r() * ls.length)] = `small edit ${i}`;
  const small = ls.join('\n');
  let t0 = performance.now();
  const s = unifiedDiff(a, small);
  const smallMs = performance.now() - t0;
  assert.ok(s?.exact);
  assert.equal(applyUnified(a, s.text), small);

  // Unrelated, but full of repeated lines: no histogram anchor is rare, so Myers runs until the budget ends it.
  const x = fixture1MB(11, 3, 40);
  const y = fixture1MB(12, 3, 40);
  t0 = performance.now();
  const w = unifiedDiff(x, y);
  const worstMs = performance.now() - t0;
  // Unrelated, no line in common at all.
  const p = `${'p'.repeat(20)}\n`.repeat(0) + fixture1MB(21, 1_000_000_000);
  const q = fixture1MB(22, 1_000_000_000).replace(/row/g, 'col');
  t0 = performance.now();
  const d = unifiedDiff(p, q);
  const disjointMs = performance.now() - t0;
  console.log(`# E-16 1 MB: small edit ${smallMs.toFixed(0)} ms; unrelated repetitive ${worstMs.toFixed(0)} ms (exact=${w?.exact}); disjoint ${disjointMs.toFixed(0)} ms`);
  assert.ok(w);
  assert.equal(applyUnified(x, w.text), y, 'a coarse diff still applies');
  assert.ok(d);
  assert.equal(applyUnified(p, d.text), q);
  assert.ok(worstMs < 5000, `worst case stayed bounded (${worstMs} ms)`);
});

test('Myers path (every common line repeats more than 64 times) is exact on small edits', () => {
  const r = rng(64);
  for (let i = 0; i < 60; i++) {
    const a = Array.from({ length: 300 + Math.floor(r() * 200) }, () => (['}', '{', 'x'] as string[])[Math.floor(r() * 3)]).join(i % 2 ? '\r\n' : '\n');
    const b = edit(r, a);
    checkPair(a, b, `repetitive ${i}`);
    const u = unifiedDiff(a, b);
    assert.ok(u?.exact);
  }
});

test('a tiny budget degrades to a coarse diff that still applies', () => {
  const r = rng(3);
  const a = randomText(r, 'lf', 400);
  const b = randomText(r, 'lf', 400);
  const u = unifiedDiff(a, b, { budget: 50 });
  assert.ok(u);
  assert.equal(u.exact, false);
  assert.equal(applyUnified(a, u.text), b);
  assert.equal(unifiedDiff(a, b)?.exact, true);
});

// ---------------------------------------------------------------- git agrees

test('git apply --check accepts the output for ten cases', { skip: spawnSync('git', ['--version']).status !== 0 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-e16-'));
  try {
    const r = rng(42);
    const cases: Array<[string, string]> = [
      ['a\nb\nc\n', 'a\nB\nc\n'],
      ['a\nb\nc\n', 'a\nB\nc'],
      ['a\nb\nc', 'a\nb\nc\n'],
      ['one\r\ntwo\r\n', 'one\r\nTWO\r\n'],
      ['one\r\ntwo\r\n', 'one\ntwo\n'],
      ['', 'new\n'],
      ['gone\n', ''],
      [`${'x\n'.repeat(50)}`, `${'x\n'.repeat(20)}y\n${'x\n'.repeat(30)}`],
      ['é\n😀\nz\n', 'é\nQ\nz\n'],
      ['}\nfn() {\n}\n', '}\nfn() {\n}\nnew() {\n}\n'],
    ];
    for (let i = 0; i < 3; i++) {
      const a = randomText(r, 'lf', 40);
      cases.push([a, edit(r, a)]);
    }
    for (const [i, [a, b]] of cases.slice(0, 10).entries()) {
      const u = unifiedDiff(a, b, { aLabel: 'a/f.txt', bLabel: 'b/f.txt' });
      assert.ok(u && u.text !== '', `case ${i} has a diff`);
      writeFileSync(join(dir, 'f.txt'), a);
      writeFileSync(join(dir, 'p.diff'), u.text);
      execFileSync('git', ['apply', '--check', '-p1', 'p.diff'], { cwd: dir });
      execFileSync('git', ['apply', '-p1', 'p.diff'], { cwd: dir });
      assert.ok(readFileSync(join(dir, 'f.txt')).equals(NodeBuffer.from(b, 'utf8')), `git applies case ${i} to B`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
