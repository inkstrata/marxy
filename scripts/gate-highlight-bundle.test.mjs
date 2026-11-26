// The highlight bundle gate's grammar rules over small built outputs: a grammar reachable from a page, or emitted twice,
// fails; the worker holding them alone passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { grammarProblems, grammarScopes } from './gate-highlight-bundle.mjs';

const grammar = (scope) => `export default [JSON.parse("{\\"scopeName\\":\\"${scope}\\",\\"patterns\\":[]}")];`;

/** A dist of `files` (name to text) under assets/, and an index.html loading `entry`. */
function build(files, entry = 'index.js') {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-grammar-gate-'));
  mkdirSync(join(dir, 'assets'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'assets', name), text);
  writeFileSync(join(dir, 'index.html'), `<html><script type="module" src="./assets/${entry}"></script></html>`);
  return dir;
}

function problemsOf(files, entry) {
  const dir = build(files, entry);
  try {
    return grammarProblems(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('grammarScopes reads a scope from a bundle either way the grammar is held', () => {
  assert.deepEqual(grammarScopes('{"scopeName":"source.a"}'), ['source.a']);
  assert.deepEqual(grammarScopes('"{\\"scopeName\\":\\"source.b\\"}"'), ['source.b']);
  assert.deepEqual(grammarScopes('{"include":"source.c"}'), []);
});

test('the worker holding each grammar once, and no page reaching one, passes', () => {
  const problems = problemsOf({
    'index.js': 'new Worker(new URL("worker.js", import.meta.url));',
    'worker.js': 'import("./py.js");import("./go.js");',
    'py.js': grammar('source.python'),
    'go.js': grammar('source.go'),
  });
  assert.deepEqual(problems, []);
});

test('a grammar the page reaches by a dynamic import fails', () => {
  const problems = problemsOf({
    'index.js': 'const load=()=>import("./colour.js");',
    'colour.js': 'import"./py.js";',
    'py.js': grammar('source.python'),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /py\.js defines a grammar and a page reaches it/);
});

test('a grammar the page reaches by a static import fails', () => {
  const problems = problemsOf({ 'index.js': 'import{x}from"./py.js";', 'py.js': grammar('source.python') });
  assert.match(problems.join('\n'), /py\.js defines a grammar and a page reaches it/);
});

test('a grammar emitted twice fails', () => {
  const problems = problemsOf({
    'index.js': 'new Worker(new URL("worker.js", import.meta.url));',
    'worker.js': 'import("./py-1.js");',
    'py-1.js': grammar('source.python'),
    'py-2.js': grammar('source.python'),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /source\.python is emitted 2 times: assets\/py-[12]\.js, assets\/py-[12]\.js/);
});
