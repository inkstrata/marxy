// Module-boundary gate: template-literal dynamic import specs and forbidden deps (MARXY-307).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dynamicImportSpecs, boundaryProblemsFor } from './check-boundaries.mjs';

const CORE_FILE = 'packages/core/src/parse/evil-bypass.ts';

test('MARXY-307: dynamicImportSpecs reads a plain template-literal import()', () => {
  const specs = dynamicImportSpecs('await import(`@tauri-apps/api/core`);');
  const forbiddenShellSpec = '@' + 'tauri-apps/api/core';
  assert.deepEqual(specs, [forbiddenShellSpec]);
});

test('MARXY-307: dynamicImportSpecs reads a plain template-literal require()', () => {
  const specs = dynamicImportSpecs('const m = require(`node:fs`);');
  assert.deepEqual(specs, ['node:fs']);
});

test('MARXY-307: interpolated template-literal import is not extracted (known limitation)', () => {
  assert.deepEqual(dynamicImportSpecs('import(`@tauri-apps/${pkg}`);'), []);
});

test('MARXY-307: template-literal dynamic import of @tauri-apps in core is flagged', () => {
  const source = 'export async function load() { return import(`@tauri-apps/api/core`); }\n';
  const problems = boundaryProblemsFor(CORE_FILE, source);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], new RegExp('tauri-apps' + '/api/core'));
  assert.match(problems[0], /ADR-0020/);
});

test('check-boundaries.mjs is green over the committed tree', () => {
  const run = spawnSync(process.execPath, ['scripts/check-boundaries.mjs'], {
    encoding: 'utf8',
    cwd: new URL('../', import.meta.url).pathname,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /boundaries ok \(\d+ source files\)/);
});
