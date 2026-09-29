// Production bundle gate: memory-shell import graph and pre-build dist skip (MARXY-309).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { relativeImportSpecs, memoryShellReachableFromMain } from './gate-bundle.mjs';

test('relativeImportSpecs includes dynamic import() and require() of a relative path', () => {
  const source = `
    import { x } from './app.ts';
    void import('./shell/memory.ts');
    require('./harness/foo.ts');
  `;
  assert.deepEqual(relativeImportSpecs(source), ['./app.ts', './shell/memory.ts', './harness/foo.ts']);
});

test('relativeImportSpecs includes a plain template-literal import() and require()', () => {
  const source = `
    void import(\`./shell/memory.ts\`);
    require(\`./harness/foo.ts\`);
    void import(\`./\${name}.ts\`);
  `;
  assert.deepEqual(relativeImportSpecs(source), ['./shell/memory.ts', './harness/foo.ts']);
});

test('dynamic import of memory shell from main.ts is flagged', () => {
  const desktop = mkdtempSync(join(tmpdir(), 'marxy-309-'));
  try {
    mkdirSync(join(desktop, 'src', 'shell'), { recursive: true });
    writeFileSync(join(desktop, 'src', 'main.ts'), "void import('./shell/memory.ts');\n");
    writeFileSync(join(desktop, 'src', 'shell', 'memory.ts'), 'export function createMemoryShell() {}\n');
    const { memory, error } = memoryShellReachableFromMain(desktop);
    assert.equal(error, null);
    assert.equal(memory.length, 1);
    assert.match(memory[0], /src\/shell\/memory\.ts$/);
    assert.equal(existsSync(join(desktop, 'dist', 'index.html')), false);
  } finally {
    rmSync(desktop, { recursive: true, force: true });
  }
});

test('template-literal dynamic import of memory shell from main.ts is flagged', () => {
  const desktop = mkdtempSync(join(tmpdir(), 'marxy-309-tpl-'));
  try {
    mkdirSync(join(desktop, 'src', 'shell'), { recursive: true });
    writeFileSync(join(desktop, 'src', 'main.ts'), 'void import(`./shell/memory.ts`);\n');
    writeFileSync(join(desktop, 'src', 'shell', 'memory.ts'), 'export function createMemoryShell() {}\n');
    const { memory, error } = memoryShellReachableFromMain(desktop);
    assert.equal(error, null);
    assert.equal(memory.length, 1);
    assert.match(memory[0], /src\/shell\/memory\.ts$/);
  } finally {
    rmSync(desktop, { recursive: true, force: true });
  }
});

test('import-graph check does not require dist/index.html', () => {
  const desktop = mkdtempSync(join(tmpdir(), 'marxy-309-'));
  try {
    mkdirSync(join(desktop, 'src'), { recursive: true });
    writeFileSync(join(desktop, 'src', 'main.ts'), "import { startApp } from './app.ts';\n");
    writeFileSync(join(desktop, 'src', 'app.ts'), 'export function startApp() {}\n');
    const { memory, moduleCount, error } = memoryShellReachableFromMain(desktop);
    assert.equal(error, null);
    assert.deepEqual(memory, []);
    assert.ok(moduleCount >= 2);
    assert.equal(existsSync(join(desktop, 'dist')), false);
  } finally {
    rmSync(desktop, { recursive: true, force: true });
  }
});
