import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { problems } from './check-changelog.mjs';
import { fragmentProblem } from './lib/changelog.mjs';

test('a file name whose case differs from the id its line ends in is a problem', () => {
  assert.match(fragmentProblem('changelog.d/u-05.md', 'A line (U-05)\n'), /names u-05 but its line ends in \(U-05\)/);
  assert.equal(fragmentProblem('changelog.d/U-05.md', 'A line (U-05)\n'), null);
});

test('a different id, or a trailing full stop, is a problem', () => {
  assert.match(fragmentProblem('changelog.d/B-02.7.md', 'x (B-02.5.1)'), /names B-02\.7/);
  assert.match(fragmentProblem('changelog.d/C-17.md', 'x (C-17).'), /not one line/);
});

test('problems() reads a directory, skipping README.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'f62-'));
  try {
    mkdirSync(join(root, 'changelog.d'));
    writeFileSync(join(root, 'changelog.d/README.md'), 'rules');
    writeFileSync(join(root, 'changelog.d/e-02.md'), 'x (E-02)\n');
    writeFileSync(join(root, 'changelog.d/E-03.md'), 'x (E-03)\n');
    assert.equal(problems(root).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the real changelog.d/ is clean', () => { assert.deepEqual(problems(), []); });
