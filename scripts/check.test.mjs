// `pnpm check`: one line per check; a failing check exits 1 with its own fix line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS, runChecks } from './check.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * A directory link. Windows refuses symlinks without Developer Mode or the privilege, so it falls back to a junction,
 * which needs neither.
 */
function linkDir(target, path) {
  try {
    symlinkSync(target, path, 'dir');
  } catch (e) {
    if (e?.code !== 'EPERM') throw e;
    symlinkSync(target, path, 'junction');
  }
}

const noLinks = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-check-probe-'));
  try {
    linkDir(dir, join(dir, 'l'));
    return false;
  } catch {
    return 'directory links are not permitted here';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

test('pnpm check runs exactly these checks, each an existing script', () => {
  assert.deepEqual(CHECKS.map(c => c.name), [
    'check-boundaries', 'check-registry', 'check-deps', 'check-one-parse', 'check-tokens',
    'gate-font-attrs', 'gate-contrast', 'check-csp', 'check-commonplace',
    'check-listeners',
  ]);
  for (const c of CHECKS) assert.ok(existsSync(join(ROOT, 'scripts', c.script)), c.script);
});

test('package.json runs the checks as pnpm check', () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts.check, 'node scripts/check.mjs');
});

test('a failing check is reported as ✗ with the last six lines of its output, and the rest still run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-check-'));
  try {
    writeFileSync(join(dir, 'ok.mjs'), 'console.log("fine")\n');
    writeFileSync(join(dir, 'bad.mjs'), 'console.error([1,2,3,4,5,6,7,8].map(n => "line " + n).join("\\n") + "\\n    fix: do the thing"); process.exit(1)\n');
    const lines = [];
    const results = runChecks(
      [{ name: 'bad', script: 'bad.mjs' }, { name: 'ok', script: 'ok.mjs' }],
      { cwd: dir, dir, log: l => lines.push(l) },
    );
    assert.deepEqual(results.map(r => [r.name, r.ok]), [['bad', false], ['ok', true]]);
    assert.match(lines[0], /^✗ bad\n/);
    assert.match(lines[0], /fix: do the thing/);
    assert.doesNotMatch(lines[0], /line 2\b/);
    assert.equal(lines[1], '✓ ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a Node built-in imported into packages/core makes pnpm check exit 1 with the boundaries fix line', { skip: noLinks }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-check-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    for (const f of ['check.mjs', 'check-boundaries.mjs']) cpSync(join(ROOT, 'scripts', f), join(dir, 'scripts', f));
    cpSync(join(ROOT, 'scripts/lib'), join(dir, 'scripts/lib'), { recursive: true });
    cpSync(join(ROOT, 'scripts/allowlists'), join(dir, 'scripts/allowlists'), { recursive: true });
    linkDir(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    mkdirSync(join(dir, 'packages/core/src'), { recursive: true });
    writeFileSync(join(dir, 'packages/core/package.json'), '{"name":"@marxy/core"}\n');
    const index = join(dir, 'packages/core/src/index.ts');
    const only = ['--only=check-boundaries'];
    writeFileSync(index, 'export const x = 1;\n');
    const clean = spawnSync(process.execPath, [join(dir, 'scripts/check.mjs'), ...only], { cwd: dir, encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    writeFileSync(index, "import fs from 'node:fs';\nexport const x = fs;\n");
    const broken = spawnSync(process.execPath, [join(dir, 'scripts/check.mjs'), ...only], { cwd: dir, encoding: 'utf8' });
    assert.equal(broken.status, 1, broken.stdout + broken.stderr);
    assert.match(broken.stdout, /✗ check-boundaries/);
    assert.match(broken.stdout, /fix: /);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
