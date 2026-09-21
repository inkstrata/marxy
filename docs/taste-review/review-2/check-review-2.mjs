// MARXY-39 acceptance: review #2 task script, manifest, PNGs deterministic, queue row present.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CAPTURES, SEQUENCE, captureAll } from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const pngNames = Object.values(CAPTURES);
for (const name of pngNames) {
  const path = join(here, name);
  assert.ok(existsSync(path), `missing ${path}; run node docs/taste-review/review-2/render.mjs`);
  const buf = readFileSync(path);
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} is not a PNG`);
}

const tmp1 = mkdtempSync(join(tmpdir(), 'marxy-39-a-'));
const tmp2 = mkdtempSync(join(tmpdir(), 'marxy-39-b-'));
try {
  await captureAll({ dest: tmp1 });
  await captureAll({ dest: tmp2 });
  for (const name of pngNames) {
    const a = sha256(join(tmp1, name));
    const b = sha256(join(tmp2, name));
    assert.equal(a, b, `${name} differs between two render runs`);
    const committed = sha256(join(here, name));
    assert.equal(committed, a, `${name} on disk is not byte-identical to a fresh render`);
  }
} finally {
  rmSync(tmp1, { recursive: true, force: true });
  rmSync(tmp2, { recursive: true, force: true });
}

for (const rel of ['manifest.json', 'README.md']) {
  assert.ok(existsSync(join(here, rel)), `missing ${rel}`);
}

const readme = readFileSync(join(here, 'README.md'), 'utf8');
assert.match(readme, /under 5 s|under five seconds/i, 'README must state the 5 s pass threshold');
assert.match(readme, /Stopwatch/, 'README must include a stopwatch column');
for (const file of SEQUENCE) {
  assert.match(readme, new RegExp(file.replace('.', '\\.')), `README must name ${file} in the open sequence`);
}
assert.match(readme, /02-readme-real-world\.md/, 'README must name the target document');

const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
assert.equal(manifest.openSequence.length, 5);
assert.deepEqual(
  manifest.openSequence.map((row) => row.file),
  SEQUENCE,
);
const targets = manifest.openSequence.filter((row) => row.target);
assert.equal(targets.length, 1);
assert.equal(targets[0].file, '02-readme-real-world.md');
assert.equal(manifest.openSequence[1]?.file, '02-readme-real-world.md');

const queue = readFileSync(join(root, 'docs/taste-review/queue.md'), 'utf8');
assert.match(queue, /MARXY-39/, 'docs/taste-review/queue.md has no MARXY-39 row');
assert.match(queue, /review-2\//, 'queue row must link review-2 artifacts');

assert.ok(
  existsSync(join(root, 'docs/taste-review/2026-09-review-2/decisions.md')),
  'missing decisions template',
);

console.log(
  `review-2 check ok: ${pngNames.length} PNGs deterministic; task script, manifest, queue present`,
);
