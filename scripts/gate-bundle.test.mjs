// Production bundle gate: memory-shell import graph and pre-build dist skip (MARXY-309).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { relativeImportSpecs, memoryShellReachableFromMain, resolveRelativeModule, distChunkSpecs } from './gate-bundle.mjs';

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

function reach(files) {
  const desktop = mkdtempSync(join(tmpdir(), 'marxy-337-'));
  try {
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(join(desktop, f, '..'), { recursive: true });
      writeFileSync(join(desktop, f), text);
    }
    return memoryShellReachableFromMain(desktop);
  } finally {
    rmSync(desktop, { recursive: true, force: true });
  }
}

test('MARXY-337: relativeImportSpecs reads multi-line and side-effect imports', () => {
  assert.deepEqual(relativeImportSpecs("import {\n a\n} from './a.ts';\nimport './b.ts'; export {\n c } from './c.ts';"), ['./a.ts', './b.ts', './c.ts']);
});

test('MARXY-337: a memory shell reached through a .js specifier that names a .ts file is flagged', () => {
  const { memory } = reach({ 'src/main.ts': "import './shell/memory.js';\n", 'src/shell/memory.ts': 'export {};\n' });
  assert.equal(memory.length, 1);
});

test('MARXY-337: a memory shell reached through a directory index.ts is flagged', () => {
  const { memory } = reach({ 'src/main.ts': "import './shell';\n", 'src/shell/index.ts': "import './memory.ts';\n", 'src/shell/memory.ts': 'export {};\n' });
  assert.equal(memory.length, 1);
});

test('MARXY-337: a memory shell reached through a .tsx file is flagged', () => {
  const { memory } = reach({ 'src/main.ts': "import './App';\n", 'src/App.tsx': "import './shell/memory.ts';\n", 'src/shell/memory.ts': 'export {};\n' });
  assert.equal(memory.length, 1);
});

test('MARXY-337: resolveRelativeModule prefers the file that exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-337-r-'));
  try {
    writeFileSync(join(dir, 'x.tsx'), '');
    assert.equal(resolveRelativeModule(join(dir, 'main.ts'), './x'), join(dir, 'x.tsx'));
    assert.equal(resolveRelativeModule(join(dir, 'main.ts'), './x.js'), join(dir, 'x.tsx'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MARXY-337: the dist walk follows import("./x.js") and side-effect import"./x.js"', () => {
  assert.deepEqual(distChunkSpecs('import("./a.js");import"./b.js";import{x}from"./c.js";import x from"../d.js"'), ['./a.js', './b.js', './c.js', '../d.js']);
});

test('MARXY-337: relativeImportSpecs is not fooled by comment markers inside strings', () => {
  assert.deepEqual(relativeImportSpecs("const g = 'src/*.ts';\nimport './a.ts';\nconst e = '*/';"), ['./a.ts']);
});

test('MARXY-337: gate scripts turn import.meta.url into a path with fileURLToPath, not .pathname', () => {
  for (const f of ['gate-bundle', 'gate-no-network', 'gate-licences', 'measure-startup', 'gate-aesthetics', 'gate-protection']) {
    const text = readFileSync(new URL(`./${f}.mjs`, import.meta.url), 'utf8');
    // `.pathname` percent-encodes a space, `%` or a non-ASCII letter in the checkout path.
    assert.doesNotMatch(text.replace(/new URL\(req\.url[^)]*\)\.pathname/g, '').replace(/new URL\(spec[^)]*\)\.pathname/g, ''), /import\.meta\.url\)\.pathname/, f);
  }
});
