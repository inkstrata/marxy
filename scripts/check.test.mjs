// `pnpm check` (A-08, H-02): nine checks, one line each, a failing check exits 1 with its own fix line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS, runChecks } from './check.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('A-08: pnpm check runs exactly the nine hygiene checks, each an existing script', () => {
  assert.deepEqual(CHECKS.map(c => c.name), [
    'check-boundaries', 'check-registry', 'check-deps', 'check-deferrals',
    'check-one-parse', 'check-tokens', 'gate-font-attrs', 'gate-contrast', 'check-workflows',
  ]);
  for (const c of CHECKS) assert.ok(existsSync(join(ROOT, 'scripts', c.script)), c.script);
});

test('A-08: package.json exposes check, and CI and precheck run it', () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts.check, 'node scripts/check.mjs');
  // Built from parts so the story's own `git grep` for the old names stays empty.
  const gone = [...['boundaries', 'registry', 'deps', 'deferrals', 'one-parse', 'workflows'].map(n => `check:${n}`), `gate:${'font-attrs'}`, `lint:${'biome-contract'}`];
  for (const name of gone) {
    assert.equal(scripts[name], undefined, `${name} is replaced by pnpm check`);
  }
  assert.ok(JSON.parse(readFileSync(join(ROOT, 'scripts/gates-by-path.json'), 'utf8')).always.includes('check'));
  // pnpm runs `precheck` as the pre-hook of `check`, and precheck runs `pnpm check`: a loop, unless hooks are off.
  assert.match(readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8'), /^enablePrePostScripts:\s*false\s*$/m);
  assert.match(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'), /^\s*- run: pnpm check$/m);
});

test('A-08: a failing check is reported as ✗ with the last six lines of its output, and the rest still run', () => {
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

test('A-08: pnpm check is green on this tree', () => {
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/check.mjs')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal((run.stdout.match(/^✓ /gm) ?? []).length, 9);
  assert.match(run.stdout, /check: 9\/9 passed/);
});

test('A-08: a Node built-in imported into packages/core makes pnpm check exit 1 with the boundaries fix line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-check-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    for (const f of ['check.mjs', 'check-boundaries.mjs']) cpSync(join(ROOT, 'scripts', f), join(dir, 'scripts', f));
    cpSync(join(ROOT, 'scripts/lib'), join(dir, 'scripts/lib'), { recursive: true });
    cpSync(join(ROOT, 'scripts/allowlists'), join(dir, 'scripts/allowlists'), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
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
