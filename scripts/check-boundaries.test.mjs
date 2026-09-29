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

test('importing check-boundaries.mjs does not walk the tree', () => {
  const run = spawnSync(process.execPath, ['-e', 'import("./scripts/check-boundaries.mjs")'], {
    encoding: 'utf8',
    cwd: new URL('../', import.meta.url).pathname,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), '');
});

test('check-boundaries.mjs is green over the committed tree', () => {
  const run = spawnSync(process.execPath, ['scripts/check-boundaries.mjs'], {
    encoding: 'utf8',
    cwd: new URL('../', import.meta.url).pathname,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /boundaries ok \(\d+ source files\)/);
});

const APP_FILE = 'apps/desktop/src/render/x.ts';
const TAURI = '@' + 'tauri-apps/api/core';

test('MARXY-337: a multi-line Node import in core is flagged', () => {
  assert.equal(boundaryProblemsFor(CORE_FILE, "import {\n  readFile,\n} from 'node:fs';\n").length, 1);
});

test('MARXY-337: a side-effect Node import, a multi-line re-export and a second import on one line are flagged', () => {
  assert.equal(boundaryProblemsFor(CORE_FILE, "import 'node:fs';").length, 1);
  assert.equal(boundaryProblemsFor(CORE_FILE, "export {\n a\n} from 'node:os';").length, 1);
  assert.equal(boundaryProblemsFor(CORE_FILE, "import a from './a'; import b from 'node:path';").length, 1);
});

test('MARXY-337: fs/promises and bare built-ins (events, buffer, module, assert, process) are flagged', () => {
  for (const s of ['fs/promises', 'events', 'buffer', 'module', 'assert', 'process', 'node:test']) {
    assert.equal(boundaryProblemsFor(CORE_FILE, `import x from '${s}';`).length, 1, s);
  }
});

test('MARXY-337: invoke<Array<string>>( outside src/shell is flagged, inside it is not', () => {
  assert.equal(boundaryProblemsFor(APP_FILE, "invoke<Array<string>>('x');").length, 1);
  assert.equal(boundaryProblemsFor('apps/desktop/src/shell/tauri.ts', "invoke<Array<string>>('x');").length, 0);
});

test('MARXY-337: a multi-line @tauri-apps import outside src/shell is flagged', () => {
  assert.equal(boundaryProblemsFor(APP_FILE, `import {\n  invoke\n} from '${TAURI}';`).length, 1);
});

test('MARXY-337: a relative import from core that escapes into another package is flagged', () => {
  const p = boundaryProblemsFor(CORE_FILE, "import { x } from '../../../typeset/src/index.ts';");
  assert.equal(p.length, 1, p.join('\n'));
  assert.match(p[0], /another package|escapes/);
  assert.equal(boundaryProblemsFor(CORE_FILE, "import { x } from '../contracts/ast.ts';").length, 0);
});

test('MARXY-337: comment-looking text in a string does not hide a later violation', () => {
  const src = "const glob = 'src/*.ts';\nimport x from 'node:fs';\nconst y = '*/';\n";
  assert.equal(boundaryProblemsFor(CORE_FILE, src).length, 1);
});
