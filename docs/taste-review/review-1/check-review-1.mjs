// MARXY-31 acceptance: marxy PNGs exist, two render runs are byte-identical, manifest and queue row present.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FILES, pngName, captureAll } from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const marxyDir = join(here, 'marxy');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function expectedNames() {
  const names = [];
  for (const file of FILES) {
    names.push(pngName(file, 'first'), pngName(file, 'scroll70'));
  }
  return names;
}

for (const name of expectedNames()) {
  const path = join(marxyDir, name);
  assert.ok(existsSync(path), `missing ${path}; run node docs/taste-review/review-1/render.mjs`);
  const buf = readFileSync(path);
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} is not a PNG`);
}

const tmp1 = mkdtempSync(join(tmpdir(), 'marxy-31-a-'));
const tmp2 = mkdtempSync(join(tmpdir(), 'marxy-31-b-'));
try {
  await captureAll({ dest: tmp1 });
  await captureAll({ dest: tmp2 });
  for (const name of expectedNames()) {
    const a = sha256(join(tmp1, name));
    const b = sha256(join(tmp2, name));
    assert.equal(a, b, `${name} differs between two render runs`);
    const committed = sha256(join(marxyDir, name));
    assert.equal(committed, a, `${name} on disk is not byte-identical to a fresh render`);
  }
} finally {
  rmSync(tmp1, { recursive: true, force: true });
  rmSync(tmp2, { recursive: true, force: true });
}

for (const rel of ['manifest.json', 'README.md', 'NEEDS-HUMAN.md']) {
  assert.ok(existsSync(join(here, rel)), `missing ${rel}`);
}

const queue = readFileSync(join(root, 'docs/taste-review/queue.md'), 'utf8');
assert.match(queue, /MARXY-31/, 'docs/taste-review/queue.md has no MARXY-31 row');
assert.match(queue, /review-1\//, 'queue row must link review-1 artifacts');

const key = JSON.parse(readFileSync(join(here, 'manifest.key.json'), 'utf8'));
assert.ok(key.assignment, 'manifest.key.json must carry assignment');
assert.deepEqual(Object.keys(key.assignment).sort(), ['A', 'B', 'C']);
assert.deepEqual(new Set(Object.values(key.assignment)), new Set(['marxy', 'typora', 'marked']));
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
assert.equal(manifest.measure, '68ch');
assert.ok(Array.isArray(manifest.corpus) && manifest.corpus.length === FILES.length);

console.log(
  `review-1 check ok: ${expectedNames().length} marxy PNGs deterministic; manifest, form, queue present`,
);
